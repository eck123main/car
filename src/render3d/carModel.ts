import * as THREE from 'three';
import { LOST_FRONT_WING, LOST_REAR_WING, LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR, type CarParts } from '../physics/car';
import type { Livery } from '../render/livery';
import { engineRpm, gearFor } from '../audio/sound';
import { COMPOUNDS, type Compound } from '../sim/tyres';
import { QuadBuilder } from './trackMesh';

/**
 * A low-poly F1 car. Local frame: x forward (centre of the car at 0, nose at +2.8), z to the
 * right, y up; the same 5.6 x 1.9 m footprint the physics uses. The body is one vertex-coloured
 * mesh; only the parts that move (front wheels, DRS flap, steering wheel) are separate.
 */

type V3 = [number, number, number];

const CARBON = '#1c1d20';
const TYRE = '#161616';
const DRS_GREEN = '#2ecc40';
/**
 * Steering wheel angle (rad) per 1/m of curvature driven: like a real car, the wheel follows the
 * radius of the corner, so a hairpin (7.5 m, the tightest turn) is about 2 rad and the driver's
 * arms cross, while a fast sweeper is a few degrees.
 */
const WHEEL_PER_CURVATURE = 15;
/** The most the wheel turns (rad, ~130 degrees). */
const WHEEL_MAX = 2.3;
/** How much the steering input itself shows on top (rad at full input), e.g. when understeering. */
const WHEEL_INPUT = 0.35;
/** Turn at full input with the car (nearly) stopped (rad), where the corner radius means nothing. */
const WHEEL_PARKED = 1.2;
/** Catching a slide: only above this speed (m/s), up to this much opposite lock (rad). */
const WHEEL_CATCH_SPEED = 8;
const WHEEL_CATCH = 1.3;
/** Wheel kick per metre of shake (rad): kerbs ~2 degrees, a big hit ~15. */
const WHEEL_KICK = 5;
/** Front wheel turn at full lock (rad), as drawn in 2D. */
const STEER_VISUAL = 0.35;

/** Where the driver's eyes are (car frame). */
export const EYE: V3 = [-0.4, 0.94, 0];

/**
 * Texture coordinates for a mirror showing the [u0, u1] share of the view behind (left to right
 * as the driver sees it). The mirror camera looks backwards, so its picture is flipped.
 */
export function mirrorUv(geo: THREE.BufferGeometry, u0: number, u1: number): void {
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - (u0 + uv.getX(i) * (u1 - u0)));
  uv.needsUpdate = true;
}

/** A box tapering from a rear face at x0 to a front face at x1 (widths, bottoms, tops). */
function tbox(q: QuadBuilder, x0: number, x1: number, w0: number, w1: number, b0: number, t0: number, b1: number, t1: number, color: string, z = 0): void {
  q.box(
    [[x0, b0, z - w0 / 2], [x1, b1, z - w1 / 2], [x1, b1, z + w1 / 2], [x0, b0, z + w0 / 2]],
    [[x0, t0, z - w0 / 2], [x1, t1, z - w1 / 2], [x1, t1, z + w1 / 2], [x0, t0, z + w0 / 2]],
    color,
  );
}

/** A thin square bar from p to q (suspension arms, mirror stalks). */
function strut(q: QuadBuilder, p: V3, r: V3, t: number, color: string): void {
  const d = new THREE.Vector3(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
  const u = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize().multiplyScalar(t / 2);
  const v = new THREE.Vector3().crossVectors(u, d).normalize().multiplyScalar(t / 2);
  const c = (o: V3, su: number, sv: number): V3 => [o[0] + u.x * su + v.x * sv, o[1] + u.y * su + v.y * sv, o[2] + u.z * su + v.z * sv];
  q.box([c(p, -1, -1), c(p, 1, -1), c(r, 1, -1), c(r, -1, -1)], [c(p, -1, 1), c(p, 1, 1), c(r, 1, 1), c(r, -1, 1)], color);
}

function bodyGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  const front = l.front ?? l.body;
  const pods = l.pods ?? l.body;
  // Floor and the plank under it.
  tbox(q, -2.3, 2.0, 1.45, 1.05, 0.03, 0.07, 0.03, 0.07, CARBON);
  // Monocoque ahead of the cockpit, then the nose.
  tbox(q, 0.2, 1.6, 0.66, 0.36, 0.1, 0.62, 0.16, 0.46, front);
  tbox(q, 1.6, 2.6, 0.36, 0.16, 0.16, 0.46, 0.12, 0.27, l.nose);
  if (l.stripe) tbox(q, 0.2, 2.4, 0.14, 0.08, 0.6, 0.625, 0.3, 0.47, l.stripe);
  // Cockpit sides and the tub floor between them.
  for (const z of [-0.34, 0.34]) tbox(q, -0.78, 0.2, 0.12, 0.12, 0.1, 0.64, 0.1, 0.64, front, z);
  tbox(q, -0.78, 0.2, 0.56, 0.56, 0.08, 0.28, 0.08, 0.28, CARBON);
  // Sidepods with dark inlets.
  for (const side of [-1, 1]) {
    const z = side * 0.55;
    tbox(q, -1.35, 0.3, 0.38, 0.44, 0.07, 0.4, 0.07, 0.58, pods, z);
    tbox(q, 0.3, 0.36, 0.44, 0.44, 0.1, 0.56, 0.1, 0.56, '#0d0d0f', z);
    if (l.flash) tbox(q, -1.2, 0.2, 0.39, 0.45, 0.42, 0.46, 0.5, 0.54, l.flash, z + side * 0.005);
    // Mirror on a stalk.
    strut(q, [0.25, 0.55, side * 0.38], [0.3, 0.8, side * 0.62], 0.035, CARBON);
    tbox(q, 0.24, 0.34, 0.24, 0.24, 0.76, 0.87, 0.76, 0.87, l.body, side * 0.68);
  }
  // Engine cover rising to the airbox behind the driver.
  tbox(q, -2.25, -0.78, 0.3, 0.62, 0.07, 0.5, 0.07, 0.96, l.body);
  tbox(q, -0.84, -0.74, 0.28, 0.28, 0.9, 1.05, 0.9, 1.05, '#0d0d0f');
  // Rear wing pylon (the wing itself is separate, it can come off) and the beam wing.
  tbox(q, -2.6, -2.3, 0.06, 0.06, 0.3, 0.84, 0.3, 0.84, CARBON);
  tbox(q, -2.7, -2.45, 0.9, 0.9, 0.36, 0.39, 0.37, 0.4, CARBON);
  // Suspension.
  for (const side of [-1, 1]) {
    strut(q, [1.5, 0.42, side * 0.17], [1.78, 0.42, side * 0.66], 0.04, CARBON);
    strut(q, [2.0, 0.2, side * 0.17], [1.84, 0.24, side * 0.66], 0.04, CARBON);
    strut(q, [-1.4, 0.38, side * 0.3], [-1.72, 0.44, side * 0.6], 0.04, CARBON);
    strut(q, [-1.9, 0.2, side * 0.3], [-1.76, 0.22, side * 0.6], 0.04, CARBON);
  }
  return q.build();
}

