import * as THREE from 'three';
import { type Biome, type Rgb, rgb } from '../../sim/openRoad/biomes';
import type { Land } from '../../sim/openRoad/land';
import { LEVEL_WIDTH } from '../../sim/openRoad/land';
import { FENCE_LEFT, FENCE_OFFSET, FENCE_RIGHT, ROAD_HALF, ROAD_SPACING, SHOULDER, TIGHT_RADIUS } from '../../sim/openRoad/road';

/** Samples per mesh of road. */
const CHUNK = 200;
/** Road is drawn this far ahead of and behind the camera (samples). */
const AHEAD = 1100;
const BEHIND = 250;
/** One marker post per this many samples each side. */
const POST_EVERY = 12;
const LINE_WIDTH = 0.28;
const LINE_IN = 0.3;
const CENTRE_WIDTH = 0.26;
/** Centre dashes: painted for this many samples out of DASH_EVERY. */
const DASH_EVERY = 3;
const POST_HEIGHT = 1.05;
/** A fence post every this many samples. */
const FENCE_POST_EVERY = 2;
/** Rails of each kind of fence: bottom and top height (m), and how high its posts are. */
const FENCE_LOOKS = {
  rail: { rails: [[0.5, 0.82]], post: 0.86, postWidth: 0.09 },
  wood: { rails: [[0.42, 0.56], [0.86, 1]], post: 1.12, postWidth: 0.11 },
  wire: { rails: [[0.5, 0.53], [0.8, 0.83], [1.1, 1.13]], post: 1.2, postWidth: 0.07 },
} as const;
/** One board per this many samples round the outside of a hairpin. */
const CHEVRON_EVERY = 4;
const CHEVRON_FROM = 1 / 70;
/** Warning signs this far before a tight bend (samples). */
const WARN_AT = [50, 30];
const YELLOW = rgb('#f2c618');
const BLACK = rgb('#15161a');
const SIGN_BACK = rgb('#5a5e62');

interface RoadColors {
  asphalt: Rgb;
  shoulder: Rgb;
  line: Rgb;
  centre: Rgb;
  post: Rgb;
  postTop: Rgb;
}

const cache = new Map<string, RoadColors>();
function colorsOf(b: Biome): RoadColors {
  let c = cache.get(b.id);
  if (!c) {
    const r = b.road;
    c = { asphalt: rgb(r.asphalt), shoulder: rgb(r.shoulder), line: rgb(r.line), centre: rgb(r.centre), post: rgb(r.post), postTop: rgb(r.postTop) };
    cache.set(b.id, c);
  }
  return c;
}

const lerp3 = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The road and its marker posts near the camera, in meshes of a couple of hundred metres. */
export class RoadMeshes {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, THREE.Mesh>();
  private readonly fenceColors = new Map<string, Rgb>();

  constructor(
    private readonly land: Land,
    private readonly material: THREE.Material,
  ) {}

  /** Make what's missing near this sample (at most `budget` ms' worth) and drop what's far away. */
  update(index: number, budget: number): void {
    const first = Math.max(0, Math.floor((index - BEHIND) / CHUNK));
    const last = Math.floor((index + AHEAD) / CHUNK);
    this.land.road.ensure(this.land.road.x[Math.min(index, this.land.road.count - 1)] + (AHEAD + CHUNK) * ROAD_SPACING + 100);
    const start = performance.now();
    for (let c = Math.floor(index / CHUNK), n = 0; n < last - first + 2; n++) {
      // Out from the car, ahead first.
      const k = c + n <= last ? c + n : c - (n - (last - c));
      if (k < first || k > last || this.chunks.has(k)) continue;
      this.build(k);
      if (performance.now() - start > budget) break;
    }
    for (const [k, mesh] of this.chunks) {
      if (k >= first - 1 && k <= last + 1) continue;
      mesh.geometry.dispose();
      mesh.removeFromParent();
      this.chunks.delete(k);
    }
  }

