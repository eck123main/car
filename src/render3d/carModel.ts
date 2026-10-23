import * as THREE from 'three';
import type { Livery } from '../render/livery';
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
/** Steering wheel turn at full lock (rad). */
const WHEEL_LOCK = 1.3;
/** Front wheel turn at full lock (rad), as drawn in 2D. */
const STEER_VISUAL = 0.35;

/** Where the driver's eyes are (car frame). */
export const EYE: V3 = [-0.4, 0.94, 0];

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
    strut(q, [0.25, 0.55, side * 0.38], [0.3, 0.7, side * 0.6], 0.035, CARBON);
    tbox(q, 0.24, 0.34, 0.22, 0.22, 0.66, 0.76, 0.66, 0.76, l.body, side * 0.66);
  }
  // Engine cover rising to the airbox behind the driver.
  tbox(q, -2.25, -0.78, 0.3, 0.62, 0.07, 0.5, 0.07, 0.96, l.body);
  tbox(q, -0.84, -0.74, 0.28, 0.28, 0.9, 1.05, 0.9, 1.05, '#0d0d0f');
  // Front wing: two elements and endplates.
  tbox(q, 2.3, 2.82, 1.9, 1.9, 0.06, 0.1, 0.06, 0.1, l.wings);
  tbox(q, 2.2, 2.48, 1.8, 1.8, 0.16, 0.19, 0.12, 0.15, l.wings);
  for (const z of [-0.94, 0.94]) tbox(q, 2.15, 2.84, 0.04, 0.04, 0.05, 0.32, 0.05, 0.28, l.endplates, z);
  // Rear wing: endplates, main plane, a pylon and the beam wing.
  for (const z of [-0.5, 0.5]) tbox(q, -2.86, -2.28, 0.04, 0.04, 0.32, 1.0, 0.32, 0.98, l.endplates, z);
  tbox(q, -2.82, -2.52, 1.0, 1.0, 0.82, 0.87, 0.84, 0.89, l.wings);
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
  body: THREE.Material;
  carbon: THREE.Material;
  tyre: THREE.Material;
  ring: THREE.MeshLambertMaterial;
  wing: THREE.MeshLambertMaterial;
  helmet: THREE.Material;
}

const shared = {
  wheelFront: null as THREE.BufferGeometry | null,
  wheelRear: null as THREE.BufferGeometry | null,
  shadow: null as THREE.Mesh | null,
};

function wheelGeometry(radius: number, width: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, width, 16);
  g.rotateX(Math.PI / 2);
  return g;
}

export class CarModel {
  readonly group = new THREE.Group();
  private readonly frontWheels: THREE.Group[] = [];
  private readonly flap: THREE.Mesh;
  private readonly helmet: THREE.Mesh;
  private readonly mats: Materials;
  private readonly bodyGeo: THREE.BufferGeometry;
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly wingBase: string;
  private compound: Compound | null = null;
  private drs = false;
  wheel: SteeringWheel | null = null;