/** Front wing (two elements and endplates), in the car's frame; it can be knocked off. */
export function frontWingGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  tbox(q, 2.3, 2.82, 1.9, 1.9, 0.06, 0.1, 0.06, 0.1, l.wings);
  tbox(q, 2.2, 2.48, 1.8, 1.8, 0.16, 0.19, 0.12, 0.15, l.wings);
  for (const z of [-0.94, 0.94]) tbox(q, 2.15, 2.84, 0.04, 0.04, 0.05, 0.32, 0.05, 0.28, l.endplates, z);
  return q.build();
}

/** Rear wing main plane and endplates, in the car's frame (the DRS flap is separate). */
export function rearWingGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  for (const z of [-0.5, 0.5]) tbox(q, -2.86, -2.28, 0.04, 0.04, 0.32, 1.0, 0.32, 0.98, l.endplates, z);
  tbox(q, -2.82, -2.52, 1.0, 1.0, 0.82, 0.87, 0.84, 0.89, l.wings);
  return q.build();
}

/** Damage this small doesn't show. */
const SHOWS_FROM = 0.08;

/** Stable 0..1 noise from a point (1 cm grid), so a dent is the same shape every frame. */
function noise(x: number, y: number, z: number): number {
  const v = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * How far a point of the body is pushed in by damage (car frame: x forward, y up, z right):
 * the sidepods cave in on a damaged side, the nose crumples back with front wing damage and
 * the tail with rear wing damage. Uneven (noise), and a function of position only, so faces
 * that share a corner stay joined.
 */
export function dentAt(x: number, y: number, z: number, d: CarParts): [number, number, number] {
  const n = noise(x, y, z);
  let dx = 0;
  let dy = 0;
  let dz = 0;
  const side = z >= 0 ? d.right : d.left;
  if (side >= SHOWS_FROM) {
    const across = Math.min(1, Math.max(0, (Math.abs(z) - 0.2) / 0.5));
    const along = Math.min(1, Math.max(0, 1 - Math.max(0, Math.abs(x + 0.5) - 1.3) / 0.6));
    const w = side * across * along;
    dz -= Math.sign(z) * 0.16 * w * (0.5 + n);
    dy -= 0.05 * w * n;
  }
  if (d.frontWing >= SHOWS_FROM && x > 1.4) {
    const t = Math.min(1, (x - 1.4) / 1.2) * d.frontWing;
    dx -= 0.28 * t * (0.6 + 0.8 * n);
    dy -= 0.07 * t * n;
    dz += 0.12 * t * (n - 0.5);
  }
  if (d.rearWing >= SHOWS_FROM && x < -1.7) {
    const t = Math.min(1, (-1.7 - x) / 0.6) * d.rearWing;
    dx += 0.14 * t * (0.5 + n);
    dy -= 0.05 * t * n;
  }
  return [dx, dy, dz];
}

type Scuff = { zone: keyof CarParts; at: V3; size: V3; from: number };

/** Bare carbon showing where the bodywork broke: on each sidepod (right listed, left mirrored), the nose and the engine cover. */
const SCUFFS: Scuff[] = [
  ...([
    [-0.4, 0.3, 0.5, 0.12, SHOWS_FROM],
    [0.1, 0.45, 0.3, 0.08, 0.2],
    [-1.0, 0.2, 0.4, 0.1, 0.3],
    [-0.7, 0.48, 0.3, 0.1, 0.45],
    [-1.2, 0.35, 0.25, 0.12, 0.6],
  ] as const).flatMap(([x, y, l, h, from]): Scuff[] => [
    { zone: 'right', at: [x, y, 0.77], size: [l, h, 0.02], from },
    { zone: 'left', at: [x, y, -0.77], size: [l, h, 0.02], from },
  ]),
  { zone: 'frontWing', at: [2.3, 0.33, 0.03], size: [0.25, 0.02, 0.1], from: SHOWS_FROM },
  { zone: 'frontWing', at: [1.95, 0.4, -0.05], size: [0.3, 0.02, 0.12], from: 0.3 },
  { zone: 'frontWing', at: [2.45, 0.3, -0.02], size: [0.15, 0.02, 0.08], from: 0.55 },
  { zone: 'rearWing', at: [-2.1, 0.55, 0.05], size: [0.2, 0.02, 0.12], from: SHOWS_FROM },
  { zone: 'rearWing', at: [-1.8, 0.65, -0.06], size: [0.25, 0.02, 0.1], from: 0.35 },
];

/** Halo: the hoop round the driver's head, the centre pillar and the rear legs. */
function haloParts(): THREE.BufferGeometry[] {
  const hoop = new THREE.TorusGeometry(0.32, 0.028, 6, 18, Math.PI);
  hoop.rotateX(-Math.PI / 2);
  hoop.rotateY(-Math.PI / 2);
  hoop.translate(-0.42, 1.06, 0);
  const bar = (p: THREE.Vector3, r: THREE.Vector3, radius: number) => {
    const g = new THREE.CylinderGeometry(radius, radius, p.distanceTo(r), 6);
    g.translate(0, p.distanceTo(r) / 2, 0);
    // Cylinder axis is y; aim it from p to r.
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), r.clone().sub(p).normalize());
    g.applyQuaternion(quat);
    g.translate(p.x, p.y, p.z);
    return g;
  };
  return [
    hoop,
    bar(new THREE.Vector3(-0.1, 1.06, 0), new THREE.Vector3(0.5, 0.62, 0), 0.03),
    bar(new THREE.Vector3(-0.42, 1.06, -0.32), new THREE.Vector3(-0.66, 0.62, -0.3), 0.026),
    bar(new THREE.Vector3(-0.42, 1.06, 0.32), new THREE.Vector3(-0.66, 0.62, 0.3), 0.026),
  ];
}

