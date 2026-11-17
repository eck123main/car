import * as THREE from 'three';
import { driveCar, drivenCar, ownedCars } from '../net/wallet';
import { deinterleaveGeometry, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarParts } from '../physics/car';
import type { Livery } from '../render/livery';
import type { CarClassId } from '../sim/carClass';
import type { Compound } from '../sim/tyres';
import { SteeringWheel, type Car3d, type Cockpit } from './carModel';
import { FRONT_AXLE as GT3_FRONT, REAR_AXLE as GT3_REAR } from './gt3Skin';

/**
 * Bodies loaded from model files (glTF / GLB, e.g. downloaded from Sketchfab) that stand in for
 * the built-in GT3 or Hypercar bodywork. Looks only: physics never sees them.
 *
 * Drop `public/models/gt3.glb` and/or `public/models/lmh.glb` in; `public/models/models.json` can
 * override the defaults per class (see `BodySpec`). Missing files just leave the built-in car.
 *
 * The model's own wheels are hidden (matched by name) and ours are kept, so they still spin, steer,
 * show the compound and come off. The body is scaled so its axles sit on ours (found from the
 * hidden wheels; without them, by overall length). Inside the car (cockpit cameras) the built-in
 * body and cockpit are shown instead, as downloaded models rarely have a usable interior.
 * Meshes are merged per material, so a model of hundreds of parts is a handful of draw calls.
 */

export interface BodySpec {
  /** File in public/models/ (.glb, or .gltf with its files beside it). */
  file: string;
  /** Extra turn about the vertical, degrees: 180 if the car comes out backwards. */
  turn?: number;
  /** Extra scale on top of the automatic fit. */
  scale?: number;
  /** Lift (m) on top of the automatic fit (wheels on the ground). */
  lift?: number;
  /** Regex (case-insensitive) on mesh / material names of the parts to hide: the model's wheels. */
  hide?: string;
  /** Regex on mesh / material names of parts to leave out: the interior (our own cockpit stands in), or "" to keep all. */
  drop?: string;
  /** Regex on material names painted in the player's colour, or false to keep the model's paint. */
  tint?: string | false;
}

export const DEFAULT_HIDE = 'wheel|tire|tyre|rim|brake|caliper|disc|rotor|hub|lug|spoke';
export const DEFAULT_DROP = '^int_|interior|cockpit|seat|belt|harness|steer|dash|display|rollcage|roll_cage|pedal|foam|worldgrid';
const DEFAULT_TINT = 'paint|carpaint|body_?col|livery';

/** Where our wheels are, per class (car frame: x forward, y up, z right). */
const TARGET: Partial<Record<CarClassId, { front: number; rear: number; length: number }>> = {
  gt3: { front: GT3_FRONT, rear: GT3_REAR, length: 4.7 },
  lmh: { front: 1.65, rear: -1.5, length: 4.75 },
};

export interface BodyPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  tinted: boolean;
  /** Big enough to be drawn on a car far away (`FAR_FROM`). */
  far?: boolean;
}

/** Parts at least this big (bounding sphere radius, m) are drawn from afar; the rest only close up. */
const FAR_PART = 0.6;
/** Beyond this distance from the camera (m), a car shows only its big parts. */
const FAR_FROM = 45;

/** The loaded body's outline in the car frame, to put the bolted-on cameras on it. */
export interface BodyShape {
  /** Nose and tail (x), half width, top (y). */
  front: number;
  rear: number;
  halfWidth: number;
  top: number;
  /** Highest point near the middle (|z| < 0.5 m), every `STEP` m from `rear`. */
  profile: number[];
}

const STEP = 0.1;

/** How high the body is (near the middle) at x. */
export function bodyTopAt(shape: BodyShape, x: number): number {
  const i = Math.round((x - shape.rear) / STEP);
  let top = 0;
  // A little either side, so a camera clears an edge just ahead of it too.
  for (let j = i - 2; j <= i + 2; j++) top = Math.max(top, shape.profile[j] ?? 0);
  return top;
}

export interface ModelCockpit {
  /** Centre of the model's steering wheel (car frame). */
  wheel: [number, number, number];
  /** How far its top leans back towards the driver (rad, as `Cockpit.tilt`). */
  tilt: number;
  /** The driver's eyes. */
  eye: [number, number, number];
  /** Where the cockpit camera looks (a point in the car frame) and its field of view, from the windscreen's opening. */
  look: [number, number, number];
  fov: number;
  /** The model's wheel is a whole wheel (rim and all), not just a part of one: else the game's rim is shown too. */
  whole: boolean;
}

export interface PreparedBody {
  shape: BodyShape;
  parts: BodyPart[];
  /** The model's own interior (seats, cage, dash...), for your own car only; empty if none was found. */
  interior: BodyPart[];
  /** Where its steering wheel is, so the game's arms and the cockpit camera go there. */
  cockpit: ModelCockpit | null;
  /** The model's steering wheel, centred on `cockpit.wheel`, to turn with the steering. */
  steering: BodyPart[];
  /** How the fit was found, for the console. */
  fit: 'axles' | 'length';
  triangles: number;
}

