import * as THREE from 'three';
import { accentOf, type Livery } from '../render/livery';

/**
 * The GT3 car's painted shell: one smooth surface from nose to tail (bonnet, front fender humps,
 * doors, wide rear haunches, ducktail) plus the roof, and the livery painted on a canvas texture
 * wrapped round it. Car frame as `Gt3Model`: x forward, z right, y up.
 *
 * The texture is an unwrap of the shell: across the canvas is along the car (tail on the left,
 * nose on the right); down the canvas goes round the car's cross-section, from the left sill,
 * up the left side, over the top, down the right side to the right sill. Below that are two
 * flat panels for the front and rear faces. So a livery is painted in plain 2D.
 */

export const NOSE_X = 2.33;
export const TAIL_X = -2.33;
/** The opening over the cabin (glass and roof sit there). */
export const CABIN_FRONT = 0.62;
export const CABIN_REAR = -0.95;
export const FRONT_AXLE = 1.45;
export const REAR_AXLE = -1.25;
const ARCH_R = 0.46;
const ARCH_Y = 0.3;
/** Where across the top the fender crowns peak (share of the half width). */
const RIDGE = 0.8;
/** How far the top edge sits in from the widest point of the side. */
const SHOULDER_IN = 0.06;

const TEX_W = 1024;
const TEX_H = 640;
/** Rows of the unwrap; the face panels are below. */
const SKIN_H = 512;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
/** A raised-cosine bump: 1 at c, 0 from w away. */
const bump = (x: number, c: number, w: number) => {
  const t = (x - c) / w;
  return Math.abs(t) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t);
};

/** Half the body's width at x: flared over the front wheels, wider still over the rear. */
export function halfWidth(x: number): number {
  let w = 0.9 + 0.095 * bump(x, 1.42, 0.85);
  w += x <= -1.3 ? 0.12 - 0.05 * smooth((-1.3 - x) / 1.03) : 0.12 * bump(x, -1.3, 0.75);
  if (x > 2.0) w -= 0.16 * ((x - 2.0) / 0.33) ** 2;
  if (x < -2.15) w -= 0.06 * ((-2.15 - x) / 0.18) ** 2;
  return w;
}

/** Height down the middle: the bonnet falling to the nose, the beltline, the rear deck and ducktail. */
function centreHeight(x: number): number {
  if (x >= CABIN_FRONT) {
    let h = 0.84 - (x - CABIN_FRONT) * 0.2;
    if (x > 2.0) h -= 0.6 * (x - 2.0) ** 2;
    return h;
  }
  if (x > CABIN_REAR) return 0.88;
  return 0.9 + 0.05 * smooth((-2.0 - x) / 0.25);
}

/** Height of the crowns: the front fender humps and the rear haunches. */
function ridgeHeight(x: number): number {
  if (x >= CABIN_FRONT) return 0.88 - (x - CABIN_FRONT) * 0.16 + 0.17 * bump(x, 1.42, 0.7);
  if (x > CABIN_REAR) return 0.88;
  const rise = x > -1.45 ? bump(x, -1.45, 0.5) : 1 - 0.4 * smooth((-1.45 - x) / 0.88);
  return 0.88 + 0.12 * rise;
}

/** How far the top rolls over from the crown down to the side (none along the doors). */
function edgeDrop(x: number): number {
  if (x >= CABIN_FRONT) return 0.08 * smooth((x - CABIN_FRONT) / 0.3);
  if (x > CABIN_REAR) return 0;
  return 0.08 * smooth((CABIN_REAR - x) / 0.3);
}

/** The bottom of the side: the sill, or the wheel arch's opening. */
export function sideBottom(x: number): number {
  for (const c of [FRONT_AXLE, REAR_AXLE]) {
    const d = x - c;
    if (Math.abs(d) < ARCH_R) return Math.max(0.17, ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - d * d));
  }
  return 0.17;
}

/** Height of the top surface at x, `s` across it (-1 left edge, 0 middle, 1 right edge). */
export function topHeight(x: number, s: number): number {
  const a = Math.abs(s);
  const hc = centreHeight(x);
  const hr = ridgeHeight(x);
  if (a <= RIDGE) return hc + (hr - hc) * smooth(a / RIDGE);
  const t = (a - RIDGE) / (1 - RIDGE);
  return hr - edgeDrop(x) * t * t;
}