interface Materials {
  body: THREE.MeshLambertMaterial;
  carbon: THREE.Material;
  tyre: THREE.Material;
  ring: THREE.MeshLambertMaterial;
  wing: THREE.MeshLambertMaterial;
  helmet: THREE.Material;
  disc: THREE.MeshLambertMaterial;
  visor: THREE.Material;
}

/**
 * Brake disc heat (0-1): builds up while braking hard from speed, cools off over a few seconds.
 * Glows orange past ~0.25 (see `discGlow`).
 */
export function brakeHeat(heat: number, brake: number, speed: number, dt: number): number {
  const warming = brake * Math.min(1, speed / 60) * 0.9;
  return Math.max(0, Math.min(1, heat + (warming - heat * 0.45) * dt));
}

/** How brightly the discs glow (0-1) at a heat. */
export function discGlow(heat: number): number {
  return Math.max(0, Math.min(1, (heat - 0.25) / 0.6));
}

const DISC_DARK = new THREE.Color('#34312e');
const DISC_HOT = new THREE.Color('#ff5a10');

const shared = {
  wheelFront: null as THREE.BufferGeometry | null,
  wheelRear: null as THREE.BufferGeometry | null,
  shadow: null as THREE.Mesh | null,
  scuff: null as THREE.BufferGeometry | null,
};

function wheelGeometry(radius: number, width: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, width, 16);
  g.rotateX(Math.PI / 2);
  return g;
}

export class CarModel {
  readonly group = new THREE.Group();
  private readonly frontWheels: THREE.Group[] = [];
  /** Wheels FL, FR, RL, RR and the wings, hidden when knocked off. */
  private readonly wheels: THREE.Group[] = [];
  private readonly frontWing: THREE.Mesh;
  private readonly rearWing = new THREE.Group();
  /** The wings hang from these, so damage can droop and twist them about where they're fixed. */
  private readonly frontWingMount = new THREE.Group();
  private readonly rearWingMount = new THREE.Group();
  private lost = 0;
  /** The undamaged body, and the damage it was last bent to (rounded). */
  private readonly basePositions: Float32Array;
  private damageKey = '';
  private readonly scuffs: { mesh: THREE.Mesh; scuff: Scuff }[] = [];
  /** Wheels turned out of line by a broken suspension (rad, FL FR RL RR). */
  private readonly toe = [0, 0, 0, 0];
  private readonly flap: THREE.Mesh;
  private readonly helmet: THREE.Mesh;
  private readonly head = new THREE.Group();
  private readonly miniWheel: THREE.Mesh;
  private glow = -1;
  private readonly halo = new THREE.Group();
  private readonly mirrors = new THREE.Group();
  private mirrorMat: THREE.Material | null = null;
  private readonly mats: Materials;
  private readonly bodyGeo: THREE.BufferGeometry;
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly wingBase: string;
  private compound: Compound | null = null;
  private drs = false;
  private painted: string | null = null;
  private readonly ghost: boolean;
  private readonly livery: Livery;
  wheel: SteeringWheel | null = null;

