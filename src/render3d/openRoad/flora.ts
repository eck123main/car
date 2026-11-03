import * as THREE from 'three';
import { type PlantKind, type Rgb, rgb } from '../../sim/openRoad/biomes';
import type { Land } from '../../sim/openRoad/land';
import { hash2 } from '../../sim/openRoad/noise';
import { biomeAtPoint, pickFrom, pickPlant, PLANT_TILE, plantsIn } from '../../sim/openRoad/plants';
import { ROAD_HALF, SHOULDER } from '../../sim/openRoad/road';

/** Sides of a low-poly cone or trunk. */
const SIDES = 6;
/** Trees come in big cheap tiles (m) out to this far... */
const FAR_TILE = PLANT_TILE * 2;
const TREE_RANGE = 3000;
/** ...and each is swapped for four detailed ones when the camera is this close to it. */
const NEAR_RANGE = 400;
/** Plants shorter than this aren't drawn in the far tiles. */
const FAR_MIN_SIZE = 5;
/** Small things by the road. */
const DETAIL_TILE = 160;
const DETAIL_RANGE = 280;

/** One plant shape: a unit tall, standing at the origin, ready to copy many times. */
interface Template {
  pos: number[];
  nor: number[];
  /** Colour share from the plant's tint: 1 = all tint, 0 = fixed (the rest is `fixed`). */
  tint: number[];
  fixed: number[];
  index: number[];
  /** Wider than tall for rocks: scale sideways by this. */
}

class Builder implements Template {
  pos: number[] = [];
  nor: number[] = [];
  tint: number[] = [];
  fixed: number[] = [];
  index: number[] = [];

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, tint: number, fixed: Rgb): number {
    const n = this.pos.length / 3;
    const len = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nor.push(nx / len, ny / len, nz / len);
    this.tint.push(tint);
    this.fixed.push(fixed[0], fixed[1], fixed[2]);
    return n;
  }

  /** A cone or cylinder between two heights. */
  cone(y0: number, y1: number, r0: number, r1: number, tint: number, fixed: Rgb, opts: { sides?: number; ox?: number; oz?: number; topTint?: number; topFixed?: Rgb; lean?: number } = {}): void {
    const sides = opts.sides ?? SIDES;
    const ox = opts.ox ?? 0;
    const oz = opts.oz ?? 0;
    const up = (r0 - r1) / Math.max(0.01, y1 - y0);
    const first = this.pos.length / 3;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + y0;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.vert(ox + c * r0, y0, oz + s * r0, c, up, s, tint, fixed);
    }
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + y0;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.vert(ox + (opts.lean ?? 0) + c * r1, y1, oz + s * r1, c, up + 0.3, s, opts.topTint ?? tint, opts.topFixed ?? fixed);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const a = first + i;
      const b = first + j;
      const c = first + sides + i;
      const d = first + sides + j;
      this.index.push(a, c, b, b, c, d);
    }
    // The bottom of foliage, seen from below.
    if (r0 > 0.08 && y0 > 0.02) {
      const hub = this.vert(ox, y0 - 0.005, oz, 0, -1, 0, tint, fixed);
      for (let i = 0; i < sides; i++) this.index.push(first + i, first + (i + 1) % sides, hub);
    }
  }

  /** A lumpy ball: bent a bit by position so it doesn't look machined. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, tint: number, fixed: Rgb, seed = 0): void {
    const first = this.pos.length / 3;
    const rings = 2;
    const sides = 6;
    const top = this.vert(cx, cy + ry, cz, 0, 1, 0, tint, fixed);
    for (let j = 0; j < rings; j++) {
      const lat = (Math.PI * (j + 1)) / (rings + 1);
      const sy = Math.cos(lat);
      const cr = Math.sin(lat);
      for (let i = 0; i < sides; i++) {
        const a = ((i + (j % 2) * 0.5) / sides) * Math.PI * 2;
        const bump = 1 + 0.16 * Math.sin(a * 3 + j * 2.3 + seed);
        const x = Math.cos(a) * cr * bump;
        const z = Math.sin(a) * cr * bump;
        this.vert(cx + x * rx, cy + sy * ry, cz + z * rx, x, sy, z, tint, fixed);
      }
    }
    const bottom = this.vert(cx, cy - ry, cz, 0, -1, 0, tint, fixed);
    const at = (j: number, i: number) => first + 1 + j * sides + ((i + sides) % sides);
    for (let i = 0; i < sides; i++) {
      this.index.push(top, at(0, i + 1), at(0, i));
      this.index.push(bottom, at(rings - 1, i), at(rings - 1, i + 1));
    }
    for (let j = 0; j + 1 < rings; j++) {
      for (let i = 0; i < sides; i++) {
        const off = j % 2 === 0 ? 0 : 1;
        this.index.push(at(j, i), at(j, i + 1), at(j + 1, i + off));
        this.index.push(at(j, i + 1), at(j + 1, i + 1 + off), at(j + 1, i + off));
      }
    }
  }

  /** A very cheap lump: six points. */
  lump(cx: number, cy: number, cz: number, rx: number, ry: number): void {
    const n = this.pos.length / 3;
    this.vert(cx, cy + ry, cz, 0, 1, 0, 1, BLACK);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.vert(cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rx, Math.cos(a), 0.2, Math.sin(a), 0.92, BLACK);
    }
    this.vert(cx, cy - ry, cz, 0, -1, 0, 0.8, BLACK);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.index.push(n, n + 1 + j, n + 1 + i, n + 5, n + 1 + i, n + 1 + j);
    }
  }

  /** Crossed flat blades (tufts of grass), seen from any side. */
  blade(angle: number, width: number, height: number, tint: number, fixed: Rgb, lean = 0.2): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const a = this.vert(-c * width, 0, -s * width, 0, 1, 0, tint * 0.7, fixed);
    const b = this.vert(c * width, 0, s * width, 0, 1, 0, tint * 0.7, fixed);
    const t = this.vert(-s * lean, height, c * lean, 0, 1, 0, tint, fixed);
    // Both sides: this is the one shape drawn with no thickness.
    this.index.push(a, t, b, b, t, a);
  }
}