/** Height of the side's top edge (the shoulder, or the door top). */
export function shoulderHeight(x: number): number {
  return ridgeHeight(x) - edgeDrop(x);
}

/** z of the top surface's edge (the shoulder). */
export function shoulderZ(x: number): number {
  return halfWidth(x) - SHOULDER_IN;
}

/** Inset of the side from its widest point, `f` from the sill (0) to the shoulder (1). */
function sideInset(f: number): number {
  return f > 0.5 ? SHOULDER_IN * ((f - 0.5) / 0.5) ** 2 : 0.03 * ((0.5 - f) / 0.5) ** 2;
}

type ProfilePoint = { side: -1 | 0 | 1; f: number; s: number; p: number };

const SIDE_F = [0, 0.2, 0.45, 0.7, 0.88];
const TOP_S = [0, 0.15, 0.3, 0.45, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1];

/** Points round the cross-section, left sill to right sill, with their place `p` (0-1) in the unwrap. */
function profile(): ProfilePoint[] {
  const pts: ProfilePoint[] = [];
  for (const f of SIDE_F) pts.push({ side: -1, f, s: -1, p: f * 0.25 });
  const across = [...TOP_S.slice(1).reverse().map((s) => -s), ...TOP_S];
  for (const s of across) pts.push({ side: 0, f: 1, s, p: 0.25 + ((s + 1) / 2) * 0.5 });
  for (const f of [...SIDE_F].reverse()) pts.push({ side: 1, f, s: 1, p: 1 - f * 0.25 });
  return pts;
}

function pointAt(x: number, pt: ProfilePoint): [number, number] {
  if (pt.side === 0) return [topHeight(x, pt.s), pt.s * shoulderZ(x)];
  const yb = sideBottom(x);
  return [yb + (shoulderHeight(x) - yb) * pt.f, pt.side * (halfWidth(x) - sideInset(pt.f))];
}

/** Where the shell is cut: every few cm, plus exactly at the cabin and the arches. */
function sections(): number[] {
  const must = [TAIL_X, NOSE_X, CABIN_FRONT, CABIN_REAR];
  for (const c of [FRONT_AXLE, REAR_AXLE]) must.push(c - ARCH_R, c, c + ARCH_R);
  const xs = [...must];
  for (let x = TAIL_X; x < NOSE_X; x += 0.06) if (must.every((m) => Math.abs(m - x) > 0.025)) xs.push(x);
  return xs.sort((a, b) => a - b);
}

/** Texture coordinates of a point on the front (+1) or rear (-1) face. */
function faceUv(end: 1 | -1, y: number, z: number): [number, number] {
  const cx = (end > 0 ? 256 - z * 250 : 768 + z * 250) / TEX_W;
  const cy = (SKIN_H + ((0.98 - y) / 0.9) * 128) / TEX_H;
  return [cx, cy];
}

/** The painted shell: sides, top, front and rear faces, and the roof. Indexed, smooth normals. */
export function shellGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const xs = sections();
  const prof = profile();
  const n = prof.length;
  const u = (x: number) => (x - TAIL_X) / (NOSE_X - TAIL_X);
  for (const x of xs) {
    for (const pt of prof) {
      const [y, z] = pointAt(x, pt);
      pos.push(x, y, z);
      uv.push(u(x), (pt.p * SKIN_H) / TEX_H);
    }
  }
  const inCabin = (x: number) => x >= CABIN_REAR - 1e-6 && x <= CABIN_FRONT + 1e-6;
  const open = (pt: ProfilePoint) => pt.side === 0 && Math.abs(pt.s) <= 0.9 + 1e-6;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      if (inCabin(xs[i]) && inCabin(xs[i + 1]) && open(prof[j]) && open(prof[j + 1])) continue;
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const c = (i + 1) * n + j + 1;
      const d = i * n + j + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  // Front and rear faces: a fan from the middle (their own vertices, so the edge stays crisp).
  for (const end of [1, -1] as const) {
    const x = end > 0 ? NOSE_X : TAIL_X;
    const ring = prof.map((pt) => pointAt(x, pt));
    const base = pos.length / 3;
    const cy = ring.reduce((sum, [y]) => sum + y, 0) / ring.length;
    pos.push(x, cy, 0);
    uv.push(...faceUv(end, cy, 0));
    for (const [y, z] of ring) {
      pos.push(x, y, z);
      uv.push(...faceUv(end, y, z));
    }
    for (let j = 0; j < n; j++) {
      const p = base + 1 + j;
      const q = base + 1 + ((j + 1) % n);
      if (end > 0) idx.push(base, p, q);
      else idx.push(base, q, p);
    }
  }
  roof(pos, uv, idx, u);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export const ROOF_FRONT = -0.12;