  /** ghost: see-through in this colour (opacity: how see-through; party mode's ghost item is nearly invisible). */
  constructor(livery: Livery, opts: { ghost?: string; opacity?: number } = {}) {
    const ghost = opts.ghost;
    this.ghost = !!ghost;
    this.livery = livery;
    this.wingBase = ghost ?? livery.wings;
    const opacity = opts.opacity ?? 0.35;
    const lambert = (p: THREE.MeshLambertMaterialParameters) =>
      new THREE.MeshLambertMaterial(ghost ? { color: ghost, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide } : { side: THREE.DoubleSide, ...p });
    this.mats = {
      body: lambert({ vertexColors: true }),
      carbon: lambert({ color: CARBON }),
      tyre: lambert({ color: TYRE }),
      ring: lambert({ color: '#ffffff' }) as THREE.MeshLambertMaterial,
      wing: lambert({ color: livery.wings }) as THREE.MeshLambertMaterial,
      helmet: lambert({ color: livery.helmet }),
      disc: lambert({ color: DISC_DARK }) as THREE.MeshLambertMaterial,
      visor: lambert({ color: '#0b0c10' }),
    };
    this.bodyGeo = bodyGeometry(livery);
    this.basePositions = (this.bodyGeo.getAttribute('position').array as Float32Array).slice();
    this.group.add(new THREE.Mesh(this.bodyGeo, this.mats.body));
    shared.scuff ??= new THREE.BoxGeometry(1, 1, 1);
    for (const scuff of SCUFFS) {
      const mesh = new THREE.Mesh(shared.scuff, this.mats.carbon);
      mesh.scale.set(...scuff.size);
      mesh.visible = false;
      this.group.add(mesh);
      this.scuffs.push({ mesh, scuff });
    }
    for (const g of haloParts()) {
      this.owned.push(g);
      this.halo.add(new THREE.Mesh(g, this.mats.carbon));
    }
    this.group.add(this.halo);
    const helmetGeo = new THREE.SphereGeometry(0.15, 12, 8);
    this.owned.push(helmetGeo);
    // The driver's head: helmet with a dark visor, so you can see it turn into corners.
    this.helmet = new THREE.Mesh(helmetGeo, this.mats.helmet);
    const visorGeo = new THREE.BoxGeometry(0.06, 0.06, 0.2);
    this.owned.push(visorGeo);
    const visor = new THREE.Mesh(visorGeo, this.mats.visor);
    visor.position.set(0.115, 0.02, 0);
    this.head.add(this.helmet, visor);
    this.head.position.set(-0.42, 0.78, 0);
    this.group.add(this.head);
    // A small steering wheel for other cars' drivers (our own car gets the full one).
    const miniGeo = new THREE.BoxGeometry(0.03, 0.12, 0.26);
    this.owned.push(miniGeo);
    this.miniWheel = new THREE.Mesh(miniGeo, this.mats.carbon);
    this.miniWheel.position.set(0.02, 0.74, 0);
    this.miniWheel.rotation.z = 0.35;
    this.group.add(this.miniWheel);

    // DRS flap, hinged at its leading edge.
    const flapGeo = new THREE.BoxGeometry(0.22, 0.035, 1.0);
    flapGeo.translate(0.11, 0, 0);
    this.owned.push(flapGeo);
    this.flap = new THREE.Mesh(flapGeo, this.mats.wing);
    this.flap.position.set(-2.52, 0.93, 0);
    this.rearWing.add(this.flap);
    const frontWingGeo = frontWingGeometry(livery);
    const rearWingGeo = rearWingGeometry(livery);
    this.owned.push(frontWingGeo, rearWingGeo);
    this.frontWing = new THREE.Mesh(frontWingGeo, this.mats.body);
    this.rearWing.add(new THREE.Mesh(rearWingGeo, this.mats.body));
    this.frontWingMount.position.set(2.3, 0.1, 0);
    this.frontWing.position.set(-2.3, -0.1, 0);
    this.frontWingMount.add(this.frontWing);
    this.rearWingMount.position.set(-2.55, 0.33, 0);
    this.rearWing.position.set(2.55, -0.33, 0);
    this.rearWingMount.add(this.rearWing);
    this.group.add(this.frontWingMount, this.rearWingMount);

    shared.wheelFront ??= wheelGeometry(0.33, 0.36);
    shared.wheelRear ??= wheelGeometry(0.36, 0.42);
    const ring = new THREE.TorusGeometry(0.24, 0.025, 4, 16);
    // Brake disc seen through the wheel rim; glows orange when hot.
    const disc = new THREE.CircleGeometry(0.15, 12);
    this.owned.push(ring, disc);
    const addWheel = (x: number, y: number, z: number, geo: THREE.BufferGeometry, width: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.add(new THREE.Mesh(geo, this.mats.tyre));
      const r = new THREE.Mesh(ring, this.mats.ring);
      r.position.z = Math.sign(z) * (width / 2 + 0.005);
      const d = new THREE.Mesh(disc, this.mats.disc);
      d.position.z = Math.sign(z) * (width / 2 + 0.003);
      if (z < 0) d.rotation.y = Math.PI;
      g.add(r, d);
      this.group.add(g);
      this.wheels.push(g);
      return g;
    };
    this.frontWheels.push(addWheel(1.8, 0.33, -0.75, shared.wheelFront, 0.36), addWheel(1.8, 0.33, 0.75, shared.wheelFront, 0.36));
    addWheel(-1.75, 0.36, -0.73, shared.wheelRear, 0.42);
    addWheel(-1.75, 0.36, 0.73, shared.wheelRear, 0.42);

    if (!ghost) {
      shared.shadow ??= new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 2.0).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      );
      const shadow = shared.shadow.clone();
      shadow.position.y = 0.01;
      this.group.add(shadow);
    }
  }

  /** The car in the world: sim (x, y, heading) maps to three.js (x, z) and a turn about y. */
  update(x: number, y: number, heading: number, steer: number, drsOpen: boolean, compound: Compound): void {
    this.group.position.set(x, 0, y);
    this.group.rotation.y = -heading;
    this.frontWheels.forEach((w, i) => (w.rotation.y = -steer * STEER_VISUAL + this.toe[i]));
    // The driver looks into the corner and leans out of it; their wheel turns.
    this.head.rotation.set(-steer * 0.12, -steer * 0.35, 0);
    this.miniWheel.rotation.x = steer * 1.2;
    if (drsOpen !== this.drs) {
      this.drs = drsOpen;
      this.flap.rotation.z = drsOpen ? 0.7 : 0;
      this.mats.wing.color.set(drsOpen ? DRS_GREEN : this.wingBase);
    }
    if (compound !== this.compound) {
      this.compound = compound;
      this.mats.ring.color.set(COMPOUNDS[compound].color);
    }
  }

  /** Hide parts that were knocked off (Car.lost bits). */
  setLost(lost: number): void {
    if (lost === this.lost) return;
    this.lost = lost;
    this.frontWing.visible = !(lost & LOST_FRONT_WING);
    this.rearWing.visible = !(lost & LOST_REAR_WING);
    [LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR].forEach((bit, i) => (this.wheels[i].visible = !(lost & bit)));
  }

  /**
   * Show damage (Car.parts, 0-1): the body dented in where it was hit, bare carbon showing,
   * wings drooping and twisted back on the side that hit, wheels out of line from 0.4.
   */
  setDamage(d: CarParts): void {
    const q = (v: number) => (v < SHOWS_FROM ? 0 : Math.round(v * 20) / 20);
    const parts: CarParts = { frontWing: q(d.frontWing), rearWing: q(d.rearWing), left: q(d.left), right: q(d.right) };
    const key = `${parts.frontWing}|${parts.rearWing}|${parts.left}|${parts.right}`;
    if (key === this.damageKey) return;
    this.damageKey = key;
    // Dents: move each corner of the body from where it was built.
    const pos = this.bodyGeo.getAttribute('position') as THREE.BufferAttribute;
    const base = this.basePositions;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < base.length; i += 3) {
      const [dx, dy, dz] = dentAt(base[i], base[i + 1], base[i + 2], parts);
      arr[i] = base[i] + dx;
      arr[i + 1] = base[i + 1] + dy;
      arr[i + 2] = base[i + 2] + dz;
    }
    pos.needsUpdate = true;
    this.bodyGeo.computeVertexNormals();
    this.bodyGeo.computeBoundingSphere();
    for (const { mesh, scuff } of this.scuffs) {
      mesh.visible = parts[scuff.zone] >= scuff.from;
      if (!mesh.visible) continue;
      const [x, y, z] = scuff.at;
      const [dx, dy, dz] = dentAt(x, y, z, parts);
      mesh.position.set(x + dx, y + dy, z + dz);
    }
    // Wings: the side that took the hit (z+ = right) droops and is pushed back.
    const side = parts.left > parts.right ? -1 : 1;
    this.frontWingMount.rotation.set(side * parts.frontWing * 0.2, -side * parts.frontWing * 0.18, -parts.frontWing * 0.1);
    this.rearWingMount.rotation.set(side * parts.rearWing * 0.25, side * parts.rearWing * 0.2, parts.rearWing * 0.15);
    // Broken suspension: the wheel leans and turns out of line.
    [parts.left, parts.right, parts.left, parts.right].forEach((v, i) => {
      const bent = Math.max(0, v - 0.4);
      const s = i % 2 === 0 ? -1 : 1;
      this.wheels[i].rotation.x = s * bent * 0.6;
      this.toe[i] = s * bent * 0.5 * (i < 2 ? -1 : 1);
      if (i >= 2) this.wheels[i].rotation.y = this.toe[i];
    });
  }

  /** Paint the whole body one glowing colour (party mode's rainbow), or null for the livery again. */
  paint(color: string | null): void {
    if (this.ghost || color === this.painted) return;
    const body = this.mats.body;
    if ((color === null) !== (this.painted === null)) {
      body.vertexColors = color === null;
      body.needsUpdate = true;
    }
    this.painted = color;
    body.color.set(color ?? '#ffffff');
    body.emissive.set(color ?? '#000000').multiplyScalar(color ? 0.45 : 0);
  }

  /** Inside the car: the helmet would fill the view. */
  set driverVisible(on: boolean) {
    this.head.visible = on;
  }

  /** Brake disc heat (0-1, from `brakeHeat`): hot discs glow orange. */
  setBrakeHeat(heat: number): void {
    const glow = Math.round(discGlow(heat) * 20) / 20;
    if (glow === this.glow || this.ghost) return;
    this.glow = glow;
    this.mats.disc.color.copy(DISC_DARK).lerp(DISC_HOT, glow);
    this.mats.disc.emissive.copy(DISC_HOT).multiplyScalar(glow * 0.9);
  }

  /** Some cameras hide the halo: its centre pillar blocks the middle of the view. */
  set haloVisible(on: boolean) {
    this.halo.visible = on;
  }

  /** Glass on both wing mirrors showing the view behind (own car only). */
  addMirrorGlass(view: THREE.Texture): void {
    const mat = new THREE.MeshBasicMaterial({ map: view });
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(0.22, 0.09);
      // Left mirror: the left half of what's behind; right mirror: the right half.
      mirrorUv(geo, side < 0 ? 0 : 0.5, side < 0 ? 0.5 : 1);
      // Facing back at the driver.
      geo.rotateY(-Math.PI / 2);
      this.owned.push(geo);
      const glass = new THREE.Mesh(geo, mat);
      glass.position.set(0.235, 0.815, side * 0.68);
      this.mirrors.add(glass);
    }
    this.mirrorMat = mat;
    this.group.add(this.mirrors);
  }

  set mirrorsVisible(on: boolean) {
    this.mirrors.visible = on;
  }

  /** Add the steering wheel and the driver's arms on it (own car only). */
  addSteeringWheel(): SteeringWheel {
    this.wheel = new SteeringWheel(this.livery);
    this.miniWheel.visible = false;
    this.group.add(this.wheel.group, this.wheel.arms);
    return this.wheel;
  }

  dispose(): void {
    this.bodyGeo.dispose();
    for (const g of this.owned) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.wheel?.dispose();
    this.mirrorMat?.dispose();
  }
}