  private build(k: number): void {
    const { land } = this;
    const r = land.road;
    const i0 = k * CHUNK;
    const i1 = i0 + CHUNK;
    if (i1 >= r.count) return;
    const ox = r.x[i0];
    const oy = r.y[i0];
    const oz = r.z[i0];
    const pos: number[] = [];
    const col: number[] = [];
    const uvs: number[] = [];
    const nor: number[] = [];
    const outer = ROAD_HALF + SHOULDER + LEVEL_WIDTH;
    const edge = ROAD_HALF + SHOULDER;
    // A point `off` metres to the right of sample i, `down` under the road.
    const put = (i: number, off: number, down: number, c: Rgb) => {
      pos.push(r.x[i] - r.ty[i] * off - ox, r.z[i] - down - oz, r.y[i] + r.tx[i] * off - oy);
      col.push(c[0], c[1], c[2]);
      uvs.push(off / 9, ((i - i0) * ROAD_SPACING) / 9);
      const g = r.grade[i];
      const len = Math.hypot(g, 1);
      nor.push((-g * r.tx[i]) / len, 1 / len, (-g * r.ty[i]) / len);
    };
    /** One band across the road between two samples. */
    const band = (i: number, a: number, b: number, downA: number, downB: number, ca: Rgb, cb: Rgb, ca2 = ca, cb2 = cb) => {
      put(i, a, downA, ca);
      put(i, b, downB, cb);
      put(i + 1, a, downA, ca2);
      put(i, b, downB, cb);
      put(i + 1, b, downB, cb2);
      put(i + 1, a, downA, ca2);
    };
    for (let i = i0; i < i1; i++) {
      const m = land.mix(r.x[i]);
      const c = colorsOf(m.a);
      const t = m.t;
      const d = t > 0 ? colorsOf(m.b) : c;
      const asphalt = t > 0 ? lerp3(c.asphalt, d.asphalt, t) : c.asphalt;
      const shoulder = t > 0 ? lerp3(c.shoulder, d.shoulder, t) : c.shoulder;
      const line = t > 0 ? lerp3(c.line, d.line, t) : c.line;
      const centre = t > 0 ? lerp3(c.centre, d.centre, t) : c.centre;
      const dash = i % DASH_EVERY === 0 ? centre : asphalt;
      // The land's colour at the outside of the verge, so the road melts into it.
      const ground = (s: number, side: number): Rgb => {
        const x = r.x[s] - r.ty[s] * outer * side;
        const y = r.y[s] + r.tx[s] * outer * side;
        const h = land.height(x, y);
        const out: Rgb = [0, 0, 0];
        land.color(h, 0, x, y, 6, out);
        return out;
      };
      const gl = ground(i, -1);
      const gr = ground(i, 1);
      const gl2 = ground(i + 1, -1);
      const gr2 = ground(i + 1, 1);
      const sa = ROAD_HALF - LINE_IN - LINE_WIDTH;
      const sb = ROAD_HALF - LINE_IN;
      const cw = CENTRE_WIDTH / 2;
      // Left to right, side by side, never stacked (no flicker).
      band(i, -outer, -edge, 0.27, 0.03, gl, shoulder, gl2, shoulder);
      band(i, -edge, -ROAD_HALF, 0.03, 0, shoulder, shoulder);
      band(i, -ROAD_HALF, -sb, 0, 0, asphalt, asphalt);
      band(i, -sb, -sa, 0, 0, line, line);
      band(i, -sa, -cw, 0, 0, asphalt, asphalt);
      band(i, -cw, cw, 0, 0, dash, dash);
      band(i, cw, sa, 0, 0, asphalt, asphalt);
      band(i, sa, sb, 0, 0, line, line);
      band(i, sb, ROAD_HALF, 0, 0, asphalt, asphalt);
      band(i, ROAD_HALF, edge, 0, 0.03, shoulder, shoulder);
      band(i, edge, outer, 0.03, 0.27, shoulder, gr, shoulder, gr2);
      this.fences(i, ox, oy, oz, pos, col, uvs, nor);
      if (i % POST_EVERY === 0) {
        const side = i % (POST_EVERY * 2) === 0 ? 1 : -1;
        // A fence on that side does the post's job.
        if (r.fence[i] & (side > 0 ? FENCE_RIGHT : FENCE_LEFT)) continue;
        this.post(pos, col, uvs, nor, r.x[i] - r.ty[i] * (edge + 1.6) * side - ox, r.z[i] - oz - 0.1, r.y[i] + r.tx[i] * (edge + 1.6) * side - oy, t > 0 ? lerp3(c.post, d.post, t) : c.post, t > 0 ? lerp3(c.postTop, d.postTop, t) : c.postTop);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(ox, oz, oy);
    mesh.updateMatrixWorld();
    this.chunks.set(k, mesh);
    this.group.add(mesh);
  }

  /** A flat four-cornered panel, seen from both sides. */
  private panel(pos: number[], col: number[], uvs: number[], nor: number[], p: number[][], c: Rgb, nx: number, nz: number): void {
    for (const order of [
      [0, 1, 2, 0, 2, 3],
      [0, 2, 1, 0, 3, 2],
    ]) {
      const flip = order[1] === 1 ? 1 : -1;
      for (const v of order) {
        pos.push(p[v][0], p[v][1], p[v][2]);
        col.push(c[0], c[1], c[2]);
        uvs.push(0, 0);
        nor.push(nx * flip, 0.2, nz * flip);
      }
    }
  }

  /** The fences, chevrons and warning signs of one sample of road. */
  private fences(i: number, ox: number, oy: number, oz: number, pos: number[], col: number[], uvs: number[], nor: number[]): void {
    const { land } = this;
    const r = land.road;
    const mix = land.mix(r.x[i]);
    const def = (mix.t < 0.5 ? mix.a : mix.b).road.fence;
    let color = this.fenceColors.get(def.color);
    if (!color) {
      color = rgb(def.color);
      this.fenceColors.set(def.color, color);
    }
    const look = FENCE_LOOKS[def.kind];
    const at = (s: number, side: number, off: number, up: number): number[] => [r.x[s] - r.ty[s] * off * side - ox, r.z[s] + up - oz, r.y[s] + r.tx[s] * off * side - oy];
    for (let n = 0; n < 2; n++) {
      const side = n === 0 ? -1 : 1;
      const bit = n === 0 ? FENCE_LEFT : FENCE_RIGHT;
      if (!(r.fence[i] & bit)) continue;
      const nx = -r.ty[i] * side;
      const nz = r.tx[i] * side;
      // Rails to the next sample, if the fence goes on.
      if (i + 1 < r.count && r.fence[i + 1] & bit) {
        for (const [y0, y1] of look.rails) {
          this.panel(pos, col, uvs, nor, [at(i, side, FENCE_OFFSET, y0), at(i, side, FENCE_OFFSET, y1), at(i + 1, side, FENCE_OFFSET, y1), at(i + 1, side, FENCE_OFFSET, y0)], color, -nx, -nz);
        }
      }
      if (i % FENCE_POST_EVERY === 0) {
        const w = look.postWidth;
        const tx = r.tx[i] * w;
        const ty = r.ty[i] * w;
        const base = at(i, side, FENCE_OFFSET, -0.5);
        const top = at(i, side, FENCE_OFFSET, look.post);
        this.panel(pos, col, uvs, nor, [
          [base[0] - tx, base[1], base[2] - ty],
          [top[0] - tx, top[1], top[2] - ty],
          [top[0] + tx, top[1], top[2] + ty],
          [base[0] + tx, base[1], base[2] + ty],
        ], color, -nx, -nz);
      }
      // Black and yellow chevrons round the outside of a hairpin, pointing the way the road goes.
      const k = r.kappa[i];
      if (Math.abs(k) > CHEVRON_FROM && i % CHEVRON_EVERY === 0 && Math.sign(k) === -side) this.chevron(i, side, ox, oy, oz, pos, col, uvs, nor);
    }
    // Warning signs on the right before a tight bend, the first of each.
    for (const ahead of WARN_AT) {
      const j = i + ahead;
      if (j + 1 >= r.kappa.length || j < 1) continue;
      if (Math.abs(r.kappa[j]) > 1 / TIGHT_RADIUS && Math.abs(r.kappa[j - 1]) <= 1 / TIGHT_RADIUS) this.warning(i, Math.sign(r.kappa[j]), ox, oy, oz, pos, col, uvs, nor);
    }
  }

  /** A board facing the road: yellow with a black arrow. */
  private chevron(i: number, side: number, ox: number, oy: number, oz: number, pos: number[], col: number[], uvs: number[], nor: number[]): void {
    const r = this.land.road;
    const off = FENCE_OFFSET - 0.12;
    const nx = r.ty[i] * side;
    const nz = -r.tx[i] * side;
    const p = (along: number, up: number): number[] => [r.x[i] + r.tx[i] * along - r.ty[i] * off * side - ox, r.z[i] + up - oz, r.y[i] + r.ty[i] * along + r.tx[i] * off * side - oy];
    const lo = 0.75;
    const hi = 2.05;
    const w = 0.95;
    this.panel(pos, col, uvs, nor, [p(-w, lo), p(-w, hi), p(w, hi), p(w, lo)], YELLOW, nx, nz);
    const inner = r.ty[i] * side * 0.03;
    const innerZ = -r.tx[i] * side * 0.03;
    const q = (along: number, up: number): number[] => {
      const v = p(along, up);
      return [v[0] + inner, v[1], v[2] + innerZ];
    };
    const mid = (lo + hi) / 2;
    this.panel(pos, col, uvs, nor, [q(-0.55, lo + 0.1), q(0.05, mid), q(0.55, mid), q(-0.05, lo + 0.1)], BLACK, nx, nz);
    this.panel(pos, col, uvs, nor, [q(-0.55, hi - 0.1), q(0.05, mid), q(0.55, mid), q(-0.05, hi - 0.1)], BLACK, nx, nz);
  }

  /** A yellow diamond on a post, facing oncoming cars, with an arrow the way the bend goes. */
  private warning(i: number, way: number, ox: number, oy: number, oz: number, pos: number[], col: number[], uvs: number[], nor: number[]): void {
    const r = this.land.road;
    const off = ROAD_HALF + SHOULDER + 1.4;
    const bx = r.x[i] - r.ty[i] * off - ox;
    const by = r.y[i] + r.tx[i] * off - oy;
    const bz = r.z[i] - oz;
    // Across the road and up: (rx, rz) runs to the sign's right as a driver sees it.
    const rx = -r.ty[i];
    const rz = r.tx[i];
    const nx = -r.tx[i];
    const nz = -r.ty[i];
    const c = 2.5;
    const R = 1.05;
    const p = (a: number, up: number, front = 0): number[] => [bx + rx * a + nx * front, bz + c + up, by + rz * a + nz * front];
    this.panel(pos, col, uvs, nor, [
      [bx - rx * 0.06, bz - 0.3, by - rz * 0.06],
      [bx - rx * 0.06, bz + c, by - rz * 0.06],
      [bx + rx * 0.06, bz + c, by + rz * 0.06],
      [bx + rx * 0.06, bz - 0.3, by + rz * 0.06],
    ], SIGN_BACK, nx, nz);
    this.panel(pos, col, uvs, nor, [p(0, -R), p(-R, 0), p(0, R), p(R, 0)], YELLOW, nx, nz);
    const a = way * 0.5;
    this.panel(pos, col, uvs, nor, [p(-a, -0.55, 0.03), p(-a + 0.12 * way, -0.55, 0.03), p(a * 0.2 + 0.1 * way, 0.2, 0.03), p(a * 0.2 - 0.1 * way, 0.2, 0.03)], BLACK, nx, nz);
    this.panel(pos, col, uvs, nor, [p(a * 0.2 - 0.25 * way, 0.2, 0.03), p(a, 0.55, 0.03), p(a * 0.2 + 0.25 * way, 0.2, 0.03), p(a * 0.2, 0.2, 0.03)], BLACK, nx, nz);
  }

  /** A small three-sided post with a coloured band at the top. */
  private post(pos: number[], col: number[], uvs: number[], nor: number[], x: number, y: number, z: number, body: Rgb, top: Rgb): void {
    const R = 0.09;
    for (let a = 0; a < 3; a++) {
      const a0 = (a / 3) * Math.PI * 2;
      const a1 = ((a + 1) / 3) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      const nx = Math.cos(mid);
      const nz = Math.sin(mid);
      const quad = (y0: number, y1: number, c: Rgb) => {
        const p = (ang: number, h: number) => {
          pos.push(x + Math.cos(ang) * R, y + h, z + Math.sin(ang) * R);
          col.push(c[0], c[1], c[2]);
          uvs.push(0, 0);
          nor.push(nx, 0, nz);
        };
        p(a0, y0);
        p(a0, y1);
        p(a1, y0);
        p(a1, y0);
        p(a0, y1);
        p(a1, y1);
      };
      quad(0, POST_HEIGHT * 0.72, body);
      quad(POST_HEIGHT * 0.72, POST_HEIGHT, top);
    }
  }

  dispose(): void {
    for (const m of this.chunks.values()) m.geometry.dispose();
    this.chunks.clear();
    this.group.clear();
  }
}
