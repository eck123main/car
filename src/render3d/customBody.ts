import * as THREE from 'three';
import { deinterleaveGeometry, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarParts } from '../physics/car';
import type { Livery } from '../render/livery';
import type { CarClassId } from '../sim/carClass';
import type { Compound } from '../sim/tyres';
import type { Car3d, SteeringWheel } from './carModel';
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
}

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

export interface PreparedBody {
  shape: BodyShape;
  parts: BodyPart[];
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

  const kept: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  const wheels: { box: THREE.Box3; name: string }[] = [];
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
    geo.applyMatrix4(mesh.matrixWorld);
    const pieces: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    if (Array.isArray(mesh.material) && geo.groups.length) {
      for (const g of geo.groups) pieces.push({ geo: subGeometry(geo, g.start, g.count), mat: mats[g.materialIndex ?? 0] });
      geo.dispose();
    } else pieces.push({ geo, mat: mats[0] });
    for (const piece of pieces) {
      const name = `${named(mesh)} ${piece.mat.name}`;
      if (drop && drop.test(piece.mat.name)) {
        piece.geo.dispose();
        continue;
      }
      if (hide.test(name)) {
        piece.geo.computeBoundingBox();
        wheels.push({ box: piece.geo.boundingBox!.clone(), name });
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
  const { ahead, behind } = sides(turned());
  const says = (list: { name: string }[], re: RegExp) => list.filter((w) => re.test(w.name)).length;
  const FRONT = /front|[_\-. ]f[lr](?![a-z])/i;
  const REAR = /rear|back|[_\-. ]r[lr](?![a-z])/i;
  const vote = says(ahead, REAR) + says(behind, FRONT) - says(ahead, FRONT) - says(behind, REAR);
  const width = (list: { box: THREE.Box3 }[]) => Math.max(0, ...list.map((w) => w.box.max.z - w.box.min.z));
  if (vote > 0 || (vote === 0 && ahead.length && behind.length && width(ahead) > width(behind) * 1.03)) degrees += 180;
  degrees += spec.turn ?? 0;
  const turn = turned();
  for (const k of kept) k.geo.applyMatrix4(turn);
  const hubs = wheels.map((w) => w.box.clone().applyMatrix4(turn).getCenter(new THREE.Vector3()));
  const wheelBottoms = wheels.map((w) => w.box.clone().applyMatrix4(turn).min.y);
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
  for (const k of kept) k.geo.applyMatrix4(place);

  // One mesh per material; materials that look the same count as one.
  const same = new Map<string, THREE.Material>();
  for (const k of kept) {
    const key = looks(k.mat);
    k.mat = same.get(key) ?? (same.set(key, k.mat), k.mat);
  }
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const k of kept) {
    const list = byMat.get(k.mat) ?? [];
    list.push(k.geo);
    byMat.set(k.mat, list);
  }
  const parts: BodyPart[] = [];
  let triangles = 0;
  for (const [mat, geos] of byMat) {
    const merged = mergeAll(geos);
    for (const geometry of merged) {
      triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
      // A textured paint is the model's own livery: tinting it would spoil it.
      const textured = !!(mat as THREE.MeshStandardMaterial).map;
      parts.push({ geometry, material: toPhong(mat), tinted: !!tint && !textured && tint.test(mat.name) });
    }
  }
  return { parts, fit, triangles: Math.round(triangles), shape: measure(parts) };
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
  return phong;
}

// ---- Loading -------------------------------------------------------------------------------

const prepared = new Map<CarClassId, PreparedBody>();
let loading: Promise<void> | null = null;
let version = 0;

/** Bumps when a body finishes loading, so the view can rebuild its cars. */
export function customBodyVersion(): number {
  return version;
}

/** The loaded body's shape for a class, if one is loaded. */
export function customBodyShape(body: CarClassId | undefined): BodyShape | undefined {
  return body ? prepared.get(body)?.shape : undefined;
}

export function hasCustomBody(body: CarClassId | undefined): boolean {
  return !!body && prepared.has(body);
}

/** Starts loading the model files once (fine to call every frame). */
export function loadCustomBodies(): Promise<void> {
  loading ??= (async () => {
    const base = `${import.meta.env.BASE_URL}models/`;
    let specs: Partial<Record<CarClassId, BodySpec>> = { gt3: { file: 'gt3.glb' }, lmh: { file: 'lmh.glb' } };
    try {
      const res = await fetch(`${base}models.json`);
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) specs = { ...specs, ...(await res.json()) };
    } catch {
      /* no config: defaults */
    }
    const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
      import('three/examples/jsm/libs/meshopt_decoder.module.js'),
    ]);
    const loader = new GLTFLoader();
    // Compressed models: Meshopt decodes here; Draco's decoder is fetched only for a Draco file.
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'));
    for (const [body, spec] of Object.entries(specs) as [CarClassId, BodySpec][]) {
      if (!spec?.file || !TARGET[body]) continue;
      try {
        const url = base + spec.file;
        let gltf;
        if (spec.file.toLowerCase().endsWith('.glb')) {
          const res = await fetch(url);
          if (!res.ok) continue;
          const data = await res.arrayBuffer();
          // The dev server answers a missing file with the page itself: only real GLB data counts.
          if (data.byteLength < 12 || new TextDecoder().decode(data.slice(0, 4)) !== 'glTF') continue;
          gltf = await loader.parseAsync(data, base);
        } else gltf = await loader.loadAsync(url);
        const ready = prepareBody(gltf.scene, spec, body);
        if (!ready) continue;
        prepared.set(body, ready);
        version++;
        console.info(`[models] ${body}: ${spec.file}, ${ready.triangles} triangles, ${ready.parts.length} draw calls, fitted by ${ready.fit}`);
      } catch (e) {
        console.warn(`[models] ${body}: could not load ${spec.file}`, e);
      }
    }
  })();
  return loading;
}