/** Turns a loaded scene into a few merged parts in the car's frame, fitted to the class's wheels. */
export function prepareBody(scene: THREE.Object3D, spec: Omit<BodySpec, 'file'>, body: CarClassId): PreparedBody | null {
  const target = TARGET[body];
  if (!target) return null;
  const hide = new RegExp(spec.hide ?? DEFAULT_HIDE, 'i');
  const drop = spec.drop === '' ? null : new RegExp(spec.drop ?? DEFAULT_DROP, 'i');
  const tint = spec.tint === false ? null : new RegExp(spec.tint ?? DEFAULT_TINT, 'i');
  scene.updateMatrixWorld(true);

  type Piece = { geo: THREE.BufferGeometry; mat: THREE.Material };
  const kept: Piece[] = [];
  const inside: Piece[] = [];
  const steer: Piece[] = [];
  const wheels: { box: THREE.Box3; name: string }[] = [];
  const wheelPts: THREE.Vector3[] = [];
  const named = (o: THREE.Object3D): string => {
    let s = '';
    for (let p: THREE.Object3D | null = o; p; p = p.parent) s += ` ${p.name}`;
    return s;
  };
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = mesh.geometry.clone();
    deinterleaveGeometry(geo);
    geo.morphAttributes = {};
    floatAttributes(geo);
    geo.applyMatrix4(mesh.matrixWorld);
    const pieces: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    if (Array.isArray(mesh.material) && geo.groups.length) {
      for (const g of geo.groups) pieces.push({ geo: subGeometry(geo, g.start, g.count), mat: mats[g.materialIndex ?? 0] });
      geo.dispose();
    } else pieces.push({ geo, mat: mats[0] });
    for (const piece of pieces) {
      const name = `${named(mesh)} ${piece.mat.name}`;
      if (STEER.test(name)) {
        steer.push(piece);
        continue;
      }
      if (drop && drop.test(piece.mat.name)) {
        inside.push(piece);
        continue;
      }
      if (hide.test(name)) {
        piece.geo.computeBoundingBox();
        wheels.push({ box: piece.geo.boundingBox!.clone(), name });
        // Some models have all four wheels in one mesh: keep points to split them by corner.
        const pos = piece.geo.getAttribute('position');
        const step = Math.max(1, Math.floor(pos.count / 4000));
        for (let i = 0; i < pos.count; i += step) wheelPts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
        piece.geo.dispose();
      } else kept.push(piece);
    }
  });
  if (!kept.length) return null;

  // Point it along +x: the long side is the length; glTF cars usually face +z.
  const box = new THREE.Box3();
  for (const k of kept) {
    k.geo.computeBoundingBox();
    box.union(k.geo.boundingBox!);
  }
  const size = box.getSize(new THREE.Vector3());
  let degrees = size.z > size.x ? 90 : 0;
  const turned = () => new THREE.Matrix4().makeRotationY(degrees * (Math.PI / 180));
  // Which way is the front? glTF says +z, but models disagree. Wheels named front / rear decide;
  // else the wider tyres are the rear ones (true of nearly every GT and sports car).
  const sides = (m: THREE.Matrix4) => {
    const placed = wheels.map((w) => ({ box: w.box.clone().applyMatrix4(m), name: w.name }));
    const midX = placed.reduce((a, w) => a + w.box.getCenter(new THREE.Vector3()).x, 0) / (placed.length || 1);
    const ahead = placed.filter((w) => w.box.getCenter(new THREE.Vector3()).x > midX);
    const behind = placed.filter((w) => w.box.getCenter(new THREE.Vector3()).x <= midX);
    return { ahead, behind };
  };
  // The four corners' wheels (whatever meshes they came in), split about the middle of them all.
  const corners = (m: THREE.Matrix4): { box: THREE.Box3 }[] => {
    const pts = wheelPts.map((p) => p.clone().applyMatrix4(m));
    if (!pts.length) return [];
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
    const boxes = [0, 1, 2, 3].map(() => new THREE.Box3());
    for (const p of pts) boxes[(p.x > c.x ? 2 : 0) + (p.z > c.z ? 1 : 0)].expandByPoint(p);
    return boxes.filter((b) => !b.isEmpty()).map((box) => ({ box, front: box.getCenter(new THREE.Vector3()).x > c.x }));
  };
  const { ahead, behind } = sides(turned());
  const quads = corners(turned()) as { box: THREE.Box3; front: boolean }[];
  const says = (list: { name: string }[], re: RegExp) => list.filter((w) => re.test(w.name)).length;
  const FRONT = /front|[_\-. ]f[lr](?![a-z])/i;
  const REAR = /rear|back|[_\-. ]r[lr](?![a-z])/i;
  const vote = says(ahead, REAR) + says(behind, FRONT) - says(ahead, FRONT) - says(behind, REAR);
  const width = (list: { box: THREE.Box3 }[]) => Math.max(0, ...list.map((w) => w.box.max.z - w.box.min.z));
  const quadsAhead = quads.filter((q) => q.front);
  const quadsBehind = quads.filter((q) => !q.front);
  if (vote > 0 || (vote === 0 && quadsAhead.length && quadsBehind.length && width(quadsAhead) > width(quadsBehind) * 1.03)) degrees += 180;
  degrees += spec.turn ?? 0;
  const turn = turned();
  for (const k of [...kept, ...inside, ...steer]) k.geo.applyMatrix4(turn);
  // The wheel itself, without a steering column that some models also call "steer" (long along
  // the car, narrow across it): with the column the wheel's centre came out ~0.15 m too far forward.
  const rimPieces = steer.filter((p) => {
    p.geo.computeBoundingBox();
    const b = p.geo.boundingBox!;
    return b.max.x - b.min.x <= 1.5 * (b.max.z - b.min.z);
  });
  // Parts lying wholly inside the wheel turn with it, whatever they're called (the BMW's and the
  // Ferrari 296's displays, LEDs and knobs hang under other nodes and stayed put as the rim turned).
  if (rimPieces.length) {
    const rim = new THREE.Box3();
    for (const p of rimPieces) rim.union(p.geo.boundingBox!);
    const reach = rim.clone().expandByScalar(rim.getSize(new THREE.Vector3()).length() * 0.06);
    for (const list of [kept, inside]) {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].geo.computeBoundingBox();
        if (!reach.containsBox(list[i].geo.boundingBox!)) continue;
        const [piece] = list.splice(i, 1);
        steer.push(piece);
        rimPieces.push(piece);
      }
    }
  }
  const placedQuads = corners(turn);
  const hubs = placedQuads.map((q) => q.box.getCenter(new THREE.Vector3()));
  const wheelBottoms = placedQuads.map((q) => q.box.min.y);
  box.makeEmpty();
  for (const k of kept) {
    k.geo.computeBoundingBox();
    box.union(k.geo.boundingBox!);
  }

  // Fit: axles onto ours if the wheels were found front and back, else by length.
  const mid = (box.min.x + box.max.x) / 2;
  const front = hubs.filter((h) => h.x > mid);
  const rear = hubs.filter((h) => h.x < mid);
  let scale: number;
  let centreX: number;
  let ground: number;
  let fit: PreparedBody['fit'];
  if (front.length && rear.length) {
    const fx = front.reduce((a, h) => a + h.x, 0) / front.length;
    const rx = rear.reduce((a, h) => a + h.x, 0) / rear.length;
    scale = (target.front - target.rear) / (fx - rx);
    centreX = (fx + rx) / 2;
    ground = Math.min(...wheelBottoms);
    fit = 'axles';
  } else {
    scale = target.length / (box.max.x - box.min.x);
    centreX = mid;
    ground = box.min.y;
    fit = 'length';
  }
  scale *= spec.scale ?? 1;
  const place = new THREE.Matrix4()
    .makeTranslation((target.front + target.rear) / 2, spec.lift ?? 0, 0)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-centreX, -ground, -(box.min.z + box.max.z) / 2));
  for (const k of [...kept, ...inside, ...steer]) k.geo.applyMatrix4(place);

  // The game's own wheel replaces the model's (it turns, with the driver's arms on it); without one
  // found, the model's interior isn't used and the built-in cockpit stays.
  // Measured from the pieces as they are: merging them just for this cost a second full merge.
  const shapeNow = measure(kept.map((k) => ({ geometry: k.geo, material: k.mat, tinted: false })));
  const found = findCockpit((rimPieces.length ? rimPieces : steer).map((p) => p.geo), shapeNow);
  const cockpit = found && seatView(found, [...kept, ...inside, ...steer], shapeNow);
  if (cockpit) for (const p of steer) p.geo.translate(-cockpit.wheel[0], -cockpit.wheel[1], -cockpit.wheel[2]);
  else for (const p of [...inside, ...steer]) p.geo.dispose();
  const outer = toParts(kept, tint);
  const inner = cockpit ? toParts(inside, null) : { parts: [], triangles: 0 };
  const steering = cockpit ? toParts(steer, null).parts : [];
  for (const p of [...outer.parts, ...inner.parts]) if (MIRROR.test(p.material.name)) mirrorUvs(p.geometry);
  // Seen from afar only the big parts are drawn: badges, lights, vents and the like are draw calls
  // (12-38 a car) that nobody can see beyond a few car lengths.
  for (const p of outer.parts) {
    p.geometry.computeBoundingSphere();
    p.far = p.geometry.boundingSphere!.radius >= FAR_PART;
  }
  return { parts: outer.parts, interior: inner.parts, steering, cockpit, fit, triangles: outer.triangles, shape: measure(outer.parts) };
}

