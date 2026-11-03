import * as THREE from 'three';
import { type Biome, type Rgb, rgb } from '../../sim/openRoad/biomes';
import type { Land } from '../../sim/openRoad/land';
import { LEVEL_WIDTH } from '../../sim/openRoad/land';
import { ROAD_HALF, ROAD_SPACING, SHOULDER } from '../../sim/openRoad/road';

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
      if (i % POST_EVERY === 0) {
        const side = i % (POST_EVERY * 2) === 0 ? 1 : -1;
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