/**
 * Steering wheel angle (rad, + = clockwise as the driver sees it) for the car's own movement:
 * mostly the radius of the turn it is really making (yaw rate / speed), plus a little of the
 * steering input. Stopped, it is just the input.
 */
export function wheelAngle(steer: number, speed: number, yawRate: number, slip = 0, upset = 0): number {
  const moving = Math.min(1, Math.max(0, (speed - 1) / 4));
  const curvature = yawRate / Math.max(speed, 1);
  const driven = curvature * WHEEL_PER_CURVATURE + steer * WHEEL_INPUT;
  let angle = moving * driven + (1 - moving) * steer * WHEEL_PARKED;
  // Sliding after a hit: the driver catches it, steering the way the car is really going.
  if (speed > WHEEL_CATCH_SPEED) {
    const catching = Math.max(Math.min(1, upset * 3), Math.min(1, Math.max(0, (Math.abs(slip) - 0.12) / 0.2)));
    const opposite = Math.max(-WHEEL_CATCH, Math.min(WHEEL_CATCH, slip * 2.5));
    angle += (opposite - angle) * catching;
  }
  return Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, angle));
}

/** Right shoulder (car frame; the left is mirrored) and arm lengths (m). */
const SHOULDER: V3 = [-0.46, 0.66, 0.17];
const UPPER_ARM = 0.29;
const FOREARM = 0.28;
/** The elbows hang down and out a little, inside the cockpit sides. */
const ELBOW_POLE = new THREE.Vector3(0, -1, 0.6).normalize();
/** Where the forearm meets the right glove (wheel frame). */
const WRIST: V3 = [-0.05, -0.025, 0.155];
/** A paddle flick lasts this long (s). */
const FLICK = 0.14;

/**
 * Elbow for a two-bone arm from shoulder s to wrist w, bending towards `pole` (its part across
 * the arm). The arm is never stretched past straight.
 */
