import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rainbowColor } from '../render/items';
import { HOOK_TIME, ITEM_INFO, MINE_RADIUS, SMOKE_RADIUS, ZAP_TIME, placeItemBoxes, type DropKind, type ItemState, type ItemView, type MissileKind } from '../sim/items';
import type { Track } from '../track/track';
import type { CarModel } from './carModel';

/**
 * Party mode in 3D: glowing item boxes that spin, bob and pop back in, rockets and blue shells
 * with smoke trails, things dropped on the track, and every item's effect on the cars (boost
 * flames, shield bubble, rainbow paint, the hook on its cable, the magnet, lightning, oil, smoke,
 * explosions, teleport flashes). Only a renderer: it reads the same item state the 2D view draws.
 * Kept cheap: repeated things are instanced, effects are camera-facing quads in a few shared meshes.
 */

/** A car as the items layer needs it: where it is and what its items are doing. */
export interface ItemCar {
  id: string;
  x: number;
  y: number;
  heading: number;
  trackIndex?: number | null;
  state: ItemState;
  /** Stopped (knocked out, resetting or parked). */
  frozen: boolean;
}

export interface ItemsFrame {
  view: ItemView;
  cars: ItemCar[];
  /** The player at this screen (mines show only to their owner). */
  viewer: string;
}

/** Box size (m), how high it floats (centre above the road) and how long it takes to pop back in (s). */
const BOX_SIZE = 1.7;
const BOX_LIFT = 1.45;
const BOX_POP = 0.45;
/** Rockets fly this high; blue shells higher, flapping their wings. */
const ROCKET_LIFT = 0.6;
const SHELL_LIFT = 2.6;
/** A car this close to an explosion spins (m). */
const SPIN_RADIUS = 7;
const SPIN_TIME = 1;
/** A car moving this far in one frame was teleported (m). */
const JUMP = 25;

type V3 = [number, number, number];

function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function radial(stops: [number, string][]): (c: CanvasRenderingContext2D, s: number) => void {
  return (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [at, color] of stops) g.addColorStop(at, color);
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  };
}

/** easeOutBack: overshoots a little, so a box pops into place. */
function popIn(t: number): number {
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  const c1 = 1.9;
  const u = t - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
}

/** A point on a car (car frame: x forward, y up, z right) in the world. */
function carPoint(car: { x: number; y: number; heading: number }, lift: number, p: V3, out = new THREE.Vector3()): THREE.Vector3 {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  return out.set(car.x + p[0] * cos - p[2] * sin, lift + p[1], car.y + p[0] * sin + p[2] * cos);
}

/**
 * Short-lived blobs (sparks, flames, smoke, shards), all in one instanced mesh. A ring buffer:
 * a new one takes the oldest slot. Camera-facing quads, or tumbling solids for shards.
 */
class Particles {
  readonly mesh: THREE.InstancedMesh;
  private static readonly STRIDE = 12;
  private readonly data: Float32Array;
  private readonly alive: Uint8Array;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly c = new THREE.Color();
  private static readonly ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    private readonly capacity: number,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    private readonly billboard: boolean,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.data = new Float32Array(capacity * Particles.STRIDE);
    this.alive = new Uint8Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, Particles.ZERO);
      this.mesh.setColorAt(i, this.c.set('#ffffff'));
    }
  }

  /** Size grows from s0 to s1 over its life, then shrinks away at the end. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: THREE.ColorRepresentation, gravity = 0, drag = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const d = this.data;
    const o = i * Particles.STRIDE;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = vx;
    d[o + 4] = vy;
    d[o + 5] = vz;
    d[o + 6] = 0;
    d[o + 7] = life;
    d[o + 8] = s0;
    d[o + 9] = s1;
    d[o + 10] = gravity;
    d[o + 11] = drag;
    this.alive[i] = 1;
    this.mesh.setColorAt(i, this.c.set(color));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    const d = this.data;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const o = i * Particles.STRIDE;
      d[o + 6] += dt;
      if (d[o + 6] >= d[o + 7]) {
        this.alive[i] = 0;
        this.mesh.setMatrixAt(i, Particles.ZERO);
        continue;
      }
      d[o + 4] += d[o + 10] * dt;
      const slow = Math.max(0, 1 - d[o + 11] * dt);
      d[o + 3] *= slow;
      d[o + 4] *= slow;
      d[o + 5] *= slow;
      d[o] += d[o + 3] * dt;
      d[o + 1] += d[o + 4] * dt;
      d[o + 2] += d[o + 5] * dt;
      const t = d[o + 6] / d[o + 7];
      const size = (d[o + 8] + (d[o + 9] - d[o + 8]) * t) * (t > 0.7 ? (1 - t) / 0.3 : 1);
      this.p.set(d[o], d[o + 1], d[o + 2]);
      if (this.billboard) this.q.copy(camera.quaternion);
      else this.q.setFromEuler(this.e.set(d[o + 6] * 9 + i, d[o + 6] * 12, i));
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.setScalar(size)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Camera-facing strips (lightning, the hook's cable, magnet field lines), rebuilt every frame
 * into one mesh.
 */
class Ribbons {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly geo = new THREE.BufferGeometry();
  private n = 0;
  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();

  constructor(
    private readonly capacity: number,
    material: THREE.Material,
  ) {
    this.pos = new Float32Array(capacity * 12);
    this.col = new Float32Array(capacity * 12);
    const index: number[] = [];
    for (let i = 0; i < capacity; i++) index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    this.geo.setIndex(index);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
  }

  begin(eye: THREE.Vector3): void {
    this.n = 0;
    this.eye.copy(eye);
  }