  constructor(livery: Livery, opts: { ghost?: string } = {}) {
    const ghost = opts.ghost;
    this.wingBase = ghost ?? livery.wings;
    const lambert = (p: THREE.MeshLambertMaterialParameters) =>
      new THREE.MeshLambertMaterial(ghost ? { color: ghost, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide } : { side: THREE.DoubleSide, ...p });
    this.mats = {
      body: lambert({ vertexColors: true }),
      carbon: lambert({ color: CARBON }),
      tyre: lambert({ color: TYRE }),
      ring: lambert({ color: '#ffffff' }) as THREE.MeshLambertMaterial,
      wing: lambert({ color: livery.wings }) as THREE.MeshLambertMaterial,
      helmet: lambert({ color: livery.helmet }),
    };
    this.bodyGeo = bodyGeometry(livery);
    this.group.add(new THREE.Mesh(this.bodyGeo, this.mats.body));
    for (const g of haloParts()) {
      this.owned.push(g);
      this.group.add(new THREE.Mesh(g, this.mats.carbon));
    }
    const helmetGeo = new THREE.SphereGeometry(0.15, 12, 8);
    this.owned.push(helmetGeo);
    this.helmet = new THREE.Mesh(helmetGeo, this.mats.helmet);
    this.helmet.position.set(-0.42, 0.78, 0);
    this.group.add(this.helmet);

    // DRS flap, hinged at its leading edge.
    const flapGeo = new THREE.BoxGeometry(0.22, 0.035, 1.0);
    flapGeo.translate(0.11, 0, 0);
    this.owned.push(flapGeo);
    this.flap = new THREE.Mesh(flapGeo, this.mats.wing);
    this.flap.position.set(-2.52, 0.93, 0);
    this.group.add(this.flap);

    shared.wheelFront ??= wheelGeometry(0.33, 0.36);
    shared.wheelRear ??= wheelGeometry(0.36, 0.42);
    const ring = new THREE.TorusGeometry(0.24, 0.025, 4, 16);
    this.owned.push(ring);
    const addWheel = (x: number, y: number, z: number, geo: THREE.BufferGeometry, width: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.add(new THREE.Mesh(geo, this.mats.tyre));
      const r = new THREE.Mesh(ring, this.mats.ring);
      r.position.z = Math.sign(z) * (width / 2 + 0.005);
      g.add(r);
      this.group.add(g);
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
    for (const w of this.frontWheels) w.rotation.y = -steer * STEER_VISUAL;
    if (drsOpen !== this.drs) {
      this.drs = drsOpen;
      this.flap.rotation.z = drsOpen ? 0.7 : 0;
      this.mats.wing.color.set(drsOpen ? DRS_GREEN : this.wingBase);
    }
    if (compound !== this.compound) {
      this.compound = compound;
      this.mats.ring.color.set(COMPOUNDS[compound].color);
    }
    this.wheel?.turn(steer);
  }

  /** Inside the car: the helmet would fill the view. */
  set driverVisible(on: boolean) {
    this.helmet.visible = on;
  }

  /** Add the steering wheel (own car only). */
  addSteeringWheel(): SteeringWheel {
    this.wheel = new SteeringWheel();
    this.group.add(this.wheel.group);
    return this.wheel;
  }

  dispose(): void {
    this.bodyGeo.dispose();
    for (const g of this.owned) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.wheel?.dispose();
  }
}

/** What the steering wheel's display shows. */
export interface WheelInfo {
  speedKmh: number;
  drsOpen: boolean;
  drsAvailable: boolean;
  ers: number;
  ersActive: boolean;
  limiter: boolean;
}

/** The F1 steering wheel in front of the driver, with a small live display. */
export class SteeringWheel {
  readonly group = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly disposables: { dispose(): void }[] = [];
  private last = '';

  constructor() {
    this.group.position.set(0.04, 0.72, 0);
    // Tilted back towards the driver.
    const inner = new THREE.Group();
    inner.rotation.z = 0.35;
    this.group.add(inner);
    const mat = new THREE.MeshLambertMaterial({ color: '#202124' });
    const grip = new THREE.MeshLambertMaterial({ color: '#0e0e0f' });
    const body = new THREE.BoxGeometry(0.04, 0.13, 0.24);
    const handle = new THREE.BoxGeometry(0.05, 0.17, 0.05);
    this.disposables.push(mat, grip, body, handle);
    inner.add(new THREE.Mesh(body, mat));
    for (const z of [-0.14, 0.14]) {
      const h = new THREE.Mesh(handle, grip);
      h.position.set(0, -0.01, z);
      inner.add(h);
    }
    this.canvas.width = 128;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d')!;
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
  }

  turn(steer: number): void {
    this.group.rotation.x = steer * WHEEL_LOCK;
  }

  show(info: WheelInfo): void {
    const key = `${Math.round(info.speedKmh)}|${info.drsOpen}|${info.drsAvailable}|${Math.round(info.ers * 20)}|${info.ersActive}|${info.limiter}`;
    if (key === this.last) return;
    this.last = key;
    const c = this.ctx;
    c.fillStyle = '#050608';
    c.fillRect(0, 0, 128, 64);
    c.fillStyle = info.limiter ? '#4dd2ff' : '#ffffff';
    c.font = 'bold 30px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(Math.round(info.speedKmh)), 64, 26);
    // DRS light (left), ERS bar (bottom).
    c.fillStyle = info.drsOpen ? DRS_GREEN : info.drsAvailable ? '#ffd400' : '#2a2b30';
    c.fillRect(6, 8, 18, 18);
    c.fillStyle = '#2a2b30';
    c.fillRect(8, 50, 112, 8);
    c.fillStyle = info.ersActive ? '#ffd400' : '#4dd2ff';
    c.fillRect(8, 50, 112 * info.ers, 8);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