export function elbowFor(s: THREE.Vector3, w: THREE.Vector3, upper: number, fore: number, pole: THREE.Vector3): THREE.Vector3 {
  const dir = w.clone().sub(s);
  const d = Math.min(Math.max(dir.length(), 1e-4), upper + fore - 1e-4);
  dir.normalize();
  const a = (upper * upper - fore * fore + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const across = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (across.lengthSq() < 1e-8) across.set(0, -1, 0);
  across.normalize();
  return s.clone().addScaledVector(dir, a).addScaledVector(across, h);
}

/** Steering wheel hub (car frame) and how far it is tilted back towards the driver (rad). */
const WHEEL_POS: V3 = [0.03, 0.755, 0];
const WHEEL_TILT = 0.35;

/** Shoulder, elbow and wrist (car frame) of one arm (side -1 left, 1 right) with the wheel at `angle`. */
export function armJoints(angle: number, side: number): { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3 } {
  // The arm going over the top of the wheel (left in a right turn) rolls its shoulder forward.
  const reach = Math.max(0, angle * -side) / WHEEL_MAX;
  const shoulder = new THREE.Vector3(SHOULDER[0] + 0.04 * reach, SHOULDER[1], side * (SHOULDER[2] - 0.02 * reach));
  const wrist = new THREE.Vector3(WRIST[0], WRIST[1], side * WRIST[2])
    .applyAxisAngle(new THREE.Vector3(0, 0, 1), WHEEL_TILT)
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), angle)
    .add(new THREE.Vector3(...WHEEL_POS));
  const pole = new THREE.Vector3(ELBOW_POLE.x, ELBOW_POLE.y, side * ELBOW_POLE.z);
  return { shoulder, elbow: elbowFor(shoulder, wrist, UPPER_ARM, FOREARM, pole), wrist };
}

/** What the steering wheel's display shows. */
export interface WheelInfo {
  speedKmh: number;
  drsOpen: boolean;
  drsAvailable: boolean;
  ers: number;
  ersActive: boolean;
  limiter: boolean;
  /** For the revs on the shift lights (0-1). */
  throttle?: number;
  /** Tyres: compound letter and wear (0-1). */
  tyre?: string;
  wear?: number;
  /** Live gap to the best lap or ghost (s, - = ahead). */
  delta?: number | null;
  /** A short message over the display (BOX, SC, +5s). */
  message?: { text: string; color: string } | null;
  /** Flag shown on the shift lights. */
  flag?: LedFlag;
}

export type LedFlag = 'yellow' | 'green' | null;

/** Shift lights: how many of the 15 LEDs are lit at these revs, or 16 = all flashing (shift now). */
export const SHIFT_LEDS = 15;
export function shiftLights(rpm: number): number {
  if (rpm >= 11650) return SHIFT_LEDS + 1;
  return Math.max(0, Math.min(SHIFT_LEDS, Math.ceil(((rpm - 9300) / (11650 - 9300)) * SHIFT_LEDS)));
}
const LED_COLORS = ['#20e040', '#ff2a2a', '#7a5cff'];
const LED_FLAG = { yellow: '#ffd400', green: '#20e040' };
const LED_DRS = '#2f8fff';

/**
 * What each shift light shows (null = off). A flag takes over all of them, flashing, so it can't
 * be missed; DRS ready flashes the two lights at each end blue, over the revs.
 */
export function ledColors(lit: number, flag: LedFlag, drsReady: boolean, blink: boolean): (string | null)[] {
  const out: (string | null)[] = [];
  const shift = lit > SHIFT_LEDS;
  for (let i = 0; i < SHIFT_LEDS; i++) {
    if (flag) out.push(blink ? LED_FLAG[flag] : null);
    else if (drsReady && blink && (i < 2 || i >= SHIFT_LEDS - 2)) out.push(LED_DRS);
    else if (shift) out.push(blink ? LED_COLORS[2] : null);
    else out.push(i < lit ? LED_COLORS[Math.floor(i / 5)] : null);
  }
  return out;
}


/** One gloved hand on a grip, and the arm to it. */
interface Hand {
  fingers: THREE.Mesh;
  thumb: THREE.Mesh;
  thumbRest: THREE.Vector3;
  paddle: THREE.Mesh;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  cuff: THREE.Mesh;
  /** Time left on a paddle flick / thumb press (s). */
  flick: number;
  press: number;
}

/**
 * The F1 steering wheel in front of the driver, with a small live display, and the driver's
 * arms and gloved hands on it. Like real F1 drivers, the hands never leave the grips: in a
 * hairpin the wheel goes past 90 degrees and the arms cross. Fingers flick the paddles on gear
 * changes (right up, left down), the right thumb presses DRS and the left holds the ERS button.
 */
export class SteeringWheel {
  readonly group = new THREE.Group();
  /** Upper arms and forearms, in the car's frame (they don't turn with the wheel). */
  readonly arms = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly disposables: { dispose(): void }[] = [];
  private readonly hands: Hand[] = [];
  private last = '';
  private angle = 0;
  private kick = 0;
  private gear = 1;
  private drs = false;
  private readonly ledCanvas = document.createElement('canvas');
  private readonly ledCtx: CanvasRenderingContext2D;
  private readonly ledTex: THREE.CanvasTexture;
  private lit = '';

  constructor(livery?: Livery) {
    this.group.position.set(...WHEEL_POS);
    // Tilted back towards the driver.
    const inner = this.inner;
    inner.rotation.z = WHEEL_TILT;
    this.group.add(inner);
    const mat = new THREE.MeshLambertMaterial({ color: '#202124' });
    const grip = new THREE.MeshLambertMaterial({ color: '#0e0e0f' });
    const body = new THREE.BoxGeometry(0.04, 0.13, 0.24);
    const handle = new THREE.BoxGeometry(0.05, 0.17, 0.05);
    this.disposables.push(mat, grip, body, handle);
    inner.add(new THREE.Mesh(body, mat));
    // Trim along the top of the wheel, in the car's colours.
    const trimGeo = new THREE.BoxGeometry(0.043, 0.012, 0.24);
    const trimMat = new THREE.MeshLambertMaterial({ color: livery?.wings ?? '#50525a' });
    this.disposables.push(trimGeo, trimMat);
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.y = 0.068;
    inner.add(trim);
    for (const z of [-0.14, 0.14]) {
      const h = new THREE.Mesh(handle, grip);
      h.position.set(0, -0.01, z);
      inner.add(h);
    }
    this.canvas.width = 256;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(2, 2);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const screenGeo = new THREE.PlaneGeometry(0.13, 0.065);
    const screenMat = new THREE.MeshBasicMaterial({ map: this.tex });
    this.disposables.push(this.tex, screenGeo, screenMat);
    const screen = new THREE.Mesh(screenGeo, screenMat);
    // Facing the driver (back along -x).
    screen.rotation.y = -Math.PI / 2;
    screen.position.set(-0.021, 0.01, 0);
    inner.add(screen);
    // Shift lights in a row across the top of the wheel: green, red, then blue.
    this.ledCanvas.width = 128;
    this.ledCanvas.height = 8;
    this.ledCtx = this.ledCanvas.getContext('2d')!;
    this.ledTex = new THREE.CanvasTexture(this.ledCanvas);
    this.ledTex.colorSpace = THREE.SRGBColorSpace;
    const ledGeo = new THREE.PlaneGeometry(0.2, 0.0125);
    const ledMat = new THREE.MeshBasicMaterial({ map: this.ledTex });
    this.disposables.push(this.ledTex, ledGeo, ledMat);
    const leds = new THREE.Mesh(ledGeo, ledMat);
    leds.rotation.y = -Math.PI / 2;
    leds.position.set(-0.021, 0.056, 0);
    inner.add(leds);
    this.buildHands(livery);
  }