/**
 * Plain float attributes: compressed files (gltf-transform / meshopt) store positions, normals and
 * UVs as packed integers, which transforms, merging and our measuring would read as raw numbers.
 */
function floatAttributes(geo: THREE.BufferGeometry): void {
  for (const [name, attr] of Object.entries(geo.attributes) as [string, THREE.BufferAttribute][]) {
    if (attr.array instanceof Float32Array && !attr.normalized) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
    geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
}

const MIRROR = /mirror/i;

/**
 * Mirror glass shows the rear-view picture (as the built-in mirrors: left door the left half, right
 * door the right half, the one inside the middle), whatever UVs the model came with.
 */
function mirrorUvs(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const groups = [
    { test: (z: number) => z < -0.5, u0: 0, u1: 0.5 },
    { test: (z: number) => z > 0.5, u0: 0.5, u1: 1 },
    { test: () => true, u0: 0.15, u1: 0.85 },
  ].map((g) => ({ ...g, box: new THREE.Box3() }));
  const which: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const g = groups.findIndex((gr) => gr.test(pos.getZ(i)));
    which.push(g);
    groups[g].box.expandByPoint(v.fromBufferAttribute(pos, i));
  }
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const { box, u0, u1 } = groups[which[i]];
    const t = (pos.getZ(i) - box.min.z) / Math.max(1e-6, box.max.z - box.min.z);
    uv[i * 2] = 1 - (u0 + t * (u1 - u0));
    uv[i * 2 + 1] = (pos.getY(i) - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Meshes / materials of the model's steering wheel. */
const STEER = /steer|volante|lenkrad|(^|[ _.])sw_/i;

/** One mesh per material; materials that look the same count as one. */
function toParts(pieces: { geo: THREE.BufferGeometry; mat: THREE.Material }[], tint: RegExp | null): { parts: BodyPart[]; triangles: number } {
  const same = new Map<string, THREE.Material>();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const k of pieces) {
    const key = looks(k.mat);
    const mat = same.get(key) ?? (same.set(key, k.mat), k.mat);
    const list = byMat.get(mat) ?? [];
    list.push(k.geo);
    byMat.set(mat, list);
  }
  const parts: BodyPart[] = [];
  let triangles = 0;
  for (const [mat, geos] of byMat) {
    for (const geometry of mergeAll(geos)) {
      triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
      // A textured paint is the model's own livery: tinting it would spoil it.
      const textured = !!(mat as THREE.MeshStandardMaterial).map;
      parts.push({ geometry, material: toPhong(mat), tinted: !!tint && !textured && tint.test(mat.name) });
    }
  }
  return { parts, triangles: Math.round(triangles) };
}

/**
 * The model's steering wheel: its centre, and its lean from the flat disc it makes (the direction
 * in the x-y plane its points spread least along). The eyes sit where the game's own GT driver's
 * do from their wheel, kept under the roof.
 */
export function findCockpit(geos: THREE.BufferGeometry[], shape: BodyShape): ModelCockpit | null {
  const pts: THREE.Vector3[] = [];
  for (const g of geos) {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  if (pts.length < 8) return null;
  const box = new THREE.Box3().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  // A steering wheel is 0.2-0.45 m across; anything else is a wrong match.
  if (size.z < 0.15 || size.z > 0.6) return null;
  const c = box.getCenter(new THREE.Vector3());
  let tilt = 0.3;
  let least = Infinity;
  for (let t = -0.2; t <= 1.2; t += 0.02) {
    const nx = Math.cos(t);
    const ny = Math.sin(t);
    let v = 0;
    for (const p of pts) v += ((p.x - c.x) * nx + (p.y - c.y) * ny) ** 2;
    if (v < least) {
      least = v;
      tilt = t;
    }
  }
  const eyeX = c.x - 0.49;
  const eyeY = Math.min(c.y + 0.26, bodyTopAt(shape, eyeX) - 0.12);
  // A whole wheel is about as tall as it is wide, and more than a plate of a few triangles.
  const whole = size.y > 0.15 && pts.length > 300;
  return { wheel: [c.x, c.y, c.z], tilt, eye: [eyeX, eyeY, c.z], look: [eyeX + 30, -0.5, c.z], fov: 68, whole };
}

/** Pitch range (degrees) the windscreen view is judged over: the road ahead, not the sky. */
const VIEW_LO = -28;
const VIEW_HI = 8;
const BIN = 0.5;
const SEE_THROUGH = /glass|window|windscreen|windshield/i;

/**
 * Where to put the eyes so the windscreen shows the most road: the solid parts (glass doesn't count)
 * are cut by the upright plane through the driver's head, and for each eye position on a grid the
 * clear band of pitch angles straight ahead is found. Then the view is aimed and sized to that band,
 * keeping a little dash and the top of the wheel in sight.
 */
export function seatView(cp: ModelCockpit, pieces: { geo: THREE.BufferGeometry; mat: THREE.Material }[], shape: BodyShape): ModelCockpit {
  const ez = cp.wheel[2];
  // Segments (x0, y0, x1, y1) where the solid triangles cross the plane z = ez.
  const segs: number[] = [];
  // The same with glass too: the roof over the driver's head (a canopy is glass).
  const shell: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const { geo, mat } of pieces) {
    const m = mat as THREE.MeshStandardMaterial;
    const clear = SEE_THROUGH.test(m.name) || (m.transparent && m.opacity < 0.9);
    const pos = geo.getAttribute('position');
    const index = geo.getIndex();
    const n = index ? index.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      if (Math.max(a.z, b.z, c.z) < ez || Math.min(a.z, b.z, c.z) > ez) continue;
      if (Math.max(a.x, b.x, c.x) < cp.wheel[0] - 0.7) continue;
      const cut: number[] = [];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const dp = p.z - ez;
        const dq = q.z - ez;
        if (dp === dq) continue;
        if ((dp <= 0 && dq >= 0) || (dp >= 0 && dq <= 0)) {
          const t = dp / (dp - dq);
          cut.push(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
        }
      }
      if (cut.length < 4) continue;
      shell.push(cut[0], cut[1], cut[2], cut[3]);
      if (!clear) segs.push(cut[0], cut[1], cut[2], cut[3]);
    }
  }
  const bins = Math.round((VIEW_HI - VIEW_LO) / BIN);
  const blocked = new Uint8Array(bins);
  // The clear band (lo, hi in degrees) seen from (ex, ey): the widest gap, judged over the road range.
  const band = (ex: number, ey: number): [number, number] => {
    blocked.fill(0);
    for (let i = 0; i < segs.length; i += 4) {
      let x0 = segs[i] - ex;
      let y0 = segs[i + 1] - ey;
      let x1 = segs[i + 2] - ex;
      let y1 = segs[i + 3] - ey;
      if (x0 < 0.05 && x1 < 0.05) continue;
      // Clip to just ahead of the eyes.
      if (x0 < 0.05 || x1 < 0.05) {
        const t = (0.05 - x0) / (x1 - x0);
        const cx = 0.05;
        const cy = y0 + (y1 - y0) * t;
        if (x0 < 0.05) [x0, y0] = [cx, cy];
        else [x1, y1] = [cx, cy];
      }
      const p0 = (Math.atan2(y0, x0) * 180) / Math.PI;
      const p1 = (Math.atan2(y1, x1) * 180) / Math.PI;
      const from = Math.max(0, Math.floor((Math.min(p0, p1) - VIEW_LO) / BIN));
      const to = Math.min(bins - 1, Math.floor((Math.max(p0, p1) - VIEW_LO) / BIN));
      for (let k = from; k <= to; k++) blocked[k] = 1;
    }
    let best: [number, number] = [0, 0];
    for (let k = 0; k < bins; ) {
      if (blocked[k]) {
        k++;
        continue;
      }
      let e = k;
      while (e < bins && !blocked[e]) e++;
      if (e - k > (best[1] - best[0]) / BIN) best = [VIEW_LO + k * BIN, VIEW_LO + e * BIN];
      k = e;
    }
    return best;
  };
  // Still inside: something over the head, 8-40 cm up, within 20 cm fore and aft.
  const roofed = (ex: number, ey: number): boolean => {
    for (let i = 0; i < shell.length; i += 4) {
      const [x0, y0, x1, y1] = [shell[i], shell[i + 1], shell[i + 2], shell[i + 3]];
      if (Math.max(x0, x1) < ex - 0.2 || Math.min(x0, x1) > ex + 0.2) continue;
      if (Math.min(y0, y1) > ey + 0.08 && Math.max(y0, y1) < ey + 0.4) return true;
      if (Math.max(y0, y1) > ey + 0.08 && Math.min(y0, y1) < ey + 0.4) return true;
    }
    return false;
  };
  const [wx, wy] = cp.wheel;
  let eye: [number, number, number] = cp.eye;
  let view = band(cp.eye[0], cp.eye[1]);
  let score = view[1] - view[0];
  for (let dx = -0.6; dx <= -0.38 + 1e-9; dx += 0.02) {
    const ex = wx + dx;
    const top = bodyTopAt(shape, ex) - 0.14;
    for (let ey = wy + 0.14; ey <= Math.min(wy + 0.32, top) + 1e-9; ey += 0.02) {
      if (!roofed(ex, ey)) continue;
      const v = band(ex, ey);
      // Sitting far from where a driver would is a small cost.
      const s = v[1] - v[0] - 4 * Math.abs(dx + 0.49) - 4 * Math.abs(ey - (wy + 0.26));
      if (s > score) {
        score = s;
        eye = [ex, ey, ez];
        view = v;
      }
    }
  }
  if (view[1] - view[0] < 2) return cp;
  // Framed like a racing sim: the horizon 38% down the screen and the bottom edge at the middle of
  // the steering wheel, so the road, the wheel and the driver's hands are all in sight.
  const wheelMid = (Math.atan2(wy - eye[1], wx - eye[0]) * 180) / Math.PI;
  const fov = Math.min(80, Math.max(54, -wheelMid / 0.57));
  const pitch = -0.12 * fov;
  const look: [number, number, number] = [eye[0] + 30, eye[1] + 30 * Math.tan((pitch * Math.PI) / 180), ez];
  return { ...cp, eye, look, fov };
}