const BLACK: Rgb = [0, 0, 0];
const BARK: Rgb = rgb('#4a3a2c');
const BIRCH_BARK: Rgb = rgb('#d8d4c8');
const PALM_BARK: Rgb = rgb('#7a6a4e');
const WHITE: Rgb = rgb('#f6f9fc');

/** The same plant from far away: as few triangles as still reads as a tree. */
function makeFarTemplate(kind: PlantKind): Template {
  const b = new Builder();
  switch (kind) {
    case 'pine':
      b.cone(0.02, 1, 0.25, 0.005, 1, BLACK, { sides: 4 });
      break;
    case 'snowPine':
      b.cone(0.02, 1, 0.24, 0.005, 0.75, WHITE, { sides: 4, topTint: 0, topFixed: WHITE });
      break;
    case 'broadleaf':
      b.lump(0, 0.58, 0, 0.42, 0.42);
      break;
    case 'birch':
      b.lump(0, 0.66, 0, 0.21, 0.34);
      break;
    case 'poplar':
      b.lump(0, 0.54, 0, 0.14, 0.46);
      break;
    case 'palm':
      b.lump(0.1, 0.88, 0, 0.32, 0.14);
      break;
    default:
      b.cone(0.02, 1, 0.08, 0.05, 1, BLACK, { sides: 3 });
  }
  return b;
}