  private buildHands(livery?: Livery): void {
    const suit = new THREE.MeshLambertMaterial({ color: livery?.body ?? '#c0c0c0' });
    // Gloves: white, tinted with the helmet colour, so they go with the skin.
    const glove = new THREE.MeshLambertMaterial({ color: new THREE.Color('#e9e9ec').lerp(new THREE.Color(livery?.helmet ?? '#e9e9ec'), 0.4) });
    const accent = new THREE.MeshLambertMaterial({ color: livery?.helmet ?? '#333333' });
    const paddleMat = new THREE.MeshLambertMaterial({ color: '#3a3b40' });
    const palmGeo = new THREE.BoxGeometry(0.075, 0.1, 0.07);
    const fingerGeo = new THREE.BoxGeometry(0.03, 0.09, 0.062);
    const thumbGeo = new THREE.BoxGeometry(0.026, 0.028, 0.06);
    const knuckleGeo = new THREE.BoxGeometry(0.012, 0.075, 0.04);
    const paddleGeo = new THREE.BoxGeometry(0.008, 0.07, 0.07);
    // Arm pieces are 1 m long along +y from their base, scaled to length each frame.
    const upperGeo = new THREE.CylinderGeometry(0.042, 0.048, 1, 7).translate(0, 0.5, 0);
    const foreGeo = new THREE.CylinderGeometry(0.033, 0.042, 1, 7).translate(0, 0.5, 0);
    const cuffGeo = new THREE.CylinderGeometry(0.037, 0.037, 0.05, 7);
    this.disposables.push(suit, glove, accent, paddleMat, palmGeo, fingerGeo, thumbGeo, knuckleGeo, paddleGeo, upperGeo, foreGeo, cuffGeo);
    for (const side of [-1, 1]) {
      // Glove round the grip: palm on the driver's side and outside, fingers round the front.
      const palm = new THREE.Mesh(palmGeo, glove);
      palm.position.set(-0.022, -0.005, side * 0.152);
      const knuckles = new THREE.Mesh(knuckleGeo, accent);
      knuckles.position.set(-0.06, -0.005, side * 0.158);
      const fingers = new THREE.Mesh(fingerGeo, glove);
      fingers.position.set(0.035, -0.005, side * 0.148);
      // Thumb resting on the wheel's face, pointing in towards the display.
      const thumbRest = new THREE.Vector3(-0.032, 0.04, side * 0.112);
      const thumb = new THREE.Mesh(thumbGeo, glove);
      thumb.position.copy(thumbRest);
      thumb.rotation.x = side * 0.35;
      // Shift paddle behind the wheel (right: up, left: down), under the fingertips.
      const paddle = new THREE.Mesh(paddleGeo, paddleMat);
      paddle.position.set(0.058, 0.035, side * 0.1);
      this.inner.add(palm, knuckles, fingers, thumb, paddle);
      const upper = new THREE.Mesh(upperGeo, suit);
      const fore = new THREE.Mesh(foreGeo, suit);
      const cuff = new THREE.Mesh(cuffGeo, accent);
      this.arms.add(upper, fore, cuff);
      this.hands.push({ fingers, thumb, thumbRest, paddle, upper, fore, cuff, flick: 0, press: 0 });
    }
  }

  /** Turn the wheel for the car's movement and move the hands (every frame). */
  drive(steer: number, speed: number, yawRate: number, info: WheelInfo, dt: number, shake = 0, slip = 0, upset = 0): void {
    // The hands ease the wheel round: quick, but never a snap. Kerbs and hits kick it about,
    // on top of where the hands are taking it.
    const target = wheelAngle(steer, speed, yawRate, slip, upset);
    this.angle += (target - this.angle) * Math.min(1, dt * 14);
    this.kick = shake * WHEEL_KICK * (Math.random() * 2 - 1);
    this.group.rotation.x = this.angle + this.kick;

    const [left, right] = this.hands;
    const gear = gearFor(info.speedKmh);
    if (gear > this.gear) right.flick = FLICK;
    else if (gear < this.gear) left.flick = FLICK;
    this.gear = gear;
    if (info.drsOpen && !this.drs) right.press = 0.22;
    this.drs = info.drsOpen;
    if (info.ersActive) left.press = Math.max(left.press, 0.05);

    for (const [i, hand] of this.hands.entries()) {
      const side = i === 0 ? -1 : 1;
      hand.flick = Math.max(0, hand.flick - dt);
      hand.press = Math.max(0, hand.press - dt);
      // Fingers pull the paddle back towards the wheel, then let go.
      const f = Math.sin((hand.flick / FLICK) * Math.PI);
      hand.paddle.position.x = 0.058 - 0.022 * f;
      hand.fingers.rotation.z = 0.5 * f;
      // Thumb pushes forward onto a button.
      const p = hand.press > 0 ? 1 : 0;
      hand.thumb.position.set(hand.thumbRest.x + 0.012 * p, hand.thumbRest.y - 0.012 * p, hand.thumbRest.z - side * 0.008 * p);
    }
    this.placeArms();
  }