/** What a material looks like, so copies with other names can share a draw call. */
function looks(mat: THREE.Material): string {
  const m = mat as THREE.MeshStandardMaterial;
  const tex = (t: THREE.Texture | null | undefined) => (t ? ((t.source?.uuid ?? t.uuid) + t.channel) : '-');
  return [
    m.type,
    m.color?.getHexString(),
    m.emissive?.getHexString(),
    m.roughness?.toFixed(2),
    m.metalness?.toFixed(2),
    tex(m.map),
    tex(m.normalMap),
    tex(m.emissiveMap),
    tex(m.alphaMap),
    m.transparent,
    m.opacity?.toFixed(2),
    m.alphaTest,
    m.side,
    m.vertexColors,
  ].join('|');
}

function measure(parts: BodyPart[]): BodyShape {
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  const profile = new Array<number>(Math.ceil((box.max.x - box.min.x) / STEP) + 1).fill(0);
  for (const p of parts) {
    const pos = p.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i)) > 0.5) continue;
      const j = Math.round((pos.getX(i) - box.min.x) / STEP);
      profile[j] = Math.max(profile[j], pos.getY(i));
    }
  }
  return { front: box.max.x, rear: box.min.x, halfWidth: Math.max(-box.min.z, box.max.z), top: box.max.y, profile };
}