function makeTemplate(kind: PlantKind): Template {
  const b = new Builder();
  switch (kind) {
    case 'pine':
      b.cone(0, 0.22, 0.03, 0.02, 0, BARK, { sides: 3 });
      b.cone(0.14, 0.56, 0.27, 0.09, 1, BLACK);
      b.cone(0.42, 0.78, 0.2, 0.06, 1, BLACK);
      b.cone(0.66, 1, 0.13, 0.005, 1, BLACK);
      break;
    case 'snowPine':
      b.cone(0, 0.2, 0.03, 0.02, 0, BARK, { sides: 3 });
      b.cone(0.13, 0.54, 0.26, 0.08, 1, BLACK, { topTint: 0, topFixed: WHITE });
      b.cone(0.4, 0.76, 0.19, 0.05, 1, BLACK, { topTint: 0, topFixed: WHITE });
      b.cone(0.63, 1, 0.12, 0.005, 0.4, WHITE, { topTint: 0, topFixed: WHITE });
      break;
    case 'broadleaf':
      b.cone(0, 0.42, 0.04, 0.025, 0, BARK, { sides: 3 });
      b.blob(0.03, 0.66, 0.02, 0.32, 0.27, 1, BLACK, 1);
      b.blob(-0.1, 0.48, -0.06, 0.28, 0.2, 0.9, BLACK, 2);
      break;
    case 'birch':
      b.cone(0, 0.6, 0.022, 0.012, 0, BIRCH_BARK, { sides: 3 });
      b.blob(0, 0.68, 0, 0.2, 0.3, 1, BLACK, 4);
      break;
    case 'poplar':
      b.cone(0, 0.2, 0.03, 0.02, 0, BARK, { sides: 3 });
      b.blob(0, 0.58, 0, 0.13, 0.42, 1, BLACK, 5);
      break;
    case 'cactus':
      b.cone(0, 1, 0.075, 0.055, 1, BLACK);
      b.cone(0.42, 0.5, 0.05, 0.05, 1, BLACK, { sides: 4, ox: 0.09 });
      b.cone(0.5, 0.78, 0.05, 0.04, 1, BLACK, { sides: 4, ox: 0.17 });
      b.cone(0.3, 0.36, 0.045, 0.045, 1, BLACK, { sides: 4, ox: -0.08 });
      b.cone(0.36, 0.62, 0.045, 0.035, 1, BLACK, { sides: 4, ox: -0.15 });
      break;
    case 'palm': {
      b.cone(0, 0.92, 0.035, 0.018, 0, PALM_BARK, { sides: 4, lean: 0.1 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        // A drooping leaf as two flat triangles.
        const base = 0.92;
        const nv = b.pos.length / 3;
        const px = c * 0.34 + 0.1;
        const pz = s * 0.34;
        b.pos.push(0.1 - s * 0.04, base, c * 0.04, 0.1 + s * 0.04, base, -c * 0.04, px, base - 0.17, pz, 0.1 + c * 0.16 - s * 0.06, base + 0.03, s * 0.16 + c * 0.06, 0.1 + c * 0.16 + s * 0.06, base + 0.03, s * 0.16 - c * 0.06);
        for (let v = 0; v < 5; v++) {
          b.nor.push(0, 1, 0);
          b.tint.push(1);
          b.fixed.push(0, 0, 0);
        }
        b.index.push(nv, nv + 3, nv + 1, nv + 1, nv + 3, nv, nv, nv + 3, nv + 2, nv + 2, nv + 3, nv, nv + 1, nv + 2, nv + 4, nv + 4, nv + 2, nv + 1, nv + 1, nv + 4, nv + 3, nv + 3, nv + 4, nv + 1, nv + 3, nv + 4, nv + 2, nv + 2, nv + 4, nv + 3);
      }
      break;
    }
    case 'shrub':
      b.blob(0, 0.5, 0, 0.62, 0.5, 1, BLACK, 6);
      b.blob(0.42, 0.34, 0.2, 0.36, 0.34, 0.9, BLACK, 7);
      break;
    case 'rock':
      b.blob(0, 0.42, 0, 0.78, 0.55, 1, BLACK, 8);
      b.blob(0.56, 0.24, 0.3, 0.42, 0.28, 0.9, BLACK, 9);
      break;
    case 'boulder':
      b.blob(0, 0.45, 0, 0.9, 0.55, 1, BLACK, 10);
      break;
    case 'stone':
      b.blob(0, 0.35, 0, 0.8, 0.5, 1, BLACK, 11);
      break;
    case 'drift':
      b.blob(0, 0.15, 0, 2.4, 0.5, 1, BLACK, 12);
      break;
    case 'tuft':
      for (let i = 0; i < 4; i++) b.blade((i / 4) * Math.PI, 0.14, 0.85 + (i % 3) * 0.12, 1, BLACK, 0.2 * (i % 2 ? 1 : -1));
      break;
    case 'flower':
      b.blade(0, 0.03, 0.8, 0.3, rgb('#4d7a30'), 0.03);
      b.blob(0, 0.85, 0, 0.32, 0.14, 1, BLACK, 13);
      break;
  }
  return b;
}

const templates = new Map<PlantKind, Template>();
function templateOf(kind: PlantKind): Template {
  let t = templates.get(kind);
  if (!t) {
    t = makeTemplate(kind);
    templates.set(kind, t);
  }
  return t;
}

const farTemplates = new Map<PlantKind, Template>();
function farTemplateOf(kind: PlantKind): Template {
  let t = farTemplates.get(kind);
  if (!t) {
    t = makeFarTemplate(kind);
    farTemplates.set(kind, t);
  }
  return t;
}

const tintCache = new Map<string, Rgb>();
function tintOf(hex: string): Rgb {
  let c = tintCache.get(hex);
  if (!c) {
    c = rgb(hex);
    tintCache.set(hex, c);
  }
  return c;
}

/** A list of plants collected for one mesh. */
class Merge {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  index: number[] = [];

  add(t: Template, x: number, y: number, z: number, size: number, yaw: number, tint: Rgb, shade: number): void {
    const base = this.pos.length / 3;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const n = t.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const px = t.pos[i * 3];
      const pz = t.pos[i * 3 + 2];
      this.pos.push(x + (px * c - pz * s) * size, y + t.pos[i * 3 + 1] * size, z + (px * s + pz * c) * size);
      const nx = t.nor[i * 3];
      const nz = t.nor[i * 3 + 2];
      this.nor.push(nx * c - nz * s, t.nor[i * 3 + 1], nx * s + nz * c);
      const k = t.tint[i];
      for (let ch = 0; ch < 3; ch++) {
        const fixed = t.fixed[i * 3 + ch];
        this.col.push((fixed * (1 - Math.min(1, k)) + tint[ch] * k) * shade);
      }
    }
    for (const a of t.index) this.index.push(base + a);
  }

  mesh(material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setIndex(this.pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(this.index, 1) : new THREE.Uint16BufferAttribute(this.index, 1));
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.updateMatrixWorld();
    return mesh;
  }
}