// ---- The model ------------------------------------------------------------------------------

/** A built-in car with its outside bodywork swapped for a loaded one. */
export class CustomBodyCar implements Car3d {
  private readonly body = new THREE.Group();
  /** The built-in cockpit (own car), only for the inside cameras: it would poke through a different body. */
  private readonly cockpit = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private readonly ownMats: THREE.Material[] = [];
  private readonly overlay: THREE.MeshLambertMaterial;
  private painted: string | null = null;
  private outside = true;

  constructor(
    private readonly inner: Car3d & { readonly exterior: THREE.Object3D[] },
    ready: PreparedBody,
    livery: Livery,
  ) {
    for (const part of ready.parts) {
      let mat = part.material;
      if (part.tinted && 'color' in mat) {
        mat = mat.clone();
        (mat as THREE.MeshPhongMaterial).color.set(livery.body);
        this.ownMats.push(mat);
      }
      const mesh = new THREE.Mesh(part.geometry, mat);
      this.meshes.push(mesh);
      this.body.add(mesh);
    }
    this.overlay = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.ownMats.push(this.overlay);
    inner.group.add(this.body);
    this.show(true);
  }

  private show(outside: boolean): void {
    this.outside = outside;
    this.body.visible = outside;
    this.cockpit.visible = !outside;
    for (const o of this.inner.exterior) o.visible = !outside;
  }

  get group(): THREE.Group {
    return this.inner.group;
  }
  get wheel(): SteeringWheel | null {
    return this.inner.wheel;
  }
  set wheel(w: SteeringWheel | null) {
    this.inner.wheel = w;
  }
  update(x: number, y: number, heading: number, steer: number, drsOpen: boolean, compound: Compound): void {
    this.inner.update(x, y, heading, steer, drsOpen, compound);
  }
  setWear(wear: number): void {
    this.inner.setWear(wear);
  }
  setShadow(reach: number, angle: number): void {
    this.inner.setShadow(reach, angle);
  }
  setLost(lost: number): void {
    this.inner.setLost(lost);
    // setLost shows the built-in splitter and wing again: keep them hidden outside.
    if (this.outside) this.show(true);
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
    for (const m of this.meshes) {
      m.userData.mat ??= m.material;
      m.material = color ? this.overlay : m.userData.mat;
    }
  }
  setBrakeHeat(heat: number): void {
    this.inner.setBrakeHeat(heat);
  }
  addMirrorGlass(view: THREE.Texture): void {
    this.intoCockpit(() => this.inner.addMirrorGlass(view));
  }
  addSteeringWheel(): SteeringWheel {
    return this.intoCockpit(() => this.inner.addSteeringWheel());
  }

  /** Whatever `add` puts on the car (frame, cage, seat, wheel, arms, mirror glass) is shown only inside. */
  private intoCockpit<T>(add: () => T): T {
    const group = this.inner.group;
    const before = new Set(group.children);
    const out = add();
    for (const o of [...group.children]) if (!before.has(o)) this.cockpit.add(o);
    group.add(this.cockpit);
    this.show(this.outside);
    return out;
  }
  set driverVisible(on: boolean) {
    this.inner.driverVisible = on;
    if (on !== this.outside) this.show(on);
  }
  set haloVisible(on: boolean) {
    this.inner.haloVisible = on;
  }
  set mirrorsVisible(on: boolean) {
    this.inner.mirrorsVisible = on;
  }
  dispose(): void {
    this.body.removeFromParent();
    for (const m of this.ownMats) m.dispose();
    this.inner.dispose();
  }
}

/** Wraps a GT3 / Hypercar model in its loaded body when there is one (never for ghosts). */
export function withCustomBody(model: Car3d & { readonly exterior?: THREE.Object3D[] }, body: CarClassId | undefined, livery: Livery, ghost: boolean): Car3d {
  const ready = body && !ghost ? prepared.get(body) : undefined;
  if (!ready || !model.exterior) return model;
  return new CustomBodyCar(model as Car3d & { readonly exterior: THREE.Object3D[] }, ready, livery);
}