  line(a: THREE.Vector3, b: THREE.Vector3, width: number, color: THREE.Color): void {
    if (this.n >= this.capacity) return;
    this.dir.subVectors(b, a);
    this.mid.addVectors(a, b).multiplyScalar(0.5).sub(this.eye).negate();
    this.side.crossVectors(this.dir, this.mid);
    const len = this.side.length();
    if (len < 1e-6) return;
    this.side.multiplyScalar(width / 2 / len);
    const o = this.n * 12;
    const put = (k: number, v: THREE.Vector3, sign: number) => {
      this.pos[o + k * 3] = v.x + this.side.x * sign;
      this.pos[o + k * 3 + 1] = v.y + this.side.y * sign;
      this.pos[o + k * 3 + 2] = v.z + this.side.z * sign;
      this.col[o + k * 3] = color.r;
      this.col[o + k * 3 + 1] = color.g;
      this.col[o + k * 3 + 2] = color.b;
    };
    put(0, a, -1);
    put(1, a, 1);
    put(2, b, 1);
    put(3, b, -1);
    this.n++;
  }

  path(points: THREE.Vector3[], width: number, color: THREE.Color): void {
    for (let i = 1; i < points.length; i++) this.line(points[i - 1], points[i], width, color);
  }

  end(): void {
    this.geo.setDrawRange(0, this.n * 6);
    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate = true;
  }
}

/** A jagged line from a to b (lightning), `kinks` points in between pushed sideways by up to `spread`. */
function jagged(a: THREE.Vector3, b: THREE.Vector3, kinks: number, spread: number): THREE.Vector3[] {
  const out = [a.clone()];
  for (let k = 1; k <= kinks; k++) {
    const t = k / (kinks + 1);
    out.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.5, (Math.random() - 0.5) * spread)));
  }
  out.push(b.clone());
  return out;
}

/** Per-car effects, carried on the car's own model so they follow it (and its pitch on hills). */
interface CarFx {
  root: THREE.Group;
  flame: THREE.Group;
  shield: THREE.Group;
  magnet: THREE.Group;
  swirl: THREE.Group;
  painted: boolean;
  zapPrev: number;
  strikeUntil: number;
  frozenPrev: boolean;
  /** When it last stopped, and where. */
  froze: { x: number; y: number; t: number } | null;
  last: { x: number; y: number; t: number } | null;
}

interface BoxSlot {
  x: number;
  y: number;
  h: number;
  present: boolean | null;
  changed: number;
  phase: number;
}

interface DropEntry {
  kind: DropKind;
  x: number;
  y: number;
  h: number;
  obj: THREE.Object3D | null;
  born: number;
  seed: number;
}

/** Puffs per smoke cloud, and how many clouds can show at once. */
const PUFFS = 9;
const MAX_CLOUDS = 12;

export class Items3d {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private time = 0;

  // Boxes.
  private readonly slots: BoxSlot[];
  private readonly shell: THREE.InstancedMesh;
  private readonly question: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly floorGlow: THREE.InstancedMesh;
  private readonly shellGeo: THREE.BoxGeometry;

  // Effects.
  private readonly sparks: Particles;
  private readonly smoke: Particles;
  private readonly shards: Particles;
  private readonly bolts: Ribbons;
  private readonly cables: Ribbons;
  private readonly fx = new Map<string, CarFx>();
  private readonly spins = new Map<string, number>();
  /** Recent explosions, to tell a car knocked out by one from one that stopped for another reason. */
  private blasts: { x: number; z: number; t: number }[] = [];
  private readonly hooks = new Map<string, THREE.Group>();

  // Rockets and shells.
  private readonly rocketPools: Record<MissileKind, THREE.Group[]> = { rocket: [], homing: [], blue: [] };
  private prevRockets: { kind: MissileKind; x: number; y: number; h: number }[] = [];
  private trailClock = 0;

  // Drops.
  private readonly drops = new Map<string, DropEntry>();
  private readonly clouds: THREE.InstancedMesh;

  // Shared materials and geometry.
  private readonly mats: Record<string, THREE.Material> = {};
  private readonly geos: Record<string, THREE.BufferGeometry> = {};

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();
  private readonly c = new THREE.Color();