/** One tile of trees. mesh is null while empty. */
interface TreeTile {
  mesh: THREE.Mesh | null;
}

/** Trees and rocks over a wide area, grass and flowers close to the road: one merged mesh per tile. */
export class Flora {
  readonly group = new THREE.Group();
  private readonly far = new Map<string, TreeTile>();
  private readonly nearby = new Map<string, TreeTile>();
  private readonly details = new Map<string, THREE.Mesh | null>();
  /** Tiles still to make right now. */
  pending = 0;

  constructor(
    private readonly land: Land,
    private readonly material: THREE.Material,
  ) {}

  update(x: number, y: number, budget: number): void {
    const start = performance.now();
    this.updateDetails(x, y, start, budget * 0.35);
    this.pending = this.updateTrees(x, y, start, budget);
  }

  private box(size: number, ix: number, iy: number, x: number, y: number): number {
    const dx = Math.max(ix * size - x, 0, x - (ix + 1) * size);
    const dy = Math.max(iy * size - y, 0, y - (iy + 1) * size);
    return Math.hypot(dx, dy);
  }

  /** The cheap tiles round the camera, with detailed ones instead close by. Returns how many are missing. */
  private updateTrees(x: number, y: number, start: number, budget: number): number {
    const cx = Math.floor(x / FAR_TILE);
    const cy = Math.floor(y / FAR_TILE);
    const r = Math.ceil(TREE_RANGE / FAR_TILE) + 1;
    const near = PLANT_TILE;
    const todo: { d: number; ix: number; iy: number; far: boolean }[] = [];
    for (let iy = cy - r; iy <= cy + r; iy++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        const d = this.box(FAR_TILE, ix, iy, x, y);
        if (d > TREE_RANGE) continue;
        const key = `${ix}:${iy}`;
        const tile = this.far.get(key);
        const close = d < NEAR_RANGE;
        // Four children, ready or not.
        let ready = close;
        if (close) {
          for (let j = 0; j < 2; j++) {
            for (let i = 0; i < 2; i++) {
              const child = this.nearby.get(`${ix * 2 + i}:${iy * 2 + j}`);
              if (!child) {
                ready = false;
                todo.push({ d: this.box(near, ix * 2 + i, iy * 2 + j, x, y), ix: ix * 2 + i, iy: iy * 2 + j, far: false });
              }
            }
          }
        }
        if (!tile && !ready) todo.push({ d: d + (close ? 5000 : 0), ix, iy, far: true });
        if (tile?.mesh) tile.mesh.visible = !ready;
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) {
            const m = this.nearby.get(`${ix * 2 + i}:${iy * 2 + j}`)?.mesh;
            if (m) m.visible = ready;
          }
        }
      }
    }
    todo.sort((a, b) => a.d - b.d);
    let made = 0;
    for (const t of todo) {
      if (performance.now() - start > budget) break;
      const size = t.far ? FAR_TILE : near;
      const mesh = this.buildTrees(t.ix * size, t.iy * size, size, t.far);
      if (mesh) {
        mesh.visible = false;
        this.group.add(mesh);
      }
      (t.far ? this.far : this.nearby).set(`${t.ix}:${t.iy}`, { mesh });
      made++;
    }
    this.evict(this.far, FAR_TILE, x, y, TREE_RANGE + FAR_TILE);
    this.evict(this.nearby, near, x, y, NEAR_RANGE + FAR_TILE);
    return todo.length - made;
  }

  private evict(store: Map<string, TreeTile>, size: number, x: number, y: number, range: number): void {
    for (const [k, t] of store) {
      const [a, b] = k.split(':').map(Number);
      if (this.box(size, a, b, x, y) < range) continue;
      if (t.mesh) {
        t.mesh.geometry.dispose();
        t.mesh.removeFromParent();
      }
      store.delete(k);
    }
  }

  private updateDetails(x: number, y: number, start: number, budget: number): void {
    const size = DETAIL_TILE;
    const cx = Math.floor(x / size);
    const cy = Math.floor(y / size);
    const r = Math.ceil(DETAIL_RANGE / size);
    for (let iy = cy - r; iy <= cy + r; iy++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        const key = `${ix}:${iy}`;
        if (this.details.has(key) || this.box(size, ix, iy, x, y) > DETAIL_RANGE) continue;
        if (performance.now() - start > budget) return;
        const m = this.buildDetail(ix, iy);
        this.details.set(key, m);
        if (m) this.group.add(m);
      }
    }
    for (const [k, m] of this.details) {
      const [a, b] = k.split(':').map(Number);
      if (this.box(size, a, b, x, y) < DETAIL_RANGE + size * 2) continue;
      if (m) {
        m.geometry.dispose();
        m.removeFromParent();
      }
      this.details.delete(k);
    }
  }

  /** A square of trees: whatever plantsIn says stands there. */
  private buildTrees(x0: number, y0: number, size: number, far: boolean): THREE.Mesh | null {
    const { land } = this;
    const seed = land.seed;
    const merge = new Merge();
    const baseH = land.height(x0 + size / 2, y0 + size / 2, 25);
    plantsIn(land, x0, y0, size, far ? FAR_MIN_SIZE : 0, (plant, x, y, h, plantSize, gx, gy) => {
      const tint = tintOf(plant.tints[Math.floor(pickFrom(gx, gy, seed, 7) * plant.tints.length)]);
      const t = far ? farTemplateOf(plant.kind) : templateOf(plant.kind);
      merge.add(t, x - x0, h - baseH - 0.15, y - y0, plantSize, pickFrom(gx, gy, seed, 8) * 6.28, tint, 0.85 + pickFrom(gx, gy, seed, 9) * 0.3);
    });
    return merge.pos.length > 0 ? merge.mesh(this.material, x0, baseH, y0) : null;
  }

  private buildDetail(tx: number, ty: number): THREE.Mesh | null {
    const { land } = this;
    const x0 = tx * DETAIL_TILE;
    const y0 = ty * DETAIL_TILE;
    const seed = land.seed + 5;
    const edge = ROAD_HALF + SHOULDER;
    // Most of the land is nowhere near the road: don't look at every point of it.
    land.height(x0 + DETAIL_TILE / 2, y0 + DETAIL_TILE / 2);
    if (land.roadDistance > DETAIL_RANGE + DETAIL_TILE) return null;
    const merge = new Merge();
    const spacing = land.mix(x0).a.flora.detailSpacing;
    const n = Math.round(DETAIL_TILE / spacing);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const gx = tx * n + i;
        const gy = ty * n + j;
        const x = x0 + (i + hash2(gx, gy, seed)) * spacing;
        const y = y0 + (j + pickFrom(gx, gy, seed, 1)) * spacing;
        const biome = biomeAtPoint(land, x, pickFrom(gx, gy, seed, 2));
        const h = land.height(x, y);
        const d = land.roadDistance - edge;
        // Thick close to the road, where they go past fast; thinner further out.
        if (d < 0.8 || h < 2 || pickFrom(gx, gy, seed, 3) > 1.15 - d / 70) continue;
        const plant = pickPlant(biome.flora.detail, pickFrom(gx, gy, seed, 5));
        const size = plant.size[0] + (plant.size[1] - plant.size[0]) * pickFrom(gx, gy, seed, 6);
        const tint = tintOf(plant.tints[Math.floor(pickFrom(gx, gy, seed, 7) * plant.tints.length)]);
        merge.add(templateOf(plant.kind), x - x0, h, y - y0, size, pickFrom(gx, gy, seed, 8) * 6.28, tint, 0.9 + pickFrom(gx, gy, seed, 9) * 0.2);
      }
    }
    return merge.pos.length > 0 ? merge.mesh(this.material, x0, 0, y0) : null;
  }

  dispose(): void {
    for (const store of [this.far, this.nearby]) {
      for (const t of store.values()) t.mesh?.geometry.dispose();
      store.clear();
    }
    for (const m of this.details.values()) m?.geometry.dispose();
    this.details.clear();
    this.group.clear();
  }
}