  /** Arms from the shoulders to the gloves, wherever the wheel has taken them. */
  private placeArms(): void {
    const up = new THREE.Vector3(0, 1, 0);
    const segment = (mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
      const d = b.clone().sub(a);
      mesh.position.copy(a);
      mesh.scale.set(1, d.length(), 1);
      mesh.quaternion.setFromUnitVectors(up, d.normalize());
    };
    for (const [i, hand] of this.hands.entries()) {
      const { shoulder, elbow, wrist } = armJoints(this.angle + this.kick, i === 0 ? -1 : 1);
      segment(hand.upper, shoulder, elbow);
      segment(hand.fore, elbow, wrist);
      hand.cuff.position.copy(wrist);
      hand.cuff.quaternion.copy(hand.fore.quaternion);
    }
  }

  show(info: WheelInfo): void {
    this.showLeds(shiftLights(engineRpm(info.speedKmh, info.throttle ?? 0)), info.flag ?? null, info.drsAvailable);
    const delta = info.delta == null ? null : Math.round(info.delta * 10) / 10;
    const wear = Math.round((info.wear ?? 0) * 100);
    const key = `${gearFor(info.speedKmh)}|${Math.round(info.speedKmh)}|${info.drsOpen}|${info.drsAvailable}|${Math.round(info.ers * 20)}|${info.ersActive}|${info.limiter}|${info.tyre}|${wear}|${delta}|${info.message?.text}`;
    if (key === this.last) return;
    this.last = key;
    const c = this.ctx;
    c.fillStyle = '#050608';
    c.fillRect(0, 0, 128, 64);
    // Gear big in the middle, speed to the right.
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.font = 'bold 34px system-ui, sans-serif';
    c.fillText(String(gearFor(info.speedKmh)), 64, 22);
    c.fillStyle = info.limiter ? '#4dd2ff' : '#d8dade';
    c.font = 'bold 16px system-ui, sans-serif';
    c.fillText(String(Math.round(info.speedKmh)), 104, 18);
    // DRS light (left), ERS bar (bottom).
    c.fillStyle = info.drsOpen ? DRS_GREEN : info.drsAvailable ? '#ffd400' : '#2a2b30';
    c.fillRect(6, 8, 18, 18);
    c.fillStyle = '#2a2b30';
    c.fillRect(8, 50, 112, 8);
    c.fillStyle = info.ersActive ? '#ffd400' : '#4dd2ff';
    c.fillRect(8, 50, 112 * info.ers, 8);
    // Tyre and wear (left), gap to the best lap (right).
    c.font = 'bold 11px system-ui, sans-serif';
    if (info.tyre) {
      c.textAlign = 'left';
      c.fillStyle = wear >= 70 ? '#ff5a4d' : '#d8dade';
      c.fillText(`${info.tyre} ${wear}%`, 6, 42);
    }
    if (delta !== null) {
      c.textAlign = 'right';
      c.fillStyle = delta <= 0 ? '#3ce06a' : '#ff5a4d';
      c.fillText(`${delta <= 0 ? '-' : '+'}${Math.abs(delta).toFixed(1)}`, 122, 42);
    }
    // A message takes over the top of the display.
    if (info.message) {
      c.fillStyle = info.message.color;
      c.fillRect(0, 0, 128, 36);
      c.textAlign = 'center';
      c.fillStyle = '#050608';
      c.font = 'bold 26px system-ui, sans-serif';
      c.fillText(info.message.text, 64, 19);
    }
    this.tex.needsUpdate = true;
  }

  private showLeds(lit: number, flag: LedFlag, drsReady: boolean): void {
    // Flags flash slowly, the shift point fast.
    const blink = Math.floor(performance.now() / (flag || drsReady ? 180 : 70)) % 2 === 0;
    const leds = ledColors(lit, flag, drsReady, blink);
    const state = leds.join();
    if (state === this.lit) return;
    this.lit = state;
    const c = this.ledCtx;
    c.fillStyle = '#050608';
    c.fillRect(0, 0, 128, 8);
    leds.forEach((color, i) => {
      c.fillStyle = color ?? '#1c1d22';
      c.beginPath();
      c.arc(5 + i * 8.4, 4, 3, 0, Math.PI * 2);
      c.fill();
    });
    this.ledTex.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** The safety car: a silver road car with a light bar that flashes amber while it's out. */
export class SafetyCarModel {
  readonly group = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private readonly lightMat = new THREE.MeshBasicMaterial({ color: '#4a3a10' });

  constructor() {
    const q = new QuadBuilder();
    tbox(q, -2.3, 2.3, 1.9, 1.8, 0.25, 0.95, 0.25, 0.75, '#b9bec4');
    tbox(q, -1.5, 0.6, 1.6, 1.6, 0.95, 1.35, 0.95, 1.3, '#1b2430');
    tbox(q, -2.3, -2.25, 1.6, 1.6, 0.5, 0.8, 0.5, 0.8, '#b01010');
    const geo = q.build();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(geo, mat));
    const bar = new THREE.BoxGeometry(0.3, 0.12, 1.2);
    const light = new THREE.Mesh(bar, this.lightMat);
    light.position.set(-0.3, 1.42, 0);
    this.group.add(light);
    const wheel = wheelGeometry(0.34, 0.3);
    const tyre = new THREE.MeshLambertMaterial({ color: TYRE });
    for (const [x, z] of [[1.45, -0.8], [1.45, 0.8], [-1.45, -0.8], [-1.45, 0.8]]) {
      const w = new THREE.Mesh(wheel, tyre);
      w.position.set(x, 0.34, z);
      this.group.add(w);
    }
    this.disposables.push(geo, mat, bar, wheel, tyre, this.lightMat);
  }

  update(x: number, y: number, heading: number, flashing: boolean, time: number): void {
    this.group.position.set(x, 0, y);
    this.group.rotation.y = -heading;
    this.lightMat.color.set(flashing && Math.floor(time * 4) % 2 === 0 ? '#ffb000' : '#4a3a10');
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