/** Merges geometries that share attributes; any that don't fit stay on their own. */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
  if (geos.length === 1) return geos;
  const sets = new Map<string, THREE.BufferGeometry[]>();
  for (const g of geos) {
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    const key = `${Object.keys(g.attributes).sort().join(',')}|${g.index ? 'i' : 'n'}`;
    const list = sets.get(key) ?? [];
    list.push(g);
    sets.set(key, list);
  }
  const out: THREE.BufferGeometry[] = [];
  for (const list of sets.values()) {
    const merged = list.length > 1 ? mergeGeometries(list) : list[0];
    if (merged) {
      out.push(merged);
      if (merged !== list[0]) for (const g of list) g.dispose();
    } else out.push(...list);
  }
  return out;
}

function subGeometry(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  if (geo.index) {
    // Each piece gets its own copy, as each is moved on its own afterwards.
    for (const [name, attr] of Object.entries(geo.attributes)) out.setAttribute(name, (attr as THREE.BufferAttribute).clone());
    out.setIndex(Array.from(geo.index.array as ArrayLike<number>).slice(start, start + count));
    return out;
  }
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    out.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize, a.normalized));
  }
  return out;
}

/**
 * The game's lighting is made for Lambert / Phong; PBR materials with no environment map turn metal
 * paint black, so they're redone as Phong (shininess from roughness).
 */
function toPhong(mat: THREE.Material): THREE.Material {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial) return mat;
  const phong = new THREE.MeshPhongMaterial({
    name: m.name,
    color: m.color,
    map: m.map,
    normalMap: m.normalMap,
    emissive: m.emissive,
    emissiveMap: m.emissiveMap,
    alphaMap: m.alphaMap,
    transparent: m.transparent,
    opacity: m.opacity,
    alphaTest: m.alphaTest,
    side: m.side,
    vertexColors: m.vertexColors,
    depthWrite: m.depthWrite,
    shininess: Math.round((1 - m.roughness) ** 2 * 120) + 4,
    specular: new THREE.Color().setScalar(0.12 + (1 - m.roughness) * 0.3),
  });
  if (m.normalMap) phong.normalScale.copy(m.normalScale);
  // Glass: many models make it clear with transmission, which Phong hasn't got, so it came out
  // as dark smoked glass you couldn't see the road through from the seat.
  const physical = m as THREE.MeshPhysicalMaterial;
  if (SEE_THROUGH.test(m.name) || (physical.transmission ?? 0) > 0) {
    phong.transparent = true;
    phong.opacity = Math.min(phong.opacity, 0.18);
    phong.depthWrite = false;
    phong.color = m.color.clone().lerp(new THREE.Color(0xdde6ee), 0.6);
  }
  return phong;
}

// ---- Loading -------------------------------------------------------------------------------