export const ROOF_REAR = -1.02;
export const ROOF_HALF = 0.64;
/** Where the glass meets the roof. */
export const GLASS_TOP = 1.27;

/** The roof: a gently crowned panel with a lip down to the glass all round. */
function roof(pos: number[], uv: number[], idx: number[], u: (x: number) => number): void {
  const nx = 7;
  const nz = 9;
  const v = (z: number) => ((0.25 + (z / 0.9 + 1) / 4) * SKIN_H) / TEX_H;
  const at = (i: number, j: number): [number, number, number] => {
    const x = ROOF_REAR + ((ROOF_FRONT - ROOF_REAR) * i) / (nx - 1);
    const z = -ROOF_HALF + (2 * ROOF_HALF * j) / (nz - 1);
    return [x, 1.3 + 0.025 * (1 - (z / ROOF_HALF) ** 2), z];
  };
  const base = pos.length / 3;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const [x, y, z] = at(i, j);
      pos.push(x, y, z);
      uv.push(u(x), v(z));
    }
  }
  for (let i = 0; i < nx - 1; i++) {
    for (let j = 0; j < nz - 1; j++) {
      const a = base + i * nz + j;
      const b = base + (i + 1) * nz + j;
      const c = base + (i + 1) * nz + j + 1;
      const d = base + i * nz + j + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  // The lip: round the edge, from the roof down to the glass.
  const edge: [number, number][] = [];
  for (let j = 0; j < nz; j++) edge.push([0, j]);
  for (let i = 1; i < nx; i++) edge.push([i, nz - 1]);
  for (let j = nz - 2; j >= 0; j--) edge.push([nx - 1, j]);
  for (let i = nx - 2; i > 0; i--) edge.push([i, 0]);
  const lip = pos.length / 3;
  for (const [i, j] of edge) {
    const [x, y, z] = at(i, j);
    pos.push(x, y, z, x, GLASS_TOP, z);
    uv.push(u(x), v(z), u(x), v(z));
  }
  for (let k = 0; k < edge.length; k++) {
    const a = lip + k * 2;
    const b = lip + ((k + 1) % edge.length) * 2;
    idx.push(a, b, b + 1, a, b + 1, a + 1);
  }
}


type P = [number, number];
const ux = (x: number) => ((x - TAIL_X) / (NOSE_X - TAIL_X)) * TEX_W;

const textures = new Map<string, THREE.CanvasTexture>();

/** The livery texture for the shell (one per livery and number, shared between cars). */
export function liveryTexture(l: Livery, num: number): THREE.CanvasTexture {
  const key = `${JSON.stringify(l)}|${num}`;
  let t = textures.get(key);
  if (t) return t;
  t = new THREE.CanvasTexture(paintLivery(l, num));
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

export type Sky = 'day' | 'dusk' | 'night';

const reflections = new Map<Sky, THREE.CanvasTexture>();

/**
 * What the paint and glass reflect: a little picture of a sky over a line of trees and stands
 * and a grey road. One small texture per sky, so reflections cost no extra draw calls.
 */
export function paintReflections(sky: Sky): THREE.CanvasTexture {
  let t = reflections.get(sky);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const colors = {
    day: { zenith: '#3f78c4', horizon: '#eef4fb', land: '#39443a', road: '#5b5e63', cloud: '#ffffff' },
    dusk: { zenith: '#3b4a86', horizon: '#ffb46e', land: '#2a2528', road: '#3f3b3e', cloud: '#ffd9b0' },
    night: { zenith: '#05070e', horizon: '#1a2238', land: '#0a0b10', road: '#17181d', cloud: '#2a3148' },
  }[sky];
  const up = g.createLinearGradient(0, 0, 0, 128);
  up.addColorStop(0, colors.zenith);
  up.addColorStop(1, colors.horizon);
  g.fillStyle = up;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = colors.road;
  g.fillRect(0, 128, 512, 128);
  // Long soft clouds: the bright streaks that run along a car's shoulders.
  g.fillStyle = colors.cloud;
  g.globalAlpha = 0.75;
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.ellipse(next() * 512, 30 + next() * 70, 30 + next() * 50, 4 + next() * 7, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // The dark line of trees and stands round the horizon.
  g.fillStyle = colors.land;
  for (let x = 0; x < 512; x += 8) g.fillRect(x, 128 - (5 + next() * 13), 8, 22);
  if (sky === 'night') {
    g.fillStyle = '#ffffff';
    for (let x = 12; x < 512; x += 42) g.fillRect(x, 92, 14, 5);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  reflections.set(sky, t);
  return t;
}

let sidewall: THREE.CanvasTexture | null = null;

/** Lettering round a slick's sidewall, tinted by the compound (white text on nothing). */
export function sidewallTexture(): THREE.CanvasTexture {
  if (sidewall) return sidewall;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.translate(256, 256);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, 212, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = '900 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const write = (text: string, centre: number) => {
    [...text].forEach((ch, i) => {
      g.save();
      g.rotate(centre + (i - (text.length - 1) / 2) * 0.092);
      g.translate(0, -236);
      g.fillText(ch, 0, 0);
      g.restore();
    });
  };
  write('RACING SLICK', 0);
  write('30/65 R18', Math.PI);
  sidewall = new THREE.CanvasTexture(c);
  sidewall.colorSpace = THREE.SRGBColorSpace;
  sidewall.anisotropy = 4;
  return sidewall;
}

const DARK = '#0d0d10';
const CARBON_PAINT = '#16171b';
const LIGHT = '#f4f7ff';

/** Paint the unwrap (see the top of this file). */
export function paintLivery(l: Livery, num: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const g = c.getContext('2d')!;
  const accent = accentOf(l);
  const front = l.front ?? l.body;

  // Points in the unwrap: on a side (x along, f from sill 0 to shoulder 1), on top (s across),
  // on the front face (z across, y up) and the rear face.
  const left = (x: number, f: number): P => [ux(x), f * 128];
  const right = (x: number, f: number): P => [ux(x), SKIN_H - f * 128];
  const top = (x: number, s: number): P => [ux(x), 256 + s * 128];
  const nose = (z: number, y: number): P => [256 - z * 250, SKIN_H + ((0.98 - y) / 0.9) * 128];
  const tail = (z: number, y: number): P => [768 + z * 250, SKIN_H + ((0.98 - y) / 0.9) * 128];
  const sides = [left, right];

  const poly = (pts: P[], color: string, alpha = 1) => {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b)));
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  };
  /** A line `w` px wide from a to b. */
  const band = (a: P, b: P, w: number, color: string) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * (w / 2);
    const oy = (dx / len) * (w / 2);
    poly([[a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy], [b[0] - ox, b[1] - oy], [a[0] - ox, a[1] - oy]], color);
  };

  g.fillStyle = l.body;
  g.fillRect(0, 0, TEX_W, SKIN_H);

  // Front of the car in its own colour, split on a rake with an accent line along the split.
  if (front.toLowerCase() !== l.body.toLowerCase()) {
    for (const at of sides) {
      poly([at(0.504, 1.2), at(3, 1.2), at(3, -0.2), at(1.316, -0.2)], front);
      band(at(0.504, 1.2), at(1.316, -0.2), 5, accent);
    }
    poly([top(0.62, -1.2), top(3, -1.2), top(3, 1.2), top(0.62, 1.2), top(0.95, 0)], front);
    band(top(0.62, -1.2), top(0.95, 0), 5, accent);
    band(top(0.95, 0), top(0.62, 1.2), 5, accent);
  }
  // Rear quarters in the second colour, raked forwards like the front split.
  if (l.pods && l.pods.toLowerCase() !== l.body.toLowerCase()) {
    for (const at of sides) {
      poly([at(-0.61, 1.2), at(-3, 1.2), at(-3, -0.2), at(0.16, -0.2)], l.pods);
      band(at(-0.61, 1.2), at(0.16, -0.2), 5, accent);
    }
    poly([top(-0.6, -1.2), top(-3, -1.2), top(-3, 1.2), top(-0.6, 1.2), top(-1.0, 0)], l.pods);
  }
  // A spear down each side, from low at the nose to high over the rear wheel.
  if (l.flash) {
    for (const at of sides) {
      poly([at(2.1, 0.36), at(1.7, 0.5), at(-1.55, 0.8), at(-2.25, 0.86), at(-1.95, 0.74), at(-1.4, 0.7)], l.flash);
      poly([at(1.55, 0.26), at(1.3, 0.33), at(-0.55, 0.53), at(-0.95, 0.55), at(-0.6, 0.47)], l.flash);
    }
  }
  // Chequers fading forwards over the rear quarters and the deck.
  if (l.checks) {
    const size = 0.09;
    for (let i = 0; TAIL_X + i * size < -0.4; i++) {
      const x = TAIL_X + i * size;
      const keep = 1 - (x - TAIL_X) / 1.95;
      for (let j = 0; j < 12; j++) {
        if ((i + j) % 2 || ((i * 7 + j * 13) % 10) / 10 > keep) continue;
        for (const at of sides) poly([at(x, j / 9), at(x + size, j / 9), at(x + size, (j + 1) / 9), at(x, (j + 1) / 9)], l.checks);
        poly([top(x, -1 + j / 6), top(x + size, -1 + j / 6), top(x + size, -1 + (j + 1) / 6), top(x, -1 + (j + 1) / 6)], l.checks);
        poly([top(x, 1 - j / 6), top(x + size, 1 - j / 6), top(x + size, 1 - (j + 1) / 6), top(x, 1 - (j + 1) / 6)], l.checks);
      }
    }
  }

  // Fender louvres and the bonnet vent: carbon, with slats.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const x = 1.1 + k * 0.11;
      poly([top(x, s * 0.7), top(x + 0.05, s * 0.7), top(x + 0.03, s * 0.94), top(x - 0.02, s * 0.94)], DARK, 0.9);
    }
  }
  poly([top(0.92, -0.32), top(1.55, -0.42), top(1.55, 0.42), top(0.92, 0.32)], CARBON_PAINT);
  for (let k = 0; k < 5; k++) band(top(1.0 + k * 0.11, -0.33 - k * 0.015), top(1.0 + k * 0.11, 0.33 + k * 0.015), 6, '#050506');
  // Louvres on the rear deck over the engine.
  for (let k = 0; k < 5; k++) band(top(-2.22 + k * 0.07, -0.42), top(-2.22 + k * 0.07, 0.42), 5, DARK);

  // Twin stripes nose to tail, over the roof, down both faces.
  if (l.stripe) {
    for (const s of [-1, 1]) {
      poly([top(-3, s * 0.1), top(3, s * 0.1), top(3, s * 0.24), top(-3, s * 0.24)], l.stripe);
    }
  }

  // Side vents behind the front wheels.
  for (const at of sides) {
    for (let k = 0; k < 3; k++) {
      const x = 0.74 + k * 0.08;
      poly([at(x, 0.3), at(x + 0.045, 0.3), at(x + 0.1, 0.72), at(x + 0.055, 0.72)], DARK, 0.92);
    }
  }
  // Openings behind the rear wheels.
  for (const at of sides) poly([at(-1.82, 0.28), at(-2.18, 0.32), at(-2.18, 0.78), at(-1.82, 0.74)], DARK, 0.92);
  // Carbon along the bottom of the sides, an accent pinstripe on top of it.
  for (const at of sides) {
    poly([at(-3, -0.1), at(3, -0.1), at(3, 0.13), at(-3, 0.13)], CARBON_PAINT);
    poly([at(-3, 0.13), at(3, 0.13), at(3, 0.16), at(-3, 0.16)], accent);
  }
  // Shut lines round the doors and the bonnet.
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  for (const at of sides) {
    const [a, b] = [at(-0.9, 0.17), at(0.58, 0.98)];
    g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  }
  g.beginPath();
  g.moveTo(...top(0.66, -0.78));
  g.lineTo(...top(2.15, -0.6));
  g.moveTo(...top(0.66, 0.78));
  g.lineTo(...top(2.15, 0.6));
  g.stroke();

  // Headlights: slim dark lenses with LED strips, round the nose's top corners.
  for (const s of [-1, 1]) {
    poly([top(1.98, s * 0.62), top(2.36, s * 0.66), top(2.36, s * 1.05), top(2.12, s * 1.05)], DARK);
    band(top(2.06, s * 0.7), top(2.33, s * 0.74), 5, LIGHT);
    band(top(2.15, s * 0.82), top(2.33, s * 0.84), 4, LIGHT);
    band(top(2.2, s * 0.92), top(2.33, s * 0.93), 4, LIGHT);
  }

  // Race numbers in hexagon plates: both doors, the roof, the nose.
  const hexPlate = (cx: number, cy: number, hw: number, hh: number, angle: number, size: number) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    const pts: P[] = [[-hw, 0], [-hw + hh * 0.7, -hh], [hw - hh * 0.7, -hh], [hw, 0], [hw - hh * 0.7, hh], [-hw + hh * 0.7, hh]];
    poly(pts, '#f4f4f4');
    g.lineWidth = 4;
    g.strokeStyle = '#0b0b0d';
    g.beginPath();
    pts.forEach(([a, b], i) => (i ? g.lineTo(a * 0.86, b * 0.8) : g.moveTo(a * 0.86, b * 0.8)));
    g.closePath();
    g.stroke();
    g.fillStyle = '#0b0b0d';
    g.font = `italic 900 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), 0, size * 0.06, hw * 1.4);
    g.restore();
  };
  // Left side: the car's front is to the viewer's left, so the plate is turned half round.
  hexPlate(...left(-0.17, 0.57), 68, 32, Math.PI, 50);
  hexPlate(...right(-0.17, 0.57), 68, 32, 0, 50);
  hexPlate(...top(-0.74, 0), 50, 44, Math.PI / 2, 52);
  hexPlate(...top(1.8, 0), 34, 22, -Math.PI / 2, 30);

  // The front face: bumper in the nose colour, big dark intakes, headlights, an accent lip.
  g.fillStyle = l.nose;
  g.fillRect(0, SKIN_H, 512, TEX_H - SKIN_H);
  if (l.stripe) for (const s of [-1, 1]) poly([nose(s * 0.08, 1), nose(s * 0.2, 1), nose(s * 0.2, 0.37), nose(s * 0.08, 0.37)], l.stripe);
  poly([nose(-0.38, 0.37), nose(0.38, 0.37), nose(0.3, 0.19), nose(-0.3, 0.19)], DARK);
  for (const s of [-1, 1]) {
    poly([nose(s * 0.46, 0.33), nose(s * 0.7, 0.36), nose(s * 0.72, 0.2), nose(s * 0.46, 0.2)], DARK);
    poly([nose(s * 0.42, 0.57), nose(s * 0.76, 0.6), nose(s * 0.76, 0.46), nose(s * 0.44, 0.45)], DARK);
    band(nose(s * 0.47, 0.5), nose(s * 0.72, 0.53), 4, LIGHT);
    band(nose(s * 0.55, 0.26), nose(s * 0.66, 0.26), 4, LIGHT);
  }
  poly([nose(-1.2, 0.2), nose(1.2, 0.2), nose(1.2, 0.0), nose(-1.2, 0.0)], CARBON_PAINT);
  poly([nose(-1.2, 0.2), nose(1.2, 0.2), nose(1.2, 0.185), nose(-1.2, 0.185)], accent);
  // Tow eye in red.
  poly([nose(0.5, 0.29), nose(0.56, 0.29), nose(0.56, 0.24), nose(0.5, 0.24)], '#e3141c');

  // The rear face: paint above, a full-width light bar, dark below.
  g.fillStyle = l.pods ?? l.body;
  g.fillRect(512, SKIN_H, 512, TEX_H - SKIN_H);
  if (l.stripe) for (const s of [-1, 1]) poly([tail(s * 0.08, 1), tail(s * 0.2, 1), tail(s * 0.2, 0.66), tail(s * 0.08, 0.66)], l.stripe);
  poly([tail(-1.2, 0.66), tail(1.2, 0.66), tail(1.2, 0), tail(-1.2, 0)], '#121214');
  poly([tail(-0.9, 0.84), tail(0.9, 0.84), tail(0.9, 0.81), tail(-0.9, 0.81)], '#c00c14');
  for (const s of [-1, 1]) {
    poly([tail(s * 0.6, 0.86), tail(s * 0.92, 0.88), tail(s * 0.92, 0.75), tail(s * 0.62, 0.77)], '#d4141e');
    band(tail(s * 0.66, 0.82), tail(s * 0.88, 0.83), 4, '#ff6a6a');
  }
  g.fillStyle = '#f4f4f4';
  g.font = 'italic 900 22px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GT3', ...tail(0, 0.44));
  poly([tail(-1.2, 0.66), tail(1.2, 0.66), tail(1.2, 0.645), tail(-1.2, 0.645)], accent);

  // A metallic sheen.
  if (l.shine) {
    const grad = g.createLinearGradient(0, 0, TEX_W, SKIN_H);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, TEX_W, SKIN_H);
  }
  return c;
}