  constructor(
    track: Track,
    private readonly heightAt: (x: number, y: number, trackIndex?: number | null) => number,
  ) {
    const glowTex = canvasTexture(64, radial([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]));
    const puffTex = canvasTexture(64, radial([[0, 'rgba(255,255,255,0.9)'], [0.55, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]));
    const questionTex = canvasTexture(128, (c, s) => {
      c.font = `bold ${s * 0.82}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = s * 0.08;
      c.lineJoin = 'round';
      c.strokeStyle = '#1b1f6e';
      c.strokeText('?', s / 2, s * 0.54);
      const g = c.createLinearGradient(0, s * 0.15, 0, s * 0.9);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#ffe46b');
      c.fillStyle = g;
      c.fillText('?', s / 2, s * 0.54);
    });
    // A see-through face with a bright frame and a sheen, coloured by the box's rainbow.
    const shellTex = canvasTexture(64, (c, s) => {
      c.fillStyle = 'rgba(255,255,255,0.32)';
      c.fillRect(0, 0, s, s);
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.beginPath();
      c.moveTo(s * 0.1, s);
      c.lineTo(s * 0.45, s);
      c.lineTo(s, s * 0.45);
      c.lineTo(s, s * 0.1);
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = s * 0.11;
      c.strokeRect(0, 0, s, s);
    });
    this.disposables.push(glowTex, puffTex, questionTex, shellTex);

    const additive = (p: THREE.MeshBasicMaterialParameters = {}) =>
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, ...p });
    const lambert = (color: string) => new THREE.MeshLambertMaterial({ color });
    Object.assign(this.mats, {
      shell: new THREE.MeshBasicMaterial({ map: shellTex, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      question: new THREE.MeshBasicMaterial({ map: questionTex, transparent: true, depthWrite: false, alphaTest: 0.05 }),
      glow: additive({ map: glowTex, color: '#fff1c4', opacity: 0.6 }),
      floorGlow: additive({ map: glowTex, color: '#ffe9a0', opacity: 0.45 }),
      sparks: additive({ map: glowTex }),
      smoke: new THREE.MeshBasicMaterial({ map: puffTex, transparent: true, depthWrite: false }),
      shards: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      bolts: additive({ vertexColors: true }),
      cable: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      metal: lambert('#c7cbd3'),
      dark: lambert('#2a2b30'),
      white: new THREE.MeshLambertMaterial({ color: '#f4f4f4', side: THREE.DoubleSide }),
      magnetRed: lambert('#e8262c'),
      rocket: lambert(ITEM_INFO.rocket.color),
      homing: lambert(ITEM_INFO.homing.color),
      blue: lambert(ITEM_INFO.blue.color),
      flameOuter: additive({ color: '#ff7a1a', opacity: 0.85 }),
      flameInner: additive({ color: '#fff0a0', opacity: 0.95 }),
      shieldSkin: additive({ color: ITEM_INFO.shield.color, opacity: 0.16 }),
      shieldWire: additive({ color: ITEM_INFO.shield.color, opacity: 0.55, wireframe: true }),
      swirl: new THREE.MeshBasicMaterial({ color: '#9a5cff', transparent: true, opacity: 0.85, depthWrite: false }),
      oil: new THREE.MeshBasicMaterial({ color: '#120a24', transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
      oilSheen: additive({ color: '#7d5cff', opacity: 0.35, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
      tyres: new THREE.MeshLambertMaterial({ vertexColors: true }),
      mineLight: new THREE.MeshBasicMaterial({ color: '#ff2020' }),
      mineRing: new THREE.MeshBasicMaterial({ color: '#ff4136', transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
      cloud: new THREE.MeshLambertMaterial({ color: '#b8b8b8', transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }),
      shellGlow: additive({ map: glowTex, color: ITEM_INFO.blue.color, opacity: 0.8 }),
    });
    this.buildGeometry();
    for (const m of Object.values(this.mats)) this.disposables.push(m);

    // Boxes: rows across the track, worked out the same way the simulation does.
    this.slots = placeItemBoxes(track).map((b, i) => ({ x: b.x, y: b.y, h: heightAt(b.x, b.y), present: null, changed: -10, phase: i * 1.7 }));
    const n = Math.max(1, this.slots.length);
    this.shellGeo = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
    this.shellGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.shellGeo.getAttribute('position').count * 3), 3));
    const quad = new THREE.PlaneGeometry(1, 1);
    const floor = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.disposables.push(this.shellGeo, quad, floor);
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.count = this.slots.length;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return mesh;
    };
    this.floorGlow = instanced(floor, this.mats.floorGlow, 1);
    this.glow = instanced(quad, this.mats.glow, 2);
    this.question = instanced(quad, this.mats.question, 5);
    this.shell = instanced(this.shellGeo, this.mats.shell, 4);

    this.sparks = new Particles(360, quad, this.mats.sparks, true);
    this.smoke = new Particles(260, quad, this.mats.smoke, true);
    this.shards = new Particles(140, new THREE.TetrahedronGeometry(0.22), this.mats.shards, false);
    this.disposables.push(this.shards.mesh.geometry);
    this.smoke.mesh.renderOrder = 5;
    this.sparks.mesh.renderOrder = 6;
    this.bolts = new Ribbons(400, this.mats.bolts);
    this.cables = new Ribbons(64, this.mats.cable);
    this.bolts.mesh.renderOrder = 7;
    this.disposables.push(this.bolts.mesh.geometry, this.cables.mesh.geometry);

    this.clouds = new THREE.InstancedMesh(this.geos.puff, this.mats.cloud, PUFFS * MAX_CLOUDS);
    this.clouds.count = 0;
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 8;
    this.group.add(this.sparks.mesh, this.smoke.mesh, this.shards.mesh, this.bolts.mesh, this.cables.mesh, this.clouds);
  }

  private buildGeometry(): void {
    const g = this.geos;
    // Rocket: body along +x, nose cone, cross fins; the flame cone points back from x = 0 to -1.
    g.rocketBody = new THREE.CylinderGeometry(0.17, 0.17, 1.1, 8).rotateZ(Math.PI / 2);
    g.rocketNose = new THREE.ConeGeometry(0.17, 0.42, 8).rotateZ(-Math.PI / 2).translate(0.76, 0, 0);
    g.rocketFins = mergeGeometries([new THREE.BoxGeometry(0.34, 0.5, 0.03).translate(-0.42, 0, 0), new THREE.BoxGeometry(0.34, 0.03, 0.5).translate(-0.42, 0, 0)]);
    g.flame = new THREE.ConeGeometry(1, 1, 8).rotateZ(Math.PI / 2).translate(-0.5, 0, 0);
    // Blue shell: a spiky dome on a white rim, with wings.
    g.dome = new THREE.SphereGeometry(0.75, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    g.rim = new THREE.TorusGeometry(0.75, 0.12, 6, 18).rotateX(Math.PI / 2);
    const spikes: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3;
      const dir = new THREE.Vector3(Math.cos(a) * 0.7, 0.7, Math.sin(a) * 0.7).normalize();
      const cone = new THREE.ConeGeometry(0.12, 0.38, 6).translate(0, 0.19, 0);
      cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      spikes.push(cone.translate(dir.x * 0.68, dir.y * 0.68, dir.z * 0.68));
    }
    spikes.push(new THREE.ConeGeometry(0.14, 0.4, 6).translate(0, 0.92, 0));
    g.spikes = mergeGeometries(spikes);
    g.wing = new THREE.PlaneGeometry(0.5, 0.9).rotateX(-Math.PI / 2).translate(0, 0, 0.45);
    // Hook: a U that cups the rear wing, the shaft rising on the near side to an eye for the cable.
    const R = 0.22;
    g.hook = mergeGeometries([
      new THREE.TorusGeometry(R, 0.055, 6, 12, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2),
      new THREE.CylinderGeometry(0.055, 0.055, 0.62, 6).translate(0, 0.31, R),
      new THREE.TorusGeometry(0.1, 0.035, 5, 10).rotateY(Math.PI / 2).translate(0, 0.72, R),
      new THREE.ConeGeometry(0.08, 0.2, 6).translate(0, 0.08, -R),
    ]);
    // Magnet: a red U opening forwards with silver tips.
    g.magnetArc = new THREE.TorusGeometry(0.28, 0.09, 6, 12, Math.PI).rotateX(Math.PI / 2).rotateY(-Math.PI / 2);
    g.magnetArms = mergeGeometries([new THREE.BoxGeometry(0.3, 0.18, 0.18).translate(0.15, 0, -0.28), new THREE.BoxGeometry(0.3, 0.18, 0.18).translate(0.15, 0, 0.28)]);
    g.magnetTips = mergeGeometries([new THREE.BoxGeometry(0.1, 0.19, 0.19).translate(0.34, 0, -0.28), new THREE.BoxGeometry(0.1, 0.19, 0.19).translate(0.34, 0, 0.28)]);
    // Shield: a bubble round the car.
    g.bubble = new THREE.SphereGeometry(1, 20, 12);
    g.bubbleWire = new THREE.IcosahedronGeometry(1.01, 2);
    g.swirl = new THREE.TorusGeometry(2.7, 0.07, 4, 32, Math.PI * 1.2).rotateX(Math.PI / 2);
    // Oil: a dark puddle of blobs, with a sheen.
    g.oil = mergeGeometries([
      new THREE.CircleGeometry(1, 20).scale(2.4, 1.7, 1),
      new THREE.CircleGeometry(1, 14).scale(0.95, 0.75, 1).translate(1.3, 1.1, 0),
      new THREE.CircleGeometry(1, 14).scale(0.85, 0.6, 1).translate(-1.4, -1.0, 0),
    ]).rotateX(-Math.PI / 2);
    g.oilSheen = new THREE.RingGeometry(0.7, 0.95, 20, 1, Math.PI * 0.9, Math.PI * 0.8).scale(1.4, 0.6, 1).rotateX(-Math.PI / 2);
    // Tyre barrier: three stacks of two tyres across the track, red and white tops.
    const tyres: THREE.BufferGeometry[] = [];
    const paint = (geo: THREE.BufferGeometry, color: string) => {
      const c = new THREE.Color(color);
      const count = geo.getAttribute('position').count;
      const col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) col.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return geo;
    };
    [-1.3, 0, 1.3].forEach((z, k) => {
      for (const y of [0.17, 0.5]) tyres.push(paint(new THREE.CylinderGeometry(0.44, 0.44, 0.32, 14).translate(0, y, z), '#151515'));
      tyres.push(paint(new THREE.TorusGeometry(0.3, 0.07, 5, 14).rotateX(Math.PI / 2).translate(0, 0.67, z), k === 1 ? '#ffffff' : '#ff3b30'));
    });
    g.tyres = mergeGeometries(tyres);
    // Mine: a spiked ball and its blast ring.
    const mine: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.42, 10, 6)];
    for (let k = 0; k < 10; k++) {
      const dir = new THREE.Vector3(Math.cos(k * 2.4) * Math.sin(k * 0.9 + 0.4), Math.cos(k * 0.9 + 0.4), Math.sin(k * 2.4) * Math.sin(k * 0.9 + 0.4)).normalize();
      const cone = new THREE.ConeGeometry(0.09, 0.3, 5).translate(0, 0.5, 0);
      mine.push(cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)));
    }
    g.mine = mergeGeometries(mine.map((m) => m.toNonIndexed()));
    g.mineLight = new THREE.SphereGeometry(0.11, 8, 6).translate(0, 0.48, 0);
    g.mineRing = new THREE.RingGeometry(MINE_RADIUS - 0.18, MINE_RADIUS, 48).rotateX(-Math.PI / 2);
    g.puff = new THREE.IcosahedronGeometry(1, 1);
    for (const geo of Object.values(g)) this.disposables.push(geo);
  }

  update(frame: ItemsFrame, camera: THREE.Camera, dt: number, model: (id: string) => CarModel | undefined, ownId: string): void {
    this.time += dt;
    const lifts = new Map(frame.cars.map((c) => [c.id, this.heightAt(c.x, c.y, c.trackIndex)]));
    this.updateBoxes(frame.view, camera);
    this.updateRockets(frame, dt);
    this.updateDrops(frame);
    this.bolts.begin(camera.position);
    this.cables.begin(camera.position);
    this.updateCars(frame, lifts, dt, model, ownId);
    this.bolts.end();
    this.cables.end();
    this.sparks.update(dt, camera);
    this.smoke.update(dt, camera);
    this.shards.update(dt, camera);
  }

  /** Our own car was knocked out just now: shake the camera (s left of the shake, 0 if none). */
  shake(id: string): number {
    const at = this.spins.get(id);
    return at === undefined ? 0 : Math.max(0, SPIN_TIME * 0.6 - (this.time - at));
  }

  private updateBoxes(view: ItemView, camera: THREE.Camera): void {
    const t = this.time;
    // The boxes shimmer: every corner's colour runs round the rainbow.
    const pos = this.shellGeo.getAttribute('position');
    const col = this.shellGeo.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const hue = (t * 0.35 + (pos.getX(i) + pos.getY(i) * 0.7 + pos.getZ(i) * 0.4) * 0.3 + 10) % 1;
      this.c.setHSL(hue, 0.95, 0.62);
      col.setXYZ(i, this.c.r, this.c.g, this.c.b);
    }
    col.needsUpdate = true;
    const pulse = 1 + 0.08 * Math.sin(t * 5);
    this.slots.forEach((slot, i) => {
      const present = view.boxes.some((b) => Math.abs(b.x - slot.x) < 0.5 && Math.abs(b.y - slot.y) < 0.5);
      if (slot.present !== null && present !== slot.present) {
        slot.changed = t;
        if (!present) this.shatter(slot);
      }
      slot.present = present;
      const k = present ? popIn((t - slot.changed) / BOX_POP) : 0;
      const bob = Math.sin(t * 2.2 + slot.phase) * 0.18;
      this.v.set(slot.x, slot.h + BOX_LIFT + bob, slot.y);
      this.q.setFromEuler(this.e.set(t * 0.8 + slot.phase, t * 1.2 + slot.phase, t * 0.45));
      this.shell.setMatrixAt(i, this.m.compose(this.v, this.q, this.s.setScalar(k)));
      this.question.setMatrixAt(i, this.m.compose(this.v, camera.quaternion, this.s.setScalar(k * 1.05 * pulse)));
      this.glow.setMatrixAt(i, this.m.compose(this.v, camera.quaternion, this.s.setScalar(k * 4.6 * pulse)));
      this.v.set(slot.x, slot.h + 0.06, slot.y);
      this.floorGlow.setMatrixAt(i, this.m.compose(this.v, this.q.identity(), this.s.setScalar(k * 3.6 * pulse)));
    });
    for (const mesh of [this.shell, this.question, this.glow, this.floorGlow]) mesh.instanceMatrix.needsUpdate = true;
  }

  /** A box breaks: rainbow shards and a flash. */
  private shatter(slot: BoxSlot): void {
    const y = slot.h + BOX_LIFT;
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 6;
      this.shards.emit(slot.x, y, slot.y, Math.cos(a) * sp, 3 + Math.random() * 6, Math.sin(a) * sp, 0.9, 1.2, 0.8, this.c.setHSL(Math.random(), 0.95, 0.6), -18, 0.5);
    }
    this.sparks.emit(slot.x, y, slot.y, 0, 0, 0, 0.3, 3, 8, '#fff6d0');
  }

  private updateRockets(frame: ItemsFrame, dt: number): void {
    const used: Record<MissileKind, number> = { rocket: 0, homing: 0, blue: 0 };
    const now: { kind: MissileKind; x: number; y: number; h: number }[] = [];
    this.trailClock += dt;
    const puff = this.trailClock >= 1 / 45;
    if (puff) this.trailClock = 0;
    for (const r of frame.view.rockets) {
      const pool = this.rocketPools[r.kind];
      let g = pool[used[r.kind]];
      if (!g) {
        g = r.kind === 'blue' ? this.blueShell() : this.rocket(r.kind);
        pool.push(g);
        this.group.add(g);
      }
      used[r.kind]++;
      g.visible = true;
      const ground = this.heightAt(r.x, r.y);
      const blue = r.kind === 'blue';
      const h = ground + (blue ? SHELL_LIFT + Math.sin(this.time * 6) * 0.25 : ROCKET_LIFT);
      g.position.set(r.x, h, r.y);
      g.rotation.y = -r.heading;
      now.push({ kind: r.kind, x: r.x, y: r.y, h });
      if (blue) {
        const shell = g.userData.shell as THREE.Group;
        shell.rotation.y = this.time * 9;
        const flap = Math.sin(this.time * 22) * 0.6;
        (g.userData.wings as THREE.Mesh[]).forEach((w, k) => (w.rotation.x = (k ? -1 : 1) * (0.3 + flap)));
      } else {
        (g.userData.flame as THREE.Group).scale.set(0.9 + Math.random() * 0.6, 1, 1);
      }
      if (puff) {
        const tail = carPoint({ x: r.x, y: r.y, heading: r.heading }, h, [blue ? -0.6 : -1.1, 0, 0], this.v);
        this.smoke.emit(tail.x, tail.y, tail.z, (Math.random() - 0.5) * 0.6, 0.5, (Math.random() - 0.5) * 0.6, 0.8, 0.5, 1.8, blue ? '#9fc0ff' : '#d8d8d8');
        if (!blue) this.sparks.emit(tail.x, tail.y, tail.z, 0, 0, 0, 0.12, 0.7, 0.3, '#ffa040');
        else this.sparks.emit(tail.x, tail.y, tail.z, 0, 0, 0, 0.25, 1.2, 0.5, '#4f90ff');
      }
    }
    for (const kind of Object.keys(this.rocketPools) as MissileKind[]) this.rocketPools[kind].forEach((g, i) => (g.visible = i < used[kind]));
    // A rocket that vanished hit something: blow it up where it was last seen.
    const left = [...now];
    for (const p of this.prevRockets) {
      const i = left.findIndex((r) => r.kind === p.kind && Math.hypot(r.x - p.x, r.y - p.y) < 25);
      if (i >= 0) left.splice(i, 1);
      else this.explode(p.x, p.h, p.y, p.kind === 'blue' ? 1.6 : 1);
    }
    this.prevRockets = now;
  }

  private rocket(kind: 'rocket' | 'homing'): THREE.Group {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.geos.rocketBody, this.mats[kind]), new THREE.Mesh(this.geos.rocketNose, this.mats.white), new THREE.Mesh(this.geos.rocketFins, this.mats.dark));
    const flame = new THREE.Group();
    flame.position.x = -0.55;
    const outer = new THREE.Mesh(this.geos.flame, this.mats.flameOuter);
    outer.scale.set(1.1, 0.16, 0.16);
    const inner = new THREE.Mesh(this.geos.flame, this.mats.flameInner);
    inner.scale.set(0.6, 0.09, 0.09);
    flame.add(outer, inner);
    g.add(flame);
    g.userData.flame = flame;
    return g;
  }

  private blueShell(): THREE.Group {
    const g = new THREE.Group();
    const shell = new THREE.Group();
    shell.add(new THREE.Mesh(this.geos.dome, this.mats.blue), new THREE.Mesh(this.geos.rim, this.mats.white), new THREE.Mesh(this.geos.spikes, this.mats.white));
    const wings = [-1, 1].map((side) => {
      const w = new THREE.Mesh(this.geos.wing, this.mats.white);
      w.scale.z = side;
      w.position.set(-0.1, 0.35, side * 0.7);
      g.add(w);
      return w;
    });
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: (this.mats.sparks as THREE.MeshBasicMaterial).map, color: ITEM_INFO.blue.color, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(4);
    this.disposables.push(glow.material);
    g.add(shell, glow);
    g.userData.shell = shell;
    g.userData.wings = wings;
    return g;
  }

  /** A fireball with smoke and debris. */
  private explode(x: number, y: number, z: number, size = 1): void {
    this.sparks.emit(x, y, z, 0, 0, 0, 0.3, 3 * size, 9 * size, '#fff3c0');
    for (let k = 0; k < 22; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (3 + Math.random() * 9) * size;
      this.sparks.emit(x, y, z, Math.cos(a) * sp, 1 + Math.random() * 7, Math.sin(a) * sp, 0.4 + Math.random() * 0.4, 1.6 * size, 2.6 * size, Math.random() < 0.5 ? '#ff8a1c' : '#ffd23a', -4, 2.5);
    }
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2;
      this.smoke.emit(x, y, z, Math.cos(a) * 3, 2 + Math.random() * 2, Math.sin(a) * 3, 1.4 + Math.random() * 0.6, 1.5 * size, 4.5 * size, '#5a5a5a', 0, 1.2);
    }
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2;
      this.shards.emit(x, y, z, Math.cos(a) * 8, 4 + Math.random() * 6, Math.sin(a) * 8, 0.9, 1, 0.7, '#2a2a2a', -20, 0.3);
    }
    this.blasts.push({ x, z, t: this.time });
    // A car that stopped just before (online, the two can arrive in either order) was knocked out by it.
    for (const [id, fx] of this.fx) {
      if (fx.froze && this.time - fx.froze.t < 0.6 && Math.hypot(fx.froze.x - x, fx.froze.y - z) < SPIN_RADIUS) this.spins.set(id, this.time);
    }
  }

  private updateDrops(frame: ItemsFrame): void {
    const seen = new Set<string>();
    let puffs = 0;
    for (const d of frame.view.drops) {
      const key = `${d.kind}|${d.x.toFixed(1)}|${d.y.toFixed(1)}`;
      seen.add(key);
      let entry = this.drops.get(key);
      if (!entry) {
        const h = this.heightAt(d.x, d.y);
        // Someone else's mine stays hidden (but its blast shows).
        const obj = d.kind === 'smoke' || (d.kind === 'mine' && d.owner !== frame.viewer) ? null : this.dropModel(d.kind);
        if (obj) {
          obj.position.set(d.x, h, d.y);
          obj.rotation.y = -d.heading;
          this.group.add(obj);
        }
        entry = { kind: d.kind, x: d.x, y: d.y, h, obj, born: this.time, seed: Math.abs(Math.round(d.x * 13 + d.y * 7)) };
        this.drops.set(key, entry);
      }
      if (entry.kind === 'mine' && entry.obj) {
        (entry.obj.userData.light as THREE.Mesh).visible = Math.sin(this.time * 8) > 0;
        (entry.obj.userData.ball as THREE.Object3D).position.y = 0.4 + Math.sin(this.time * 3) * 0.08;
      }
      if (entry.kind === 'oil' && entry.obj) (entry.obj.userData.sheen as THREE.Mesh).rotation.y = this.time * 0.6;
      if (entry.kind === 'smoke' && puffs + PUFFS <= PUFFS * MAX_CLOUDS) {
        // A cloud of big grey puffs that billow out and slowly churn.
        const grow = Math.min(1, (this.time - entry.born) / 0.6);
        for (let k = 0; k < PUFFS; k++) {
          const a = k * 2.39996 + entry.seed + this.time * 0.15;
          const r = k === 0 ? 0 : SMOKE_RADIUS * (0.35 + 0.3 * ((k * 37 + entry.seed) % 10) / 10);
          const size = SMOKE_RADIUS * (k === 0 ? 0.6 : 0.42) * (1 + 0.06 * Math.sin(this.time * 1.5 + k)) * grow;
          this.v.set(entry.x + Math.cos(a) * r * grow, entry.h + size * 0.55 + (k % 3) * 1.2, entry.y + Math.sin(a) * r * grow);
          this.q.setFromEuler(this.e.set(k, this.time * 0.2 + k, 0));
          this.clouds.setMatrixAt(puffs++, this.m.compose(this.v, this.q, this.s.set(size, size * 0.75, size)));
        }
      }
    }
    this.clouds.count = puffs;
    this.clouds.instanceMatrix.needsUpdate = true;
    for (const [key, entry] of this.drops) {
      if (seen.has(key)) continue;
      entry.obj?.removeFromParent();
      this.drops.delete(key);
      // Someone hit it: barriers and mines blow up, oil splashes; smoke just clears.
      if (entry.kind === 'barrier' || entry.kind === 'mine') this.explode(entry.x, entry.h + 0.6, entry.y, entry.kind === 'mine' ? 1.3 : 0.9);
      else if (entry.kind === 'oil') {
        for (let k = 0; k < 14; k++) {
          const a = Math.random() * Math.PI * 2;
          this.shards.emit(entry.x, entry.h + 0.2, entry.y, Math.cos(a) * 5, 2 + Math.random() * 3, Math.sin(a) * 5, 0.6, 0.9, 0.5, '#2a1a50', -16, 0.5);
        }
      }
    }
  }

  private dropModel(kind: DropKind): THREE.Object3D {
    const g = new THREE.Group();
    if (kind === 'oil') {
      const puddle = new THREE.Mesh(this.geos.oil, this.mats.oil);
      puddle.position.y = 0.03;
      const sheen = new THREE.Mesh(this.geos.oilSheen, this.mats.oilSheen);
      sheen.position.y = 0.05;
      g.add(puddle, sheen);
      g.userData.sheen = sheen;
    } else if (kind === 'barrier') {
      g.add(new THREE.Mesh(this.geos.tyres, this.mats.tyres));
    } else {
      const ball = new THREE.Group();
      ball.add(new THREE.Mesh(this.geos.mine, this.mats.dark));
      const light = new THREE.Mesh(this.geos.mineLight, this.mats.mineLight);
      ball.add(light);
      const ring = new THREE.Mesh(this.geos.mineRing, this.mats.mineRing);
      ring.position.y = 0.05;
      g.add(ball, ring);
      g.userData.ball = ball;
      g.userData.light = light;
    }
    return g;
  }

  private carFx(): CarFx {
    const root = new THREE.Group();
    // Flames out of the back (boost, rainbow).
    const flame = new THREE.Group();
    flame.position.set(-2.85, 0.45, 0);
    const outer = new THREE.Mesh(this.geos.flame, this.mats.flameOuter);
    outer.scale.set(1, 0.24, 0.24);
    const inner = new THREE.Mesh(this.geos.flame, this.mats.flameInner);
    inner.scale.set(0.6, 0.12, 0.12);
    flame.add(outer, inner);
    // Shield bubble.
    const shield = new THREE.Group();
    shield.position.y = 0.6;
    shield.scale.set(3.4, 1.7, 2.1);
    shield.add(new THREE.Mesh(this.geos.bubble, this.mats.shieldSkin), new THREE.Mesh(this.geos.bubbleWire, this.mats.shieldWire));
    // Magnet held out in front of the nose.
    const magnet = new THREE.Group();
    magnet.position.set(3.25, 0.7, 0);
    magnet.add(new THREE.Mesh(this.geos.magnetArc, this.mats.magnetRed), new THREE.Mesh(this.geos.magnetArms, this.mats.magnetRed), new THREE.Mesh(this.geos.magnetTips, this.mats.metal));
    // Oil: purple swirls round the sliding car.
    const swirl = new THREE.Group();
    swirl.position.y = 0.12;
    const s2 = new THREE.Mesh(this.geos.swirl, this.mats.swirl);
    s2.rotation.y = Math.PI;
    swirl.add(new THREE.Mesh(this.geos.swirl, this.mats.swirl), s2);
    root.add(flame, shield, magnet, swirl);
    return { root, flame, shield, magnet, swirl, painted: false, zapPrev: 0, strikeUntil: 0, frozenPrev: false, froze: null, last: null };
  }

  private updateCars(frame: ItemsFrame, lifts: Map<string, number>, dt: number, model: (id: string) => CarModel | undefined, ownId: string): void {
    const t = this.time;
    const byId = new Map(frame.cars.map((c) => [c.id, c]));
    const seen = new Set<string>();
    this.blasts = this.blasts.filter((b) => t - b.t < 0.6);
    for (const car of frame.cars) {
      const m = model(car.id);
      if (!m) continue;
      seen.add(car.id);
      let fx = this.fx.get(car.id);
      if (!fx) {
        fx = this.carFx();
        this.fx.set(car.id, fx);
      }
      // The car's model is rebuilt now and then (turning see-through): follow it.
      if (fx.root.parent !== m.group) m.group.add(fx.root);
      const s = car.state;
      const lift = lifts.get(car.id) ?? 0;

      // Teleported: a purple flash where it left and where it landed (not a stopped car being put back on track).
      if (fx.last && !car.frozen && !fx.frozenPrev && t - fx.last.t < 0.25 && Math.hypot(car.x - fx.last.x, car.y - fx.last.y) > JUMP) {
        this.portal(fx.last.x, this.heightAt(fx.last.x, fx.last.y), fx.last.y);
        this.portal(car.x, lift, car.y);
      }
      fx.last = { x: car.x, y: car.y, t };

      // Boost / rainbow: flames.
      const burning = s.boost > 0 || s.star > 0;
      fx.flame.visible = burning;
      if (burning) fx.flame.scale.set((s.boost > 0 ? 1.8 : 1.1) * (0.8 + Math.random() * 0.45), 1, 1);

      // Rainbow: paint that runs through the colours, and sparkles.
      const star = s.star > 0;
      if (star || fx.painted) m.paint(star ? rainbowColor(t, car.id) : null);
      fx.painted = star;
      if (star && Math.random() < dt * 40) {
        const p = carPoint(car, lift, [(Math.random() - 0.5) * 5, 0.3 + Math.random() * 1.2, (Math.random() - 0.5) * 2.4], this.v);
        this.sparks.emit(p.x, p.y, p.z, 0, 1.5, 0, 0.6, 0.7, 0.2, this.c.setHSL(Math.random(), 1, 0.6));
      }

      // Shield: blinks as it runs out.
      fx.shield.visible = s.shield > 0 && (s.shield > 2 || Math.sin(t * 20) > 0);
      if (fx.shield.visible) fx.shield.rotation.y = t * 0.8;

      // Magnet: held out front, field lines flowing to the car it pulls towards.
      fx.magnet.visible = s.magnet > 0;
      const to = s.magnetTo ? byId.get(s.magnetTo) : undefined;
      if (s.magnet > 0) {
        fx.magnet.position.y = 0.7 + Math.sin(t * 6) * 0.06;
        if (to) {
          const a = carPoint(car, lift, [3.6, 0.7, 0]);
          const b = carPoint(to, lifts.get(to.id) ?? 0, [-2.9, 0.6, 0]);
          this.field(a, b);
        }
      }

      // Oil: swirls.
      fx.swirl.visible = s.slip > 0;
      if (s.slip > 0) fx.swirl.rotation.y = t * 9;

      // Lightning: a bolt from the sky when it strikes, then sparks crackling round the car.
      if (s.zap > fx.zapPrev + 0.1 || (s.zap > 0 && fx.zapPrev === 0 && s.zap > ZAP_TIME - 0.5)) {
        fx.strikeUntil = t + 0.35;
        const p = carPoint(car, lift, [0, 1, 0], this.v);
        this.sparks.emit(p.x, p.y, p.z, 0, 0, 0, 0.35, 4, 10, '#fff8b0');
      }
      fx.zapPrev = s.zap;
      if (t < fx.strikeUntil) {
        const ground = carPoint(car, lift, [0, 0.8, 0]);
        const sky = ground.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 70, (Math.random() - 0.5) * 8));
        const main = jagged(sky, ground, 12, 5);
        this.bolts.path(main, 0.9, this.c.set('#fffbd0'));
        this.bolts.path(main, 2.4, this.c.set('#6a5a10'));
        const fork = main[4 + Math.floor(Math.random() * 4)];
        this.bolts.path(jagged(fork, fork.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, -14, (Math.random() - 0.5) * 16)), 4, 3), 0.5, this.c.set('#fff2a0'));
      }
      if (s.zap > 0) {
        for (let k = 0; k < 3; k++) {
          const a = t * 7 + (k * Math.PI * 2) / 3;
          const pts = [0, 1, 2, 3].map((j) => carPoint(car, lift, [Math.cos(a + j * 0.25) * (1.4 + j * 0.5), 0.3 + Math.random() * 0.9, Math.sin(a + j * 0.25) * (0.9 + j * 0.4)]));
          this.bolts.path(pts, 0.14, this.c.set(ITEM_INFO.lightning.color));
        }
      }

      // Hook: thrown from the car behind, it catches this car's rear wing on a cable.
      const hooker = s.hookedBy ? byId.get(s.hookedBy) : undefined;
      let hook = this.hooks.get(car.id);
      if (s.hooked > 0 && hooker) {
        if (!hook) {
          hook = new THREE.Group();
          hook.add(new THREE.Mesh(this.geos.hook, this.mats.metal));
          hook.scale.setScalar(1.6);
          this.hooks.set(car.id, hook);
          this.group.add(hook);
        }
        hook.visible = true;
        const nose = carPoint(hooker, lifts.get(hooker.id) ?? 0, [2.9, 0.35, 0]);
        const wing = carPoint(car, lift, [-2.67, 0.87, 0]);
        const thrown = Math.min(1, (HOOK_TIME - s.hooked) / 0.25);
        hook.position.lerpVectors(nose, wing, thrown);
        hook.lookAt(nose.x, hook.position.y, nose.z);
        hook.updateMatrixWorld();
        const eye = hook.localToWorld(new THREE.Vector3(0, 0.72, 0.22));
        // The cable sags a little, and goes taut as it pulls.
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 10; k++) {
          const u = k / 10;
          pts.push(new THREE.Vector3().lerpVectors(eye, nose, u).add(this.s.set(0, -Math.sin(u * Math.PI) * 0.35 * (1 - thrown * 0.6), 0)));
        }
        this.cables.path(pts, 0.13, this.c.set('#33363c'));
        this.cables.path(pts, 0.05, this.c.set(ITEM_INFO.hook.color));
      } else if (hook) hook.visible = false;

      // Knocked out (stopped right after a blast, or touched by a rainbow car): it spins.
      if (car.frozen && !fx.frozenPrev) {
        fx.froze = { x: car.x, y: car.y, t };
        const blast = this.blasts.some((b) => Math.hypot(car.x - b.x, car.y - b.z) < SPIN_RADIUS);
        const rainbow = frame.cars.some((o) => o !== car && o.state.star > 0 && Math.hypot(o.x - car.x, o.y - car.y) < 8);
        if (blast || rainbow) this.spins.set(car.id, t);
      }
      fx.frozenPrev = car.frozen;
      // Other cars spin round and hop; our own camera shakes instead.
      const at = this.spins.get(car.id);
      if (at !== undefined) {
        const k = (t - at) / SPIN_TIME;
        if (k >= 1) this.spins.delete(car.id);
        else if (car.id !== ownId) {
          m.group.rotation.y -= (1 - (1 - k) * (1 - k)) * Math.PI * 4;
          m.group.position.y += Math.max(0, Math.sin((k / 0.55) * Math.PI)) * 1.3 * (k < 0.55 ? 1 : 0);
        }
      }
    }
    for (const [id, fx] of this.fx) {
      if (seen.has(id)) continue;
      fx.root.removeFromParent();
      this.fx.delete(id);
    }
    for (const [id, hook] of this.hooks) if (!seen.has(id)) hook.visible = false;
  }

  /** Magnet field: three wavy cyan lines flowing from the magnet to the car ahead. */
  private field(a: THREE.Vector3, b: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(b, a);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    for (let line = 0; line < 3; line++) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const u = k / 16;
        const wave = Math.sin(u * 14 - this.time * 18 + line * 2.1) * 0.5 * Math.sin(u * Math.PI);
        pts.push(new THREE.Vector3().lerpVectors(a, b, u).addScaledVector(side, wave).add(this.s.set(0, (line - 1) * 0.3 * Math.sin(u * Math.PI), 0)));
      }
      this.bolts.path(pts, 0.12, this.c.set(ITEM_INFO.magnet.color));
    }
  }

  /** Teleport: a ring of purple sparks and a flash. */
  private portal(x: number, h: number, z: number): void {
    const color = ITEM_INFO.teleport.color;
    this.sparks.emit(x, h + 1, z, 0, 0, 0, 0.4, 2, 9, color);
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      this.sparks.emit(x + Math.cos(a) * 1.5, h + 0.3 + Math.random() * 2, z + Math.sin(a) * 1.5, Math.cos(a) * 7, 1 + Math.random() * 3, Math.sin(a) * 7, 0.6, 0.9, 0.3, color, 0, 2);
    }
  }

  dispose(): void {
    for (const fx of this.fx.values()) fx.root.removeFromParent();
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
