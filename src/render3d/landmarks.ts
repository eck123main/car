import * as THREE from 'three';
import type { Track, TrackSample } from '../track/track';
import type { Compass, Landmark, SceneryDef } from '../track/types';
import { at, QuadBuilder } from './trackMesh';

/**
 * What makes each real circuit recognisable in 3D, from the `scenery` block of its track file:
 * the sky (night races, sunset), the land (desert, dunes, forest), mountains, sea, a city, and
 * landmarks such as Monaco's tunnel, Suzuka's bridge or the Las Vegas Sphere. Only looks: the
 * physics never sees any of it. Every piece is a merged mesh or instanced, so it stays cheap.
 */

/** How the sky, light and land look. */
export interface Look {
  skyTop: string;
  skyHorizon: string;
  fogNear: number;
  fogFar: number;
  ambient: number;
  sun: number;
  sunColor: string;
  /** Grass, its mowing stripe and the land outside the walls. */
  grass: string;
  grassStripe: string;
  outside: string;
  /** Trees per spot compared with normal (0 = none). */
  trees: number;
  /** Lit windows and floodlights. */
  night: boolean;
}

export function lookOf(def: SceneryDef | null): Look {
  const look: Look = {
    skyTop: '#5f9bd8',
    skyHorizon: '#cfe2f1',
    fogNear: 220,
    fogFar: 1000,
    ambient: 1.6,
    sun: 1.8,
    sunColor: '#fff6e0',
    grass: '#3f7a35',
    grassStripe: '#468540',
    outside: '#2d5428',
    trees: 1,
    night: false,
  };
  if (def?.land === 'desert') Object.assign(look, { grass: '#c8ad7c', grassStripe: '#ceb485', outside: '#bfa070', trees: 0.15 });
  if (def?.land === 'dunes') Object.assign(look, { grass: '#8f9a5a', grassStripe: '#97a262', outside: '#c9b98a', trees: 0.35 });
  if (def?.land === 'forest') Object.assign(look, { trees: 1.8, outside: '#264a22' });
  if (def?.sky === 'dusk') Object.assign(look, { skyTop: '#41558f', skyHorizon: '#eaa77a', ambient: 1.3, sun: 1.3, sunColor: '#ffb27a', fogFar: 900 });
  if (def?.sky === 'night') Object.assign(look, { skyTop: '#060a1a', skyHorizon: '#1d2740', ambient: 1.35, sun: 0.5, sunColor: '#bcd0ff', fogNear: 160, fogFar: 800, night: true });
  return look;
}

/** Height of the road at every centreline sample (the crossover bridge), and where it's a deck. */
export interface Elevation {
  heights: Float32Array;
  /** Samples on the bridge itself (open underneath), not on an embankment. */
  deck: Uint8Array;
}

const BRIDGE_HEIGHT = 7.5;
/** Full height this far either side of the crossing, back down to the ground by RAMP_END (m). */
const RAMP_FLAT = 40;
const RAMP_END = 230;

/** Suzuka: the later stretch through the crossing goes over a bridge, the earlier one under it. */
export function elevation(track: Track): Elevation | null {
  if (!track.scenery?.landmarks?.some((l) => l.type === 'crossover')) return null;
  const ss = track.samples;
  const n = ss.length;
  let best = { d: Infinity, i: 0, j: 0 };
  for (let i = 0; i < n; i++) {
    for (let j = i + 60; j < n; j++) {
      if (n - (j - i) < 60) continue;
      const d = Math.hypot(ss[i].x - ss[j].x, ss[i].y - ss[j].y);
      if (d < best.d) best = { d, i, j };
    }
  }
  if (best.d > 5) return null;
  const heights = new Float32Array(n);
  const deck = new Uint8Array(n);
  const reach = Math.ceil(RAMP_END / 2);
  const lower = ss[best.i];
  const lowerReach = Math.max(lower.wallL, lower.wallR) + 6;
  for (let k = -reach; k <= reach; k++) {
    const idx = (((best.j + k) % n) + n) % n;
    const d = Math.abs(k) * 2;
    const t = d <= RAMP_FLAT ? 1 : Math.max(0, (RAMP_END - d) / (RAMP_END - RAMP_FLAT));
    // Smooth at both ends of the ramp.
    heights[idx] = BRIDGE_HEIGHT * t * t * (3 - 2 * t);
    const s = ss[idx];
    // Over the lower road: within its walls of its centreline.
    const across = Math.abs((s.x - lower.x) * lower.nx + (s.y - lower.y) * lower.ny);
    const along = Math.abs((s.x - lower.x) * lower.tx + (s.y - lower.y) * lower.ty);
    if (across < lowerReach + Math.max(s.wallL, s.wallR) && along < 40) deck[idx] = 1;
  }
  return { heights, deck };
}