/** Each class's model files (from models.json; by default just gt3.glb / lmh.glb). */
type ModelSpec = BodySpec & { id?: string; name?: string; author?: string };
const specs = new Map<CarClassId, ModelSpec[]>();
/** Loaded (or failed: null) bodies by file. */
const prepared = new Map<string, PreparedBody | null>();
const pending = new Map<string, Promise<void>>();
/** The body your own car uses per class, for the cockpit and bolted-on cameras. */
const own = new Map<CarClassId, PreparedBody>();
/** Classes with cars on screen: only their models are loaded in the background. */
const shown = new Set<CarClassId>();
let listing: Promise<void> | null = null;
let loader: Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader> | null = null;
let version = 0;

/** Bumps when a body finishes loading or your choice changes, so the view rebuilds its cars. */
export function customBodyVersion(): number {
  return version;
}

/** Where your own car's loaded body has its driver, if its steering wheel was found. */
export function customBodyCockpit(body: CarClassId | undefined): ModelCockpit | null {
  return (body && own.get(body)?.cockpit) || null;
}

/** Your own car's loaded body's shape for a class. */
export function customBodyShape(body: CarClassId | undefined): BodyShape | undefined {
  return body ? own.get(body)?.shape : undefined;
}

/**
 * What a car shows, as a key that changes only when that car's own model changes (its pick, or the
 * pick finishing loading). The view rebuilds a car when its key changes: rebuilding every car
 * whenever any model loaded (9 of them in the background) froze a full grid for over a second.
 */
export function customBodyKey(body: CarClassId | undefined, carId: string, mine: boolean, choice: string | undefined, ghost: boolean): string {
  if (!body || ghost || !hasCustomBody(body)) return '';
  shown.add(body);
  const spec = specFor(body, carId, mine, choice);
  if (!spec) return 'built-in';
  const ready = prepared.get(spec.file);
  // Waiting: a stand-in (yours: the one you had) or the built-in car, whichever there is now.
  if (ready === undefined) return `${spec.file}:wait:${(mine && own.has(body)) || anyReady(body) ? 'stand-in' : 'built-in'}`;
  return spec.file;
}

/** There are model files for this class. */
export function hasCustomBody(body: CarClassId | undefined): boolean {
  return !!body && (specs.get(body)?.length ?? 0) > 0;
}

/**
 * The model a car shows: yours is the car you drive in that class (garage), another player's the
 * car they picked; bots get one picked from their id, so a race has a mix. None = the built-in car.
 */
function specFor(body: CarClassId, carId: string, mine: boolean, choice: string | undefined): ModelSpec | undefined {
  const list = specs.get(body);
  if (!list?.length) return undefined;
  const wanted = mine ? drivenCar(body) : choice;
  if (wanted) return list.find((s) => s.id === wanted);
  if (mine || !carId.startsWith('bot')) return undefined;
  let h = 2166136261;
  for (let i = 0; i < carId.length; i++) h = Math.imul(h ^ carId.charCodeAt(i), 16777619);
  return list[(h >>> 0) % list.length];
}

/** K: drive your next car of this class (the ones you own, then the built-in one). Says what changed. */
export function cycleOwnModel(body: CarClassId | undefined): string | null {
  const list = body ? specs.get(body) : undefined;
  if (!body || !list?.length) return null;
  const owned = new Set(ownedCars());
  const mine = list.filter((s) => s.id && owned.has(s.id));
  if (!mine.length) return 'UNLOCK REAL CARS IN THE GARAGE';
  const choices: (ModelSpec | null)[] = [...mine, null];
  const at = choices.findIndex((s) => (s?.id ?? null) === drivenCar(body));
  const next = choices[(at + 1) % choices.length];
  driveCar(body, next?.id ?? null);
  version++;
  if (!next) return 'CAR: BUILT-IN';
  const name = next.name ?? next.file.replace(/^.*\//, '').replace(/\.gl(b|tf)$/i, '').replace(/[_-]+/g, ' ');
  // CC BY: the model's author is credited when it's picked (all credits in public/models/CREDITS.md).
  return `CAR: ${name}${next.author ? ` · model by ${next.author}` : ''}`;
}

/** Reads the list of model files once (fine to call every frame); models load when a car needs one. */
export function loadCustomBodies(): Promise<void> {
  listing ??= (async () => {
    const base = `${import.meta.env.BASE_URL}models/`;
    let config: Record<string, BodySpec | BodySpec[]> = { gt3: { file: 'gt3.glb' }, lmh: { file: 'lmh.glb' } };
    try {
      const res = await fetch(`${base}models.json`);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) config = { ...config, ...(await res.json()) };
    } catch {
      /* no config: defaults */
    }
    for (const [body, entry] of Object.entries(config) as [CarClassId, BodySpec | BodySpec[]][]) {
      if (!TARGET[body]) continue;
      const list = (Array.isArray(entry) ? entry : [entry]).filter((s) => s?.file);
      // Only files that are there (a HEAD request; the dev server answers a missing one with the page).
      const found = await Promise.all(
        list.map(async (s) => {
          try {
            const res = await fetch(base + s.file, { method: 'HEAD' });
            return res.ok && !(res.headers.get('content-type') ?? '').includes('html') ? s : null;
          } catch {
            return null;
          }
        }),
      );
      const ok = found.filter((s): s is BodySpec => !!s);
      if (ok.length) specs.set(body, ok);
    }
    if (specs.size) {
      version++;
      preloadAll();
    }
  })();
  return listing;
}

async function gltfLoader() {
  loader ??= (async () => {
    const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
      import('three/examples/jsm/libs/meshopt_decoder.module.js'),
    ]);
    const l = new GLTFLoader();
    // Compressed models: Meshopt decodes here; Draco's decoder is fetched only for a Draco file.
    l.setMeshoptDecoder(MeshoptDecoder);
    l.setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'));
    return l;
  })();
  return loader;
}

/** The body for this spec if it's loaded; starts loading it if not. */
function need(body: CarClassId, spec: BodySpec): PreparedBody | null {
  const ready = prepared.get(spec.file);
  if (ready !== undefined) return ready;
  void load(body, spec);
  return null;
}

/** Loads (once) and prepares a model file. */
function load(body: CarClassId, spec: BodySpec): Promise<void> {
  if (prepared.has(spec.file)) return Promise.resolve();
  const busy = pending.get(spec.file);
  if (busy) return busy;
  const job = (async () => {
    const base = `${import.meta.env.BASE_URL}models/`;
    let result: PreparedBody | null = null;
    try {
      const l = await gltfLoader();
      const gltf = await l.loadAsync(base + spec.file);
      result = prepareBody(gltf.scene, spec, body);
      if (result) console.info(`[models] ${body}: ${spec.file}, ${result.triangles} triangles, ${result.parts.length} draw calls (${result.parts.filter((p) => p.far).length} from afar), fitted by ${result.fit}, ${result.cockpit ? (result.cockpit.whole ? 'own interior' : 'own interior, game wheel rim') : 'built-in cockpit'}`, result.cockpit ? JSON.stringify({ wheel: result.cockpit.wheel.map((v) => +v.toFixed(2)), eye: result.cockpit.eye.map((v) => +v.toFixed(2)), look: result.cockpit.look.map((v) => +v.toFixed(2)), fov: Math.round(result.cockpit.fov) }) : '');
    } catch (e) {
      console.warn(`[models] ${body}: could not load ${spec.file}`, e);
    }
    prepared.set(spec.file, result);
    pending.delete(spec.file);
    version++;
  })();
  pending.set(spec.file, job);
  return job;
}

/**
 * Loads the models of the classes on screen in the background, one at a time (your own choices
 * first) with a pause between them, a few seconds after the 3D view opens, so K switches at once
 * and a race's grid doesn't wait. Each one takes 0.1-0.25 s to prepare, so they're spread out.
 */
let preloading = false;
function preloadAll(): void {
  if (preloading) return;
  preloading = true;
  setTimeout(async () => {
    const next = (): [CarClassId, BodySpec] | null => {
      for (const body of shown) {
        const mine = specFor(body, '', true, undefined);
        if (mine && !prepared.has(mine.file)) return [body, mine];
      }
      for (const body of shown) for (const spec of specs.get(body) ?? []) if (!prepared.has(spec.file)) return [body, spec];
      return null;
    };
    // Classes can appear later (a new race): keep looking while the game runs.
    for (;;) {
      const job = next();
      if (job) {
        await load(job[0], job[1]);
        await new Promise((r) => setTimeout(r, 800));
      } else await new Promise((r) => setTimeout(r, 2000));
    }
  }, 3000);
}

/** Any model of this class that is ready, to stand in while the right one loads. */
function anyReady(body: CarClassId): PreparedBody | null {
  for (const spec of specs.get(body) ?? []) {
    const ready = prepared.get(spec.file);
    if (ready) return ready;
  }
  return null;
}

// ---- The model ------------------------------------------------------------------------------

/**
 * A built-in car with its outside bodywork swapped for a loaded one. Your own car also gets the
 * model's interior and the game's steering wheel, arms and dash display moved onto the model's
 * wheel (when one was found; else the built-in cockpit, shown only from the inside cameras).
 */
export class CustomBodyCar implements Car3d {
  /** Near: every part; far (`FAR_FROM`): the big ones only. Three.js picks per camera as it draws. */
  private readonly body = new THREE.LOD();
  private readonly near = new THREE.Group();
  private readonly far = new THREE.Group();
  /** The built-in cockpit (own car, model without a usable interior), only for the inside cameras. */
  private readonly cockpit = new THREE.Group();
  /** The model's interior and the game's wheel on it (own car). */
  private readonly interior = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly farMeshes: THREE.Mesh[] = [];
  private readonly ownMats: THREE.Material[] = [];
  private readonly overlay: THREE.MeshLambertMaterial;
  /** Built-in parts the built-in cockpit hid for good (the small stand-in wheel). */
  private readonly keepHidden = new Set<THREE.Object3D>();
  private ownWheel: SteeringWheel | null = null;
  /** The model's steering wheel, turning as the game's (hidden) one does. */
  private readonly steering = new THREE.Group();
  private mirrorGlass: { mesh: THREE.Mesh; glass: THREE.Material; plain: THREE.Material }[] = [];
  private painted: string | null = null;
  private outside = true;

  constructor(
    private readonly inner: Car3d & { readonly exterior: THREE.Object3D[] },
    private readonly ready: PreparedBody,
    private readonly livery: Livery,
  ) {
    for (const part of ready.parts) {
      const mesh = this.meshFor(part);
      this.near.add(mesh);
      if (part.far) {
        // Same geometry and material: no extra memory, just fewer draw calls.
        const copy = new THREE.Mesh(mesh.geometry, mesh.material);
        this.farMeshes.push(copy);
        this.far.add(copy);
      }
    }
    this.body.addLevel(this.near, 0);
    if (this.far.children.length) this.body.addLevel(this.far, FAR_FROM);
    this.overlay = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.ownMats.push(this.overlay);
    inner.group.add(this.body);
    this.show(true);
  }

  private meshFor(part: BodyPart): THREE.Mesh {
    let mat = part.material;
    if (part.tinted && 'color' in mat) {
      mat = mat.clone();
      (mat as THREE.MeshPhongMaterial).color.set(this.livery.body);
      this.ownMats.push(mat);
    }
    const mesh = new THREE.Mesh(part.geometry, mat);
    this.meshes.push(mesh);
    return mesh;
  }

  /** The model's own interior is in use (own car, wheel found): the loaded body stays on inside too. */
  private get modelCockpit(): boolean {
    return this.ownWheel !== null;
  }

  private show(outside: boolean): void {
    this.outside = outside;
    const built = !outside && !this.modelCockpit;
    this.body.visible = !built;
    this.cockpit.visible = built;
    // The built-in driver only with the built-in body, and never from the seat.
    for (const o of this.inner.exterior) o.visible = built && !this.keepHidden.has(o) && !(o.userData.driver && !outside);
  }