const COMPASS_DIR: Record<Compass, [number, number]> = {
  N: [0, -1],
  NE: [Math.SQRT1_2, -Math.SQRT1_2],
  E: [1, 0],
  SE: [Math.SQRT1_2, Math.SQRT1_2],
  S: [0, 1],
  SW: [-Math.SQRT1_2, Math.SQRT1_2],
  W: [-1, 0],
  NW: [-Math.SQRT1_2, -Math.SQRT1_2],
};

const STONE = '#c9b083';
const BUILDING_TINTS = ['#9aa3ad', '#7d8894', '#b8c0c8', '#6e7a86', '#a59c8e', '#8a94a6'];

function rng(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Windows: a grid of panes, lit at night through the emissive map. */
function windowsTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2a2f36';
  ctx.fillRect(0, 0, 64, 128);
  const r = rng(99);
  for (let y = 2; y < 128; y += 6) {
    for (let x = 2; x < 64; x += 8) {
      ctx.fillStyle = r() < 0.6 ? '#ffe2a0' : '#3b4450';
      ctx.fillRect(x, y, 5, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Landmarks {
  readonly group = new THREE.Group();
  private readonly solid = new QuadBuilder();
  private readonly glow = new QuadBuilder();
  private readonly ss: TrackSample[];
  private readonly n: number;
  private readonly rnd: () => number;
  /** Footprints kept free of trees and stands: circles, and water. */
  private readonly circles: { x: number; y: number; r: number }[] = [];
  private readonly seaLines: { dx: number; dy: number; from: number }[] = [];
  private readonly waterBands: { from: number; to: number; side: number; d0: number; d1: number }[] = [];
  private readonly buildings: { x: number; y: number; w: number; d: number; h: number; angle: number }[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    private readonly track: Track,
    private readonly look: Look,
    private readonly elev: Elevation | null,
  ) {
    this.ss = track.samples;
    this.n = this.ss.length;
    this.rnd = rng(track.length * 7 + 3);
    const def = track.scenery;
    if (def?.sea) this.addSea(def.sea);
    for (const l of def?.landmarks ?? []) this.add(l);
    if (def?.city) this.addCity();
    if (def?.mountain) this.addMountain(def.mountain);
    if (this.elev) this.addBridgePillars();
    if (look.night) this.addFloodlights();
    this.addBuildings();
    const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.disposables.push(solidMat, glowMat);
    if (!this.solid.empty) this.mesh(this.solid.build(), solidMat);
    if (!this.glow.empty) this.mesh(this.glow.build(), glowMat);
  }

  /** Somewhere trees and stands must keep away from (water, buildings, landmarks). */
  blocked(x: number, y: number, margin = 4): boolean {
    for (const c of this.circles) if (Math.hypot(x - c.x, y - c.y) < c.r + margin) return true;
    for (const s of this.seaLines) if (x * s.dx + y * s.dy > s.from - margin) return true;
    if (this.waterBands.length) {
      const hit = this.track.query(x, y);
      if (hit) {
        for (const w of this.waterBands) {
          const f = hit.s / this.track.length;
          const inRange = w.from <= w.to ? f >= w.from && f <= w.to : f >= w.from || f <= w.to;
          const off = hit.d * w.side;
          if (inRange && off > w.d0 - margin && off < w.d1 + margin) return true;
        }
      }
    }
    return false;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    this.group.add(m);
    this.disposables.push(geo);
    return m;
  }

  private sample(f: number): TrackSample {
    return this.ss[((Math.floor(f * this.n) % this.n) + this.n) % this.n];
  }

  private index(f: number): number {
    return ((Math.floor(f * this.n) % this.n) + this.n) % this.n;
  }

  /** Sample indices from lap share `from` to `to` (wrapping past the line). */
  private range(from: number, to: number, step = 1): number[] {
    const a = this.index(from);
    const len = (((this.index(to) - a) % this.n) + this.n) % this.n;
    const out: number[] = [];
    for (let k = 0; k <= len; k += step) out.push((a + k) % this.n);
    return out;
  }

  private wall(s: TrackSample, side: number): number {
    return side > 0 ? s.wallR : s.wallL;
  }


  /** Clear of every part of the track's walls by `margin` (m). */
  private clear(x: number, y: number, margin: number): boolean {
    const hit = this.track.query(x, y);
    if (!hit) return true;
    const wall = hit.d >= 0 ? hit.sample.wallR : hit.sample.wallL;
    return Math.abs(hit.d) - wall > margin;
  }

  /** A spot `gap` m past the wall, clear of the whole track by radius r (further out if needed). */
  private spot(s: TrackSample, side: number, gap: number, r: number): [number, number, number] | null {
    for (let k = 0; k < 6; k++) {
      const p = at(s, side * (this.wall(s, side) + gap + r + k * r));
      if (this.clear(p[0], p[2], r + 3)) return p;
    }
    // Shows when adding landmarks to a track file: the spot is too close to the rest of the track.
    console.warn(`${this.track.name}: no room for a landmark at ${(s.s / this.track.length).toFixed(2)} of the lap`);
    return null;
  }

  private add(l: Landmark): void {
    const side = l.side === 'left' ? -1 : 1;
    switch (l.type) {
      case 'tunnel':
        return this.addTunnel(l.from ?? 0, l.to ?? 0);
      case 'water':
        return this.addWater(l.from ?? 0, l.to ?? 0, side, l.gap ?? 6, l.width ?? 150, !!l.boats);
      case 'hotel':
        return this.addHotel(l.at ?? 0);
      case 'wheel':
        return this.addWheel(l.at ?? 0, side, l.gap ?? 60, l.size ?? 25);
      case 'sphere':
        return this.addSphere(l.at ?? 0, side, l.gap ?? 80, l.size ?? 40);
      case 'flames':
        return this.addFlames(l.at ?? 0, side, l.gap ?? 200, l.size ?? 100);
      case 'sands':
        return this.addSands(l.at ?? 0, side, l.gap ?? 300, l.size ?? 110);
      case 'walls':
        return this.addCityWalls(l.from ?? 0, l.to ?? 0, side, l.gap ?? 2);
      case 'strip':
        return this.addStrip(l.from ?? 0, l.to ?? 0, l.gap ?? 25);
      case 'sign':
        return this.addSign(l.at ?? 0, side, l.text ?? '');
      // 'crossover' is the elevation; 'stadium' is built with the other stands (Scenery3d).
    }
  }

  /** A roof over the track with lights along it, walls up to the roof (Monaco). */
  private addTunnel(from: number, to: number): void {
    const roof = 6.5;
    const idx = this.range(from, to);
    for (let k = 0; k < idx.length - 1; k++) {
      const a = this.ss[idx[k]];
      const b = this.ss[idx[k + 1]];
      const la = -(a.wallL + 0.5), ra = a.wallR + 0.5;
      const lb = -(b.wallL + 0.5), rb = b.wallR + 0.5;
      // Ceiling (seen from below), the roof top and the side walls above the barriers.
      this.solid.quad(at(a, la, roof), at(b, lb, roof), at(b, rb, roof), at(a, ra, roof), '#3a3b40');
      this.solid.quad(at(a, la, roof + 1.5), at(b, lb, roof + 1.5), at(b, rb, roof + 1.5), at(a, ra, roof + 1.5), '#8f969c');
      for (const [oa, ob] of [[la, lb], [ra, rb]]) {
        this.solid.quad(at(a, oa, 1.1), at(b, ob, 1.1), at(b, ob, roof + 1.5), at(a, oa, roof + 1.5), '#5b5e63');
      }
      // A line of lights down the middle of the ceiling.
      if (k % 4 === 0) this.glow.quad(at(a, -0.6, roof - 0.05), at(b, -0.6, roof - 0.05), at(b, 0.6, roof - 0.05), at(a, 0.6, roof - 0.05), '#ffe7b0');
    }
    // A lighter face round each mouth.
    for (const i of [idx[0], idx[idx.length - 1]]) {
      const s = this.ss[i];
      const l = -(s.wallL + 0.5), r = s.wallR + 0.5;
      this.solid.quad(at(s, l - 3, roof), at(s, r + 3, roof), at(s, r + 3, roof + 3), at(s, l - 3, roof + 3), '#d8d2c4');
    }
  }

  /** Water beside the track (a harbour or a lake), with boats moored in it. */
  private addWater(from: number, to: number, side: number, gap: number, width: number, boats: boolean): void {
    const idx = this.range(from, to);
    const water = new QuadBuilder();
    const color = this.look.night ? '#0f2438' : '#2c6e94';
    let d0 = Infinity, d1 = 0;
    for (let k = 0; k < idx.length - 1; k++) {
      const a = this.ss[idx[k]];
      const b = this.ss[idx[k + 1]];
      const a0 = this.wall(a, side) + gap, b0 = this.wall(b, side) + gap;
      water.quad(at(a, side * a0, -0.06), at(b, side * b0, -0.06), at(b, side * (b0 + width), -0.06), at(a, side * (a0 + width), -0.06), color, true);
      d0 = Math.min(d0, a0);
      d1 = Math.max(d1, a0 + width);
      // Quay wall along the near edge.
      this.solid.quad(at(a, side * a0, -1), at(b, side * b0, -1), at(b, side * b0, 0.02), at(a, side * a0, 0.02), '#b9b3a6');
    }
    this.mesh(water.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.waterBands.push({ from, to, side, d0, d1 });
    if (!boats) return;
    for (let k = 0; k < idx.length; k += 6) {
      if (this.rnd() < 0.3) continue;
      const s = this.ss[idx[k]];
      const off = this.wall(s, side) + gap + 6 + this.rnd() * Math.min(width - 12, 60);
      const len = 12 + this.rnd() * 22;
      const beam = len * 0.3;
      // Moored side-on to the quay, with a cabin.
      const p = (o: number, along: number, h: number) => at(s, side * o, h, along);
      const hull = (o0: number, o1: number, a0: number, a1: number, h0: number, h1: number, c: string) =>
        this.solid.box([p(o0, a0, h0), p(o0, a1, h0), p(o1, a1, h0), p(o1, a0, h0)], [p(o0, a0, h1), p(o0, a1, h1), p(o1, a1, h1), p(o1, a0, h1)], c);
      hull(off, off + beam, -len / 2, len / 2, 0, 2.2, '#f4f4f2');
      hull(off + beam * 0.2, off + beam * 0.8, -len * 0.25, len * 0.2, 2.2, 4, '#dfe5ea');
    }
  }

  /** Sea beyond the circuit in a compass direction. */
  private addSea(dir: Compass): void {
    const [dx, dy] = COMPASS_DIR[dir];
    let max = -Infinity;
    for (const s of this.ss) max = Math.max(max, s.x * dx + s.y * dy + Math.max(s.wallL, s.wallR));
    const from = max + 40;
    // A big quad: from the shore line outwards, wide across.
    const px = -dy, py = dx;
    const c = (along: number, across: number): [number, number, number] => [dx * along + px * across, -0.08, dy * along + py * across];
    const q = new QuadBuilder();
    q.quad(c(from, -8000), c(from, 8000), c(from + 6000, 8000), c(from + 6000, -8000), this.look.night ? '#0d1e30' : '#2a6a90', true);
    this.mesh(q.build(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.seaLines.push({ dx, dy, from });
  }

  /** A building spanning the track: two blocks and a bridge between them (Yas Marina hotel). */
  private addHotel(f: number): void {
    const i = this.index(f);
    const s = this.ss[i];
    const L = s.wallL + 3, R = s.wallR + 3;
    const box = (o0: number, o1: number, a0: number, a1: number, h0: number, h1: number, c: string, q = this.solid) =>
      q.box(
        [at(s, o0, h0, a0), at(s, o0, h0, a1), at(s, o1, h0, a1), at(s, o1, h0, a0)],
        [at(s, o0, h1, a0), at(s, o0, h1, a1), at(s, o1, h1, a1), at(s, o1, h1, a0)],
        c,
      );
    // Blocks either side as deep as fits before another part of the track.
    const depth = (sideSign: number, inner: number) => {
      for (const d of [30, 18, 10]) {
        const ok = [-35, 0, 35].every((a) => {
          const p = at(s, sideSign * (inner + d), 0, a);
          return this.clear(p[0], p[2], 2);
        });
        if (ok) return d;
      }
      return 0;
    };
    const dl = depth(-1, L);
    const dr = depth(1, R);
    if (dl === 0 || dr === 0) return;
    box(-L - dl, -L, -35, 35, 0, 28, '#e9edf0');
    box(R, R + dr, -35, 35, 0, 28, '#e9edf0');
    box(-L, R, -14, 14, 11, 28, '#dfe4e8');
    // The lit band of the shell along the bridge.
    box(-L - dl - 0.2, R + dr + 0.2, -14.2, 14.2, 25, 26.5, this.look.night ? '#5fb7ff' : '#9fc9e6', this.glow);
    for (const o of [-L - dl / 2, R + dr / 2]) {
      const p = at(s, o, 0);
      this.circles.push({ x: p[0], y: p[2], r: 40 });
    }
  }

  /** Big wheel facing the track. */
  private addWheel(f: number, side: number, gap: number, radius: number): void {
    const s = this.sample(f);
    const p = this.spot(s, side, gap, radius * 0.5);
    if (!p) return;
    const g = new THREE.Group();
    const cy = radius + 6;
    const steel = new THREE.MeshLambertMaterial({ color: '#e6e8ea' });
    const ring = new THREE.TorusGeometry(radius, Math.max(0.4, radius * 0.025), 6, 48);
    const ringMesh = new THREE.Mesh(ring, steel);
    ringMesh.position.y = cy;
    g.add(ringMesh);
    const spoke = new THREE.CylinderGeometry(0.25, 0.25, radius * 2, 4);
    for (let k = 0; k < 8; k++) {
      const m = new THREE.Mesh(spoke, steel);
      m.position.y = cy;
      m.rotation.z = (k / 8) * Math.PI;
      g.add(m);
    }
    const leg = new THREE.CylinderGeometry(0.6, 0.9, Math.hypot(cy, radius * 0.45), 6);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(leg, steel);
      m.position.set(sx * radius * 0.22, cy / 2, sz * 2.5);
      m.rotation.z = sx * Math.atan2(radius * 0.45, cy);
      g.add(m);
    }
    const cabin = new THREE.BoxGeometry(2.4, 2.4, 2.4);
    const cabinMat = new THREE.MeshBasicMaterial({ color: this.look.night ? '#9fe3ff' : '#5aa9d6' });
    const cabins = new THREE.InstancedMesh(cabin, cabinMat, 28);
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      cabins.setMatrixAt(k, m4.makeTranslation(Math.cos(a) * radius, cy + Math.sin(a) * radius - 1.5, 0));
    }
    g.add(cabins);
    g.position.set(p[0], 0, p[2]);
    // Face the track: the wheel's flat side towards the road.
    g.rotation.y = Math.atan2(s.tx, s.ty) + Math.PI / 2;
    this.group.add(g);
    this.disposables.push(steel, ring, spoke, leg, cabin, cabinMat);
    this.circles.push({ x: p[0], y: p[2], r: radius * 0.5 + 6 });
  }

  /** A huge sphere covered in a glowing picture (the Las Vegas Sphere). */
  private addSphere(f: number, side: number, gap: number, radius: number): void {
    const s = this.sample(f);
    const p = this.spot(s, side, gap, radius);
    if (!p) return;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 256, 128);
    grad.addColorStop(0, '#ff5fa2');
    grad.addColorStop(0.5, '#ffb347');
    grad.addColorStop(1, '#5b6cff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);
    // A big eye, as it's often shown.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(128, 64, 60, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b6cff';
    ctx.beginPath();
    ctx.arc(128, 64, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05070c';
    ctx.beginPath();
    ctx.arc(128, 64, 11, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.SphereGeometry(radius, 32, 18);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p[0], radius * 0.85, p[2]);
    // The picture faces the track.
    m.rotation.y = Math.atan2(-side * s.nx, -side * s.ny) - Math.PI / 2;
    this.group.add(m);
    this.disposables.push(tex, geo, mat);
    this.circles.push({ x: p[0], y: p[2], r: radius + 4 });
  }

  /** Three flame-shaped glass towers on a hill (Baku). */
  private addFlames(f: number, side: number, gap: number, height: number): void {
    const s = this.sample(f);
    const base = this.spot(s, side, gap, height * 0.6);
    if (!base) return;
    const profile = [0, 0.15, 0.35, 0.55, 0.75, 0.9, 1].map((t) => new THREE.Vector2(t < 1 ? 0.16 * Math.sin(Math.PI * (0.25 + t * 0.75)) + 0.02 : 0, t));
    const geo = new THREE.LatheGeometry(profile, 10);
    const mat = new THREE.MeshLambertMaterial({ color: this.look.night ? '#ff8a3a' : '#4f86b8', flatShading: true });
    const hill = new THREE.ConeGeometry(1, 1, 8);
    const hillMat = new THREE.MeshLambertMaterial({ color: '#8d8a6a', flatShading: true });
    const hillMesh = new THREE.Mesh(hill, hillMat);
    hillMesh.scale.set(height * 0.9, height * 0.18, height * 0.9);
    hillMesh.position.set(base[0], height * 0.09 - 1, base[2]);
    this.group.add(hillMesh);
    [[0, 0, 1], [-0.28, 0.2, 0.86], [0.28, 0.25, 0.8]].forEach(([dx, dz, k]) => {
      const m = new THREE.Mesh(geo, mat);
      const hgt = height * k;
      m.scale.set(hgt, hgt, hgt * 0.7);
      m.position.set(base[0] + dx * height, height * 0.15, base[2] + dz * height);
      this.group.add(m);
    });
    this.disposables.push(geo, mat, hill, hillMat);
    this.circles.push({ x: base[0], y: base[2], r: height * 0.9 });
  }

  /** Three towers joined by a long park on the roof (Marina Bay Sands). */
  private addSands(f: number, side: number, gap: number, height: number): void {
    const s = this.sample(f);
    const c = this.spot(s, side, gap, height * 0.35);
    if (!c) return;
    const q = this.solid;
    const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: string) =>
      q.box(
        [[c[0] + x0, y0, c[2] + z0], [c[0] + x1, y0, c[2] + z0], [c[0] + x1, y0, c[2] + z1], [c[0] + x0, y0, c[2] + z1]],
        [[c[0] + x0, y1, c[2] + z0], [c[0] + x1, y1, c[2] + z0], [c[0] + x1, y1, c[2] + z1], [c[0] + x0, y1, c[2] + z1]],
        color,
      );
    const w = height * 0.18;
    for (const k of [-1, 0, 1]) box(k * w * 2.2 - w / 2, k * w * 2.2 + w / 2, -w * 0.3, w * 0.3, 0, height, '#cfd6dc');
    box(-w * 3.6, w * 3.2, -w * 0.45, w * 0.45, height, height + w * 0.22, '#e8ecef');
    this.circles.push({ x: c[0], y: c[2], r: w * 4 });
  }

  /** Old stone city walls with crenellations and round towers, beside the track (Baku). */
  private addCityWalls(from: number, to: number, side: number, gap: number): void {
    const idx = this.range(from, to);
    const H = 9;
    const T = 2.5;
    for (let k = 0; k < idx.length - 1; k++) {
      const a = this.ss[idx[k]];
      const b = this.ss[idx[k + 1]];
      const a0 = this.wall(a, side) + gap, b0 = this.wall(b, side) + gap;
      const q = this.solid;
      q.box(
        [at(a, side * a0, 0), at(b, side * b0, 0), at(b, side * (b0 + T), 0), at(a, side * (a0 + T), 0)],
        [at(a, side * a0, H), at(b, side * b0, H), at(b, side * (b0 + T), H), at(a, side * (a0 + T), H)],
        STONE,
      );
      // Merlons every other sample.
      if (k % 2 === 0) {
        q.box(
          [at(a, side * a0, H), at(b, side * b0, H), at(b, side * (b0 + 0.8), H), at(a, side * (a0 + 0.8), H)],
          [at(a, side * a0, H + 1.4), at(b, side * b0, H + 1.4), at(b, side * (b0 + 0.8), H + 1.4), at(a, side * (a0 + 0.8), H + 1.4)],
          '#bea676',
        );
      }
      if (k % 25 === 12) {
        const p = at(a, side * (a0 + T / 2));
        const tower = new THREE.CylinderGeometry(4, 4.6, H + 4, 10);
        const m = new THREE.Mesh(tower, this.towerMat());
        m.position.set(p[0], (H + 4) / 2, p[2]);
        this.group.add(m);
        this.disposables.push(tower);
      }
    }
  }

  private stoneMat: THREE.Material | null = null;
  private towerMat(): THREE.Material {
    if (!this.stoneMat) {
      this.stoneMat = new THREE.MeshLambertMaterial({ color: STONE, flatShading: true });
      this.disposables.push(this.stoneMat);
    }
    return this.stoneMat;
  }

  /** Tall buildings both sides of the track (the Las Vegas Strip). */
  private addStrip(from: number, to: number, gap: number): void {
    for (const i of this.range(from, to, 20)) {
      const s = this.ss[i];
      for (const side of [-1, 1]) {
        const w = 25 + this.rnd() * 30;
        const off = this.wall(s, side) + gap + w / 2 + this.rnd() * 40;
        const p = at(s, side * off);
        this.building(p[0], p[2], w, 20 + this.rnd() * 25, 50 + this.rnd() * 110, Math.atan2(s.ty, s.tx));
      }
    }
  }

  /** Tall city buildings in a ring outside the circuit. */
  private addCity(): void {
    let cx = 0, cy = 0;
    for (const s of this.ss) {
      cx += s.x / this.n;
      cy += s.y / this.n;
    }
    let reach = 0;
    for (const s of this.ss) reach = Math.max(reach, Math.hypot(s.x - cx, s.y - cy));
    for (let k = 0; k < 110; k++) {
      const a = this.rnd() * Math.PI * 2;
      const r = reach + 150 + this.rnd() * 450;
      this.building(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 20 + this.rnd() * 35, 20 + this.rnd() * 35, 40 + this.rnd() * 160, a);
    }
  }

  private building(x: number, y: number, w: number, d: number, h: number, angle: number): void {
    if (!this.clear(x, y, Math.max(w, d) / 2 + 4) || this.blocked(x, y, Math.max(w, d) / 2)) return;
    this.buildings.push({ x, y, w, d, h, angle });
    this.circles.push({ x, y, r: Math.max(w, d) * 0.6 });
  }

  /** All buildings as one instanced mesh with windows (lit at night). */
  private addBuildings(): void {
    if (this.buildings.length === 0) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const tex = windowsTexture();
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: this.look.night ? 0.9 : 0.05 });
    const mesh = new THREE.InstancedMesh(geo, mat, this.buildings.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    this.buildings.forEach((b, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.angle);
      m.compose(new THREE.Vector3(b.x, 0, b.y), q, new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, c.set(BUILDING_TINTS[k % BUILDING_TINTS.length]));
    });
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    this.disposables.push(geo, tex, mat);
  }

  /** Words painted on the wall facing the track (the Wall of Champions). */
  private addSign(f: number, side: number, text: string): void {
    const s = this.sample(f);
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, 1024, 64);
    ctx.fillStyle = '#1d3f8f';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(36, 0.9);
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    const p = at(s, side * (this.wall(s, side) - 0.04), 0.55);
    m.position.set(p[0], p[1], p[2]);
    m.rotation.y = Math.atan2(-side * s.nx, -side * s.ny);
    this.group.add(m);
    this.disposables.push(tex, geo, mat);
  }

  /** A big snowy mountain on the horizon (Mount Fuji), beyond the fog. */
  private addMountain(dir: Compass): void {
    const [dx, dy] = COMPASS_DIR[dir];
    let cx = 0, cy = 0;
    for (const s of this.ss) {
      cx += s.x / this.n;
      cy += s.y / this.n;
    }
    // Inside the camera's far plane (2600 m), so the snowy top isn't cut off.
    const dist = 2100;
    const h = 560;
    const body = new THREE.ConeGeometry(1050, h, 12);
    const cap = new THREE.ConeGeometry(1050 * 0.28, h * 0.28, 12);
    const fogless = (color: string) => new THREE.MeshBasicMaterial({ color, fog: false });
    const bodyMat = fogless(this.look.night ? '#1d2433' : '#6d7f97');
    const capMat = fogless(this.look.night ? '#9aa3b5' : '#f4f6f8');
    const m = new THREE.Mesh(body, bodyMat);
    m.position.set(cx + dx * dist, h / 2 - 40, cy + dy * dist);
    const top = new THREE.Mesh(cap, capMat);
    top.position.set(cx + dx * dist, h - 40 - (h * 0.28) / 2 + 2, cy + dy * dist);
    m.frustumCulled = top.frustumCulled = false;
    this.group.add(m, top);
    this.disposables.push(body, cap, bodyMat, capMat);
  }

  /** Concrete pillars holding up the crossover bridge, clear of the road underneath. */
  private addBridgePillars(): void {
    const e = this.elev!;
    for (let i = 0; i < this.n; i += 4) {
      if (!e.deck[i]) continue;
      const s = this.ss[i];
      const h = e.heights[i] - 1;
      for (const side of [-1, 1]) {
        const p = at(s, side * (this.wall(s, side) - 0.5));
        // Not on the lower road.
        const hit = this.track.query(p[0], p[2]);
        if (hit && Math.abs(hit.index - i) > 30 && Math.abs(hit.d) < hit.sample.halfWidth + 3) continue;
        const q = this.solid;
        const b = (x: number, z: number, y: number): [number, number, number] => [p[0] + x, y, p[2] + z];
        q.box([b(-0.7, -0.7, 0), b(0.7, -0.7, 0), b(0.7, 0.7, 0), b(-0.7, 0.7, 0)], [b(-0.7, -0.7, h), b(0.7, -0.7, h), b(0.7, 0.7, h), b(-0.7, 0.7, h)], '#a9adb2');
      }
    }
  }

  /** Night races: floodlight masts along the track. */
  private addFloodlights(): void {
    const spots: [number, number][] = [];
    for (let i = 0; i < this.n; i += 25) {
      const s = this.ss[i];
      const side = (i / 25) % 2 === 0 ? 1 : -1;
      const p = at(s, side * (this.wall(s, side) + 4));
      if (this.clear(p[0], p[2], 2.5)) spots.push([p[0], p[2]]);
    }
    if (spots.length === 0) return;
    const mast = new THREE.CylinderGeometry(0.25, 0.35, 18, 5);
    mast.translate(0, 9, 0);
    const head = new THREE.BoxGeometry(3, 1.2, 3);
    head.translate(0, 18.4, 0);
    const mastMat = new THREE.MeshLambertMaterial({ color: '#555b63' });
    const headMat = new THREE.MeshBasicMaterial({ color: '#fff4d6' });
    const masts = new THREE.InstancedMesh(mast, mastMat, spots.length);
    const heads = new THREE.InstancedMesh(head, headMat, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, y], k) => {
      m.makeTranslation(x, 0, y);
      masts.setMatrixAt(k, m);
      heads.setMatrixAt(k, m);
    });
    masts.computeBoundingSphere();
    heads.computeBoundingSphere();
    this.group.add(masts, heads);
    this.disposables.push(mast, head, mastMat, headMat);
  }
}