  get group(): THREE.Group {
    return this.inner.group;
  }
  get wheel(): SteeringWheel | null {
    return this.ownWheel ?? this.inner.wheel;
  }
  set wheel(w: SteeringWheel | null) {
    this.inner.wheel = w;
  }
  update(x: number, y: number, heading: number, steer: number, drsOpen: boolean, compound: Compound): void {
    this.inner.update(x, y, heading, steer, drsOpen, compound);
    if (this.ownWheel) this.steering.rotation.x = this.ownWheel.group.rotation.x;
  }
  setWear(wear: number): void {
    this.inner.setWear(wear);
  }
  setShadow(reach: number, angle: number): void {
    this.inner.setShadow(reach, angle);
  }
  setLost(lost: number): void {
    this.inner.setLost(lost);
    // setLost shows the built-in splitter and wing again.
    this.show(this.outside);
  }
  setDamage(d: CarParts): void {
    this.inner.setDamage(d);
  }
  paint(color: string | null): void {
    this.inner.paint(color);
    if (color === this.painted) return;
    this.painted = color;
    if (color) {
      this.overlay.color.set(color);
      this.overlay.emissive.set(color).multiplyScalar(0.45);
    }
    // Rainbow item etc.: the whole loaded body takes the colour, then gets its materials back.
    for (const m of [...(this.near.children as THREE.Mesh[]), ...this.farMeshes]) {
      m.userData.mat ??= m.material;
      m.material = color ? this.overlay : m.userData.mat;
    }
  }
  setBrakeHeat(heat: number): void {
    this.inner.setBrakeHeat(heat);
  }
  addMirrorGlass(view: THREE.Texture): void {
    if (!this.modelCockpit) {
      this.intoCockpit(() => this.inner.addMirrorGlass(view));
      return;
    }
    // The model's own mirrors show the view behind.
    const glass = new THREE.MeshBasicMaterial({ map: view });
    this.ownMats.push(glass);
    for (const mesh of this.meshes) {
      if (!/mirror/i.test(mesh.material instanceof THREE.Material ? mesh.material.name : '')) continue;
      this.mirrorGlass.push({ mesh, glass, plain: mesh.material as THREE.Material });
      mesh.material = glass;
    }
  }
  addSteeringWheel(): SteeringWheel {
    const cp = this.ready.cockpit;
    if (!cp) return this.intoCockpit(() => this.inner.addSteeringWheel());
    for (const part of this.ready.interior) this.interior.add(this.meshFor(part));
    const [wx, wy, wz] = cp.wheel;
    const layout: Cockpit = {
      wheel: cp.wheel,
      tilt: cp.tilt,
      // Where the game's GT driver has them, measured from their wheel.
      shoulder: [wx - 0.45, wy + 0.1, 0.2],
      style: 'gt',
      display: [wx + 0.33, wy + 0.17, wz],
    };
    const wheel = new SteeringWheel(this.livery, layout);
    // The model's wheel and dash are better looking: keep the game's gloves and arms only.
    wheel.dash.visible = false;
    const turning = wheel.group.children[0];
    if (cp.whole) for (const o of turning.children) if ((o as THREE.Mesh).isMesh) o.visible = false;
    for (const part of this.ready.steering) this.steering.add(this.meshFor(part));
    this.steering.position.set(wx, wy, wz);
    this.interior.add(wheel.group, wheel.arms, this.steering);
    this.inner.group.add(this.interior);
    this.ownWheel = wheel;
    this.show(this.outside);
    return wheel;
  }

  /** Whatever `add` puts on the car (frame, cage, seat, wheel, arms, mirror glass) is shown only inside. */
  private intoCockpit<T>(add: () => T): T {
    const group = this.inner.group;
    const before = new Set(group.children);
    for (const o of this.inner.exterior) o.visible = true;
    const out = add();
    for (const o of this.inner.exterior) if (!o.visible) this.keepHidden.add(o);
    for (const o of [...group.children]) if (!before.has(o)) this.cockpit.add(o);
    group.add(this.cockpit);
    this.show(this.outside);
    return out;
  }
  set driverVisible(on: boolean) {
    this.inner.driverVisible = on;
    // Always: that setter shows the built-in driver again, who'd poke through a body of another shape.
    this.show(on);
  }
  set haloVisible(on: boolean) {
    this.inner.haloVisible = on;
  }
  set mirrorsVisible(on: boolean) {
    this.inner.mirrorsVisible = on;
    for (const m of this.mirrorGlass) if (!this.painted) m.mesh.material = on ? m.glass : m.plain;
  }
  dispose(): void {
    this.body.removeFromParent();
    this.interior.removeFromParent();
    for (const m of this.ownMats) m.dispose();
    this.ownWheel?.dispose();
    this.inner.dispose();
  }
}

/**
 * Wraps a GT3 / Hypercar model in a loaded body when there is one (never for ghosts): `carId`
 * picks which, `mine` is your own car (your choice, and the cockpit cameras follow its body).
 */
export function withCustomBody(model: Car3d & { readonly exterior?: THREE.Object3D[] }, body: CarClassId | undefined, livery: Livery, ghost: boolean, carId: string, mine: boolean, choice?: string): Car3d {
  if (!body || ghost || !model.exterior) return model;
  shown.add(body);
  const spec = specFor(body, carId, mine, choice);
  if (!spec) {
    if (mine) own.delete(body);
    return model;
  }
  // While the right model loads, keep the one you had (or any loaded one), never the built-in car.
  const wanted = need(body, spec);
  const ready = wanted ?? (mine ? own.get(body) : undefined) ?? anyReady(body);
  if (mine && ready) own.set(body, ready);
  if (!ready) return model;
  return new CustomBodyCar(model as Car3d & { readonly exterior: THREE.Object3D[] }, ready, livery);
}
