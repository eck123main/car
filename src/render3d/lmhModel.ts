import * as THREE from 'three';
import { LOST_FRONT_WING, LOST_REAR_WING, LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR, type CarParts } from '../physics/car';
import { accentOf, type Livery } from '../render/livery';
import { COMPOUNDS, type Compound } from '../sim/tyres';
import { CARBON, dentAt, DISC_DARK, DISC_HOT, discGlow, mirrorUv, SHOWS_FROM, SteeringWheel, strut, tbox, TYRE, WORN_TYRE, type Car3d, type Cockpit, type V3 } from './carModel';
import { GLASS_REFLECT, PAINT_REFLECT, reflective, spokeGeometry, tyreGeometry, withFresnel } from './gt3Model';
import { sidewallTexture, type Sky } from './gt3Skin';
import { QuadBuilder } from './trackMesh';

/**
 * A low-poly Le Mans Hypercar (think Toyota GR010, Ferrari 499P, Peugeot 9X8). Local frame as the
 * other models: x forward (nose at +2.45), z to the right, y up; the 5.0 x 2.0 m footprint of
 * `HYPERCAR_CAR`. Outside: front fenders standing up over the wheels either side of a low nose,
 * a narrow bubble canopy, the shark fin down the engine cover to a full-width rear wing. The
 * body is one lofted, vertex-coloured shell (the livery painted per face), glossy like the GT3's
 * paint. Your own car gets a carbon tub with the seat, harness, a GT-style wheel with the display
 * on the dash, and a rear-view screen at the top of the windscreen (these cars have no rear
 * window). Right-hand drive.
 */

const NOSE = 2.45;
const TAIL = -2.3;
const FRONT_AXLE = 1.65;
const REAR_AXLE = -1.5;
const WHEEL_R = 0.36;
const ARCH_R = 0.44;
const TRACK = 0.82;
/** The driver sits a little right of the middle. */
const D = 0.12;
const GLASS = '#22303d';
const DARK = '#0b0b0d';
const SEAT = '#1d1e22';
const STRAP = '#d0202e';

/** Where the driver's eyes are (car frame), for the cockpit cameras. */
export const LMH_EYE: V3 = [-0.38, 0.9, D];

/** Wheel, shoulders and dash display for the arms and the steering wheel. */
export const LMH_COCKPIT: Cockpit = {
  wheel: [0.02, 0.7, D],
  tilt: 0.45,
  shoulder: [-0.5, 0.76, 0.19],
  style: 'gt',
  display: [0.34, 0.8, D],
};

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const bump = (x: number, c: number, w: number) => {
  const t = (x - c) / w;
  return Math.abs(t) >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * t);
};

/** Half the body's width: full over the wheels, pulled in along the sides between them. */
export function halfWidth(x: number): number {
  let w = 0.99 - 0.25 * smooth((0.95 - x) / 0.35) * smooth((x + 0.75) / 0.35);
  if (x > 2.15) w -= 0.12 * ((x - 2.15) / 0.3) ** 2;
  if (x < -2.1) w -= 0.04 * ((-2.1 - x) / 0.2) ** 2;
  return w;
}

/** Height of the fender tops (and the sidepods between them). */
function fenderHeight(x: number): number {
  let h = 0.62 + 0.24 * bump(x, FRONT_AXLE, 0.95) + 0.3 * smooth((-0.3 - x) / 0.9);
  if (x > 2.2) h -= 0.25 * ((x - 2.2) / 0.25) ** 2;
  if (x < -2.1) h -= 0.05 * ((-2.1 - x) / 0.2) ** 2;
  return h;
}

/** Height down the middle: the low nose, the tub under the canopy, the engine cover. */
function centreHeight(x: number): number {
  if (x > 0.95) return 0.62 - 0.26 * ((x - 0.95) / 1.5) ** 1.2;
  return 0.62 + 0.26 * smooth((-0.7 - x) / 0.6);
}

/** The canopy's rise over the middle (0 outside it) and its half width. */
function canopy(x: number): { rise: number; half: number } {
  const front = smooth((1.0 - x) / 0.9);
  const rear = smooth((x + 1.25) / 0.8);
  const k = Math.min(front, rear);
  if (k <= 0) return { rise: 0, half: 0 };
  return { rise: (1.08 - centreHeight(x)) * Math.min(front, smooth((x + 1.25) / 0.6)) + 0.02 * rear * front, half: 0.08 + 0.5 * Math.sqrt(k) };
}

/** Height of the bodywork's top at x, z, under the canopy. */
function baseHeight(x: number, z: number): number {
  const a = Math.abs(z);
  const hw = halfWidth(x);
  const hc = centreHeight(x);
  const hf = fenderHeight(x);
  let h = hc + (hf - hc) * smooth((a - 0.3) / 0.25);
  if (a > hw - 0.12) h -= 0.07 * ((a - (hw - 0.12)) / 0.12) ** 2;
  return h;
}

/** Height of the top at x, z (canopy included). */
export function topHeight(x: number, z: number): number {
  const h = baseHeight(x, z);
  const c = canopy(x);
  const a = Math.abs(z);
  return a < c.half ? h + c.rise * Math.sqrt(1 - (a / c.half) ** 2) : h;
}

const CANOPY_FRONT = 1.0;
const CANOPY_REAR = -1.25;

/** Bottom of the side: the sill, or the wheel arch. */
function sideBottom(x: number): number {
  for (const c of [FRONT_AXLE, REAR_AXLE]) {
    const d = x - c;
    if (Math.abs(d) < ARCH_R) return Math.max(0.1, WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - d * d));
  }
  return 0.1;
}

/** Glass on the canopy (`s` across it, -1 to 1): the windscreen and the side windows. */
function isGlass(x: number, s: number): boolean {
  const a = Math.abs(s);
  if (x > -0.15 && x < 0.9) return a < 0.9;
  return x > -0.65 && x <= -0.15 && a > 0.45 && a < 0.9;
}

/** The livery colour of a point on the body. */
function paintAt(l: Livery, x: number, y: number, z: number, onTop: boolean): string {
  const accent = accentOf(l);
  const hw = halfWidth(x);
  const zn = Math.min(1, Math.abs(z) / hw);
  const a = Math.abs(z);
  if (!onTop && y < 0.2) return CARBON;
  if (!onTop && y < 0.23) return accent;
  // Louvres over the front wheels, dark slots.
  if (onTop && a > hw - 0.5 && a < hw - 0.18 && x > FRONT_AXLE - 0.42 && x < FRONT_AXLE + 0.4 && Math.floor((x - FRONT_AXLE) / 0.08) % 2 === 0) return '#050506';
  // Nose tip and the light strips on the fender fronts.
  if (x > NOSE - 0.25 && a < 0.42) return l.nose;
  if (x > NOSE - 0.16 && a > hw - 0.38 && a < hw - 0.12 && y > 0.36) return '#f4f7ff';
  if (onTop && l.stripe && a > 0.1 && a < 0.22) return l.stripe;
  const front = l.front && l.front.toLowerCase() !== l.body.toLowerCase() ? l.front : null;
  const edgeF = 0.75 + 0.4 * (1 - zn);
  if (front && x > edgeF) return x < edgeF + 0.05 ? accent : front;
  const pods = l.pods && l.pods.toLowerCase() !== l.body.toLowerCase() ? l.pods : null;
  const edgeR = -0.55 - 0.45 * (1 - zn);
  if (pods && x < edgeR) return x > edgeR - 0.05 ? accent : pods;
  if (!onTop && l.flash) {
    // A spear down each side, from low at the nose to high over the rear wheel.
    const t = (NOSE - x) / (NOSE - TAIL);
    const lo = 0.32 + 0.4 * t;
    if (y > lo && y < lo + 0.12 && x > -2.0) return l.flash;
  }
  if (l.checks && x < -0.6) {
    const keep = (-0.6 - x) / 1.7;
    const i = Math.floor(x / 0.09);
    const j = Math.floor((onTop ? z : y) / 0.09);
    if ((i + j) % 2 === 0 && ((i * 7 + j * 13) & 15) / 16 < keep) return l.checks;
  }
  return l.body;
}

/** The painted shell and the canopy glass. */
function shellGeometry(l: Livery): { shell: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const q = new QuadBuilder();
  const g = new QuadBuilder();
  const xs: number[] = [];
  for (let x = TAIL; x < NOSE; x += 0.07) xs.push(x);
  xs.push(NOSE);
  // Across the section, left sill to right sill: the side (f from sill 0 to top 1), then the top.
  const TOP = 33;
  /** Share of the top's samples under the canopy. */
  const INNER = 0.375;
  type Pt = { side: number; f: number; u: number };
  const prof: Pt[] = [];
  for (const f of [0, 0.35, 0.7, 1]) prof.push({ side: -1, f, u: -1 });
  for (let k = 1; k < TOP - 1; k++) prof.push({ side: 0, f: 1, u: -1 + (2 * k) / (TOP - 1) });
  for (const f of [1, 0.7, 0.35, 0]) prof.push({ side: 1, f, u: 1 });
  const at = (x: number, p: Pt): V3 => {
    const hw = halfWidth(x);
    if (p.side === 0) {
      // The middle share of the samples spans the canopy's footprint, so its edge is a grid line.
      const half = canopy(x).half;
      const a = Math.abs(p.u);
      const z = Math.sign(p.u) * (a <= INNER ? (a / INNER) * half : half + ((a - INNER) / (1 - INNER)) * (hw - 0.04 - half));
      return [x, baseHeight(x, z), z];
    }
    const top = baseHeight(x, p.side * (hw - 0.04));
    const bottom = sideBottom(x);
    const y = bottom + (Math.max(bottom, top) - bottom) * p.f;
    return [x, y, p.side * (hw - (p.f > 0.7 ? 0.04 * (p.f - 0.7) / 0.3 : 0))];
  };
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < prof.length - 1; j++) {
      const a = at(xs[i], prof[j]);
      const b = at(xs[i + 1], prof[j]);
      const c = at(xs[i + 1], prof[j + 1]);
      const d = at(xs[i], prof[j + 1]);
      const mx = (a[0] + c[0]) / 2;
      const my = (a[1] + b[1] + c[1] + d[1]) / 4;
      const mz = (a[2] + b[2] + c[2] + d[2]) / 4;
      const onTop = prof[j].side === 0 && prof[j + 1].side === 0;
      // Under the canopy: left open, so the cockpit shows through its glass.
      if (onTop && Math.abs(prof[j].u + prof[j + 1].u) / 2 < INNER && canopy(mx).half > 0) continue;
      q.quad(a, b, c, d, paintAt(l, mx, my, mz, onTop));
    }
  }
  // The canopy: its own grid (along, and across from edge to edge), so the glass has clean edges.
  const cx: number[] = [];
  for (let x = CANOPY_REAR; x < CANOPY_FRONT; x += 0.05) cx.push(x);
  cx.push(CANOPY_FRONT);
  const cs: number[] = [];
  for (let k = 0; k <= 18; k++) cs.push(-Math.cos((Math.PI * k) / 18));
  const onCanopy = (x: number, sAcross: number): V3 => {
    const c = canopy(x);
    const z = sAcross * c.half;
    return [x, baseHeight(x, z) + c.rise * Math.sqrt(Math.max(0, 1 - sAcross * sAcross)), z];
  };
  for (let i = 0; i < cx.length - 1; i++) {
    for (let k = 0; k < cs.length - 1; k++) {
      const a = onCanopy(cx[i], cs[k]);
      const b = onCanopy(cx[i + 1], cs[k]);
      const c = onCanopy(cx[i + 1], cs[k + 1]);
      const d = onCanopy(cx[i], cs[k + 1]);
      const mx = (cx[i] + cx[i + 1]) / 2;
      const ms = (cs[k] + cs[k + 1]) / 2;
      if (isGlass(mx, ms)) g.quad(a, b, c, d, GLASS);
      else q.quad(a, b, c, d, paintAt(l, mx, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, true));
    }
  }
  // The nose and tail faces: fans from the middle.
  for (const x of [NOSE, TAIL]) {
    const ring = prof.map((p) => at(x, p));
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const c: V3 = [x, cy, 0];
    for (let j = 0; j < ring.length - 1; j++) {
      const color = x > 0 ? (ring[j][1] < 0.22 ? CARBON : l.nose) : ring[j][1] > 0.68 && ring[j][1] < 0.78 ? '#c00c14' : ring[j][1] < 0.45 ? '#121214' : l.pods ?? l.body;
      q.quad(c, ring[j], ring[j + 1], ring[j + 1], color);
    }
  }
  return { shell: q.build(), glass: g.build() };
}

/** Floor, diffuser, wheel wells, fin, mirrors, lights, roof scoop. */
function bodyGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  const accent = accentOf(l);
  tbox(q, -2.2, 2.0, 1.86, 1.86, 0.05, 0.1, 0.05, 0.1, CARBON);
  // Diffuser out under the tail with strakes.
  tbox(q, -2.42, -1.95, 1.7, 1.7, 0.06, 0.09, 0.06, 0.09, CARBON);
  for (const z of [-0.6, -0.3, 0, 0.3, 0.6]) tbox(q, -2.42, -1.95, 0.02, 0.02, 0.06, 0.32, 0.06, 0.12, CARBON, z);
  // Dark wheel wells inside the arches.
  for (const c of [FRONT_AXLE, REAR_AXLE]) {
    for (const side of [-1, 1]) {
      const z0 = side * 0.45;
      for (let k = 0; k < 10; k++) {
        const a0 = (Math.PI * k) / 10;
        const a1 = (Math.PI * (k + 1)) / 10;
        const p0 = [c + ARCH_R * Math.cos(a0), WHEEL_R + ARCH_R * Math.sin(a0)];
        const p1 = [c + ARCH_R * Math.cos(a1), WHEEL_R + ARCH_R * Math.sin(a1)];
        const z1 = side * (Math.min(halfWidth(p0[0]), halfWidth(p1[0])) - 0.03);
        q.quad([p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], '#08080a');
      }
    }
  }
  // Shark fin from the canopy to the wing, the accent along its top.
  const finColor = l.pods ?? l.body;
  tbox(q, -2.22, -1.05, 0.04, 0.04, 0.84, 1.07, 0.86, 0.96, finColor);
  tbox(q, -2.22, -1.05, 0.05, 0.05, 1.065, 1.08, 0.955, 0.97, accent);
  // A white number board on each side of the fin.
  for (const side of [-1, 1]) tbox(q, -1.95, -1.55, 0.005, 0.005, 0.89, 1.03, 0.89, 1.0, '#f2f2f2', side * 0.022);
  // Roof scoop on the back of the canopy.
  tbox(q, -0.95, -0.55, 0.2, 0.16, 0.98, 1.06, 1.0, 1.1, l.body);
  tbox(q, -0.56, -0.54, 0.15, 0.15, 1.0, 1.09, 1.0, 1.09, DARK);
  // Mirrors on stalks, on the inside of the front fenders.
  for (const side of [-1, 1]) {
    strut(q, [0.82, 0.66, side * 0.62], [0.78, 0.8, side * 0.7], 0.03, CARBON);
    tbox(q, 0.7, 0.8, 0.16, 0.15, 0.75, 0.86, 0.76, 0.85, l.body, side * 0.72);
  }
  // Rear light bar and the rain light.
  tbox(q, -2.31, -2.29, 1.7, 1.7, 0.7, 0.74, 0.7, 0.74, '#e3141c');
  tbox(q, -2.33, -2.3, 0.18, 0.18, 0.5, 0.58, 0.5, 0.58, '#ff2a2a');
  // Tow strap on the nose.
  strut(q, [2.43, 0.32, 0.3], [2.53, 0.27, 0.3], 0.028, '#e3141c');
  return q.build();
}

/** Splitter with an accent lip and dive planes on the fender corners (comes off like a front wing). */
export function lmhSplitterGeometry(accent = '#e10600'): THREE.BufferGeometry {
  const q = new QuadBuilder();
  tbox(q, 1.95, 2.56, 1.94, 1.8, 0.045, 0.075, 0.045, 0.075, CARBON);
  tbox(q, 2.54, 2.565, 1.8, 1.8, 0.072, 0.085, 0.072, 0.085, accent);
  for (const side of [-1, 1]) {
    tbox(q, 2.0, 2.55, 0.02, 0.02, 0.075, 0.2, 0.075, 0.12, CARBON, side * 0.9);
    tbox(q, 2.2, 2.42, 0.18, 0.12, 0.42, 0.435, 0.47, 0.485, CARBON, side * 0.92);
  }
  return q.build();
}

/** Where the wing hangs from (its pivot when damaged), and the splitter's. */
export const LMH_WING: V3 = [-2.15, 1.0, 0];
export const LMH_SPLITTER_X = 1.95;

/** Rear wing: one wide element with a gurney, big endplates, on a swan neck from the fin. */
export function lmhRearWingGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  const accent = accentOf(l);
  strut(q, [-2.1, 1.06, 0], [-2.22, 1.13, 0], 0.05, CARBON);
  strut(q, [-2.22, 1.13, 0], [-2.33, 1.1, 0], 0.05, CARBON);
  tbox(q, -2.5, -2.12, 1.92, 1.92, 1.06, 1.1, 1.0, 1.04, l.wings);
  tbox(q, -2.52, -2.5, 1.92, 1.92, 1.07, 1.12, 1.07, 1.12, accent);
  for (const side of [-1, 1]) {
    tbox(q, -2.55, -1.95, 0.025, 0.025, 0.62, 1.14, 0.72, 1.02, l.endplates, side * 0.975);
    tbox(q, -2.55, -2.52, 0.03, 0.03, 0.63, 1.13, 0.63, 1.13, accent, side * 0.975);
  }
  return q.build();
}

/** Your own car's cockpit: tub lining, dash, seat, harness, switches, pedal box. */
function cockpitGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  // Carbon lining inside the tub and under the canopy, so the paint never shows from inside.
  for (const side of [-1, 1]) tbox(q, -1.05, 0.95, 0.02, 0.02, 0.12, 0.64, 0.12, 0.64, CARBON, side * 0.5);
  tbox(q, -1.05, 0.95, 1.0, 1.0, 0.1, 0.12, 0.1, 0.12, CARBON);
  // Dash rising to the windscreen, the display's hood, the column.
  tbox(q, 0.2, 0.75, 0.96, 0.96, 0.3, 0.74, 0.3, 0.66, CARBON);
  tbox(q, 0.24, 0.44, 0.3, 0.3, 0.88, 0.895, 0.86, 0.875, CARBON, D);
  strut(q, [0.05, 0.7, D], [0.5, 0.56, D], 0.06, '#2a2b30');
  // Switch panel left of the wheel, lit switches.
  tbox(q, 0.3, 0.42, 0.26, 0.26, 0.3, 0.5, 0.3, 0.54, CARBON, -0.16);
  const lit = ['#e8262b', '#27b34a', '#ffcf1f', '#2f6dff', '#f2f2f2', '#ff7a1a'];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tbox(q, 0.285, 0.3, 0.04, 0.04, 0.33 + i * 0.055, 0.36 + i * 0.055, 0.33 + i * 0.055, 0.36 + i * 0.055, lit[(i + j * 2) % lit.length], -0.24 + j * 0.075);
  // Seat, lying back as in a prototype, and the head surround.
  q.box(
    [[-0.95, 0.12, D - 0.25], [-0.3, 0.12, D - 0.25], [-0.3, 0.12, D + 0.25], [-0.95, 0.12, D + 0.25]],
    [[-0.95, 0.24, D - 0.25], [-0.3, 0.28, D - 0.25], [-0.3, 0.28, D + 0.25], [-0.95, 0.24, D + 0.25]],
    SEAT,
  );
  q.box(
    [[-1.0, 0.2, D - 0.25], [-0.88, 0.2, D - 0.25], [-0.88, 0.2, D + 0.25], [-1.0, 0.2, D + 0.25]],
    [[-1.12, 0.98, D - 0.25], [-1.0, 0.98, D - 0.25], [-1.0, 0.98, D + 0.25], [-1.12, 0.98, D + 0.25]],
    SEAT,
  );
  for (const side of [-1, 1]) tbox(q, -1.0, -0.55, 0.1, 0.1, 0.62, 0.92, 0.62, 0.8, '#b3141e', D + side * 0.24);
  const buckle: V3 = [-0.38, 0.45, D];
  for (const side of [-1, 1]) {
    strut(q, [-1.05, 0.86, D + side * 0.1], [-0.6, 0.82, D + side * 0.1], 0.045, STRAP);
    strut(q, [-0.6, 0.82, D + side * 0.1], [buckle[0], buckle[1] + 0.03, D + side * 0.04], 0.045, STRAP);
    strut(q, [-0.62, 0.28, D + side * 0.22], [buckle[0], buckle[1] - 0.02, D + side * 0.04], 0.045, STRAP);
  }
  tbox(q, buckle[0] - 0.02, buckle[0] + 0.02, 0.09, 0.09, buckle[1] - 0.045, buckle[1] + 0.045, buckle[1] - 0.045, buckle[1] + 0.045, '#c9ccd1', D);
  tbox(q, 0.5, 0.9, 0.34, 0.34, 0.12, 0.3, 0.12, 0.4, l.wings, D);
  return q.build();
}

type Scuff = { zone: keyof CarParts; at: V3; size: V3; from: number };

const SCUFFS: Scuff[] = [
  ...([
    [-0.1, 0.45, 0.5, 0.12, SHOWS_FROM],
    [0.4, 0.3, 0.35, 0.1, 0.2],
    [-1.3, 0.6, 0.4, 0.12, 0.3],
    [-0.5, 0.25, 0.3, 0.1, 0.45],
    [1.3, 0.55, 0.3, 0.12, 0.6],
  ] as const).flatMap(([x, y, l, h, from]): Scuff[] => [
    { zone: 'right', at: [x, y, halfWidth(x) + 0.01], size: [l, h, 0.02], from },
    { zone: 'left', at: [x, y, -halfWidth(x) - 0.01], size: [l, h, 0.02], from },
  ]),
  { zone: 'frontWing', at: [2.2, 0.48, 0.2], size: [0.25, 0.02, 0.2], from: SHOWS_FROM },
  { zone: 'frontWing', at: [2.4, 0.4, -0.6], size: [0.15, 0.12, 0.25], from: 0.35 },
  { zone: 'rearWing', at: [-2.0, 0.9, 0.4], size: [0.2, 0.02, 0.3], from: SHOWS_FROM },
  { zone: 'rearWing', at: [-2.3, 0.6, -0.4], size: [0.04, 0.15, 0.3], from: 0.35 },
];

const shared = {
  wheelFront: null as THREE.BufferGeometry | null,
  wheelRear: null as THREE.BufferGeometry | null,
  spokes: null as THREE.BufferGeometry | null,
  nut: null as THREE.BufferGeometry | null,
  band: null as THREE.BufferGeometry | null,
  disc: null as THREE.BufferGeometry | null,
  caliper: null as THREE.BufferGeometry | null,
  scuff: null as THREE.BufferGeometry | null,
  shadow: null as THREE.Mesh | null,
};

export class LmhModel implements Car3d {
  readonly group = new THREE.Group();
  wheel: SteeringWheel | null = null;
  private readonly frontWheels: THREE.Group[] = [];
  private readonly wheels: THREE.Group[] = [];
  private readonly splitterMount = new THREE.Group();
  private readonly rearWingMount = new THREE.Group();
  private readonly dentable: { geo: THREE.BufferGeometry; base: Float32Array }[] = [];
  private readonly scuffs: { mesh: THREE.Mesh; scuff: Scuff }[] = [];
  private readonly toe = [0, 0, 0, 0];
  private readonly driver = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly miniWheel: THREE.Mesh;
  private readonly mirrors = new THREE.Group();
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly paintMat: THREE.MeshPhongMaterial | THREE.MeshLambertMaterial;
  private readonly bodyMat: THREE.MeshLambertMaterial;
  private readonly glassMat: THREE.Material;
  private readonly tyreMat: THREE.MeshLambertMaterial;
  private readonly bandMat: THREE.MeshLambertMaterial;
  private readonly discMat: THREE.MeshLambertMaterial;
  private readonly ghost: boolean;
  private readonly lambert: (p: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial;
  private shadow: THREE.Object3D | null = null;
  private lost = 0;
  private damageKey = '';
  private compound: Compound | null = null;
  private painted: string | null = null;
  private glow = -1;
  private wornStep = 0;

  constructor(
    private readonly livery: Livery,
    opts: { ghost?: string; opacity?: number; sky?: Sky } = {},
  ) {
    const ghost = opts.ghost;
    this.ghost = !!ghost;
    const opacity = opts.opacity ?? 0.35;
    this.lambert = (p) => {
      const m = new THREE.MeshLambertMaterial(ghost ? { color: ghost, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide } : { side: THREE.DoubleSide, ...p });
      this.mats.push(m);
      return m;
    };
    const lambert = this.lambert;
    this.bodyMat = lambert({ vertexColors: true });
    this.tyreMat = lambert({ color: TYRE });
    this.bandMat = lambert({ color: '#ffffff', map: sidewallTexture(), transparent: true, alphaTest: 0.25, depthWrite: false });
    this.discMat = lambert({ color: DISC_DARK });
    const rimMat = lambert({ color: '#141518' });
    const caliperMat = lambert({ color: accentOf(livery) });
    const nutMat = lambert({ color: livery.wings });

    // The painted shell: glossy, reflecting the sky.
    const { shell, glass } = shellGeometry(livery);
    if (ghost) this.paintMat = this.bodyMat;
    else {
      const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: '#555555', side: THREE.DoubleSide, ...reflective(opts.sky, PAINT_REFLECT) });
      withFresnel(m);
      this.mats.push(m);
      this.paintMat = m;
    }
    const body = bodyGeometry(livery);
    this.owned.push(shell, glass, body);
    this.group.add(new THREE.Mesh(shell, this.paintMat), new THREE.Mesh(body, this.bodyMat));
    for (const geo of [shell, body]) this.dentable.push({ geo, base: (geo.getAttribute('position').array as Float32Array).slice() });

    const glassMat = ghost ? this.bodyMat : new THREE.MeshPhongMaterial({ color: '#2b3a48', transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, shininess: 120, specular: '#777777', ...reflective(opts.sky, GLASS_REFLECT) });
    if (!ghost) this.mats.push(glassMat);
    this.glassMat = glassMat;
    this.group.add(new THREE.Mesh(glass, glassMat));

    shared.scuff ??= new THREE.BoxGeometry(1, 1, 1);
    const carbon = lambert({ color: CARBON });
    for (const scuff of SCUFFS) {
      const mesh = new THREE.Mesh(shared.scuff, carbon);
      mesh.scale.set(...scuff.size);
      mesh.visible = false;
      this.group.add(mesh);
      this.scuffs.push({ mesh, scuff });
    }

    // The driver under the canopy, seen from outside: helmet and shoulders.
    const helmetGeo = new THREE.SphereGeometry(0.14, 12, 8);
    const visorGeo = new THREE.BoxGeometry(0.06, 0.06, 0.19);
    const torsoGeo = new THREE.CapsuleGeometry(0.16, 0.22, 3, 10);
    this.owned.push(helmetGeo, visorGeo, torsoGeo);
    const visor = new THREE.Mesh(visorGeo, lambert({ color: '#0b0c10' }));
    visor.position.set(0.105, 0.02, 0);
    this.head.add(new THREE.Mesh(helmetGeo, lambert({ color: livery.helmet })), visor);
    this.head.position.set(LMH_EYE[0] - 0.02, LMH_EYE[1] - 0.02, D);
    const torso = new THREE.Mesh(torsoGeo, lambert({ color: livery.body }));
    torso.position.set(-0.62, 0.55, D);
    torso.rotation.z = -0.5;
    this.driver.add(this.head, torso);
    this.group.add(this.driver);
    const miniGeo = new THREE.BoxGeometry(0.03, 0.22, 0.26);
    this.owned.push(miniGeo);
    this.miniWheel = new THREE.Mesh(miniGeo, carbon);
    this.miniWheel.position.set(...LMH_COCKPIT.wheel);
    this.miniWheel.rotation.z = LMH_COCKPIT.tilt;
    this.group.add(this.miniWheel);

    // Splitter and rear wing hang from mounts, so damage can droop and twist them.
    const splitterGeo = lmhSplitterGeometry(accentOf(livery));
    const wingGeo = lmhRearWingGeometry(livery);
    this.owned.push(splitterGeo, wingGeo);
    const splitter = new THREE.Mesh(splitterGeo, this.bodyMat);
    const wing = new THREE.Mesh(wingGeo, this.bodyMat);
    this.splitterMount.position.set(LMH_SPLITTER_X, 0.06, 0);
    splitter.position.set(-LMH_SPLITTER_X, -0.06, 0);
    this.splitterMount.add(splitter);
    this.rearWingMount.position.set(...LMH_WING);
    wing.position.set(-LMH_WING[0], -LMH_WING[1], 0);
    this.rearWingMount.add(wing);
    this.group.add(this.splitterMount, this.rearWingMount);

    // Wheels: tyre, the compound's band, black spoked rims, brake disc and caliper.
    shared.wheelFront ??= tyreGeometry(WHEEL_R, 0.31);
    shared.wheelRear ??= tyreGeometry(WHEEL_R, 0.34);
    shared.band ??= new THREE.RingGeometry(0.262, 0.336, 40);
    shared.spokes ??= spokeGeometry();
    shared.nut ??= new THREE.CylinderGeometry(0.045, 0.045, 0.03, 6).rotateX(Math.PI / 2);
    shared.disc ??= new THREE.CircleGeometry(0.19, 14);
    shared.caliper ??= new THREE.BoxGeometry(0.1, 0.17, 0.05).rotateZ(-0.7).translate(0.1, 0.09, 0);
    const addWheel = (x: number, z: number, geo: THREE.BufferGeometry, width: number) => {
      const g = new THREE.Group();
      g.position.set(x, WHEEL_R, z);
      g.add(new THREE.Mesh(geo, this.tyreMat));
      const out = Math.sign(z);
      const face = (mesh: THREE.Mesh, offset: number) => {
        mesh.position.z = out * (width / 2 + offset);
        if (out < 0) mesh.rotation.y = Math.PI;
        g.add(mesh);
      };
      face(new THREE.Mesh(shared.disc!, this.discMat), 0.002);
      face(new THREE.Mesh(shared.caliper!, caliperMat), -0.02);
      face(new THREE.Mesh(shared.spokes!, rimMat), 0.008);
      face(new THREE.Mesh(shared.band!, this.bandMat), 0.003);
      face(new THREE.Mesh(shared.nut!, nutMat), 0.02);
      this.group.add(g);
      this.wheels.push(g);
      return g;
    };
    this.frontWheels.push(addWheel(FRONT_AXLE, -TRACK, shared.wheelFront, 0.31), addWheel(FRONT_AXLE, TRACK, shared.wheelFront, 0.31));
    addWheel(REAR_AXLE, -TRACK, shared.wheelRear, 0.34);
    addWheel(REAR_AXLE, TRACK, shared.wheelRear, 0.34);

    if (!ghost) {
      shared.shadow ??= new THREE.Mesh(
        new THREE.PlaneGeometry(5.0, 2.1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      );
      const shadow = shared.shadow.clone();
      shadow.position.y = 0.01;
      this.group.add(shadow);
      this.shadow = shadow;
    }
  }

  update(x: number, y: number, heading: number, steer: number, _drsOpen: boolean, compound: Compound): void {
    this.group.position.set(x, 0, y);
    this.group.rotation.y = -heading;
    this.frontWheels.forEach((w, i) => (w.rotation.y = -steer * 0.36 + this.toe[i]));
    this.head.rotation.set(-steer * 0.1, -steer * 0.35, 0);
    this.miniWheel.rotation.x = steer * 1.2;
    if (compound !== this.compound) {
      this.compound = compound;
      if (!this.ghost) this.bandMat.color.set(COMPOUNDS[compound].color);
    }
  }

  setWear(wear: number): void {
    const step = Math.min(10, Math.round(wear * 10));
    if (step === this.wornStep || this.ghost) return;
    this.wornStep = step;
    this.tyreMat.color.set(TYRE).lerp(WORN_TYRE, step / 10);
  }

  setShadow(reach: number, angle: number): void {
    if (!this.shadow) return;
    const a = angle + this.group.rotation.y;
    this.shadow.position.x = Math.cos(a) * reach;
    this.shadow.position.z = Math.sin(a) * reach;
    this.shadow.scale.setScalar(1 + reach * 0.2);
  }

  setLost(lost: number): void {
    if (lost === this.lost) return;
    this.lost = lost;
    this.splitterMount.visible = !(lost & LOST_FRONT_WING);
    this.rearWingMount.visible = !(lost & LOST_REAR_WING);
    [LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR].forEach((bit, i) => (this.wheels[i].visible = !(lost & bit)));
  }

  setDamage(d: CarParts): void {
    const q = (v: number) => (v < SHOWS_FROM ? 0 : Math.round(v * 20) / 20);
    const parts: CarParts = { frontWing: q(d.frontWing), rearWing: q(d.rearWing), left: q(d.left), right: q(d.right) };
    const key = `${parts.frontWing}|${parts.rearWing}|${parts.left}|${parts.right}`;
    if (key === this.damageKey) return;
    this.damageKey = key;
    for (const { geo, base } of this.dentable) {
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < base.length; i += 3) {
        const [dx, dy, dz] = dentAt(base[i], base[i + 1], base[i + 2], parts);
        arr[i] = base[i] + dx;
        arr[i + 1] = base[i + 1] + dy;
        arr[i + 2] = base[i + 2] + dz;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    }
    for (const { mesh, scuff } of this.scuffs) {
      mesh.visible = parts[scuff.zone] >= scuff.from;
      if (!mesh.visible) continue;
      const [x, y, z] = scuff.at;
      const [dx, dy, dz] = dentAt(x, y, z, parts);
      mesh.position.set(x + dx, y + dy, z + dz);
    }
    const side = parts.left > parts.right ? -1 : 1;
    this.splitterMount.rotation.set(side * parts.frontWing * 0.15, -side * parts.frontWing * 0.12, -parts.frontWing * 0.12);
    this.rearWingMount.rotation.set(side * parts.rearWing * 0.25, side * parts.rearWing * 0.2, parts.rearWing * 0.15);
    [parts.left, parts.right, parts.left, parts.right].forEach((v, i) => {
      const bent = Math.max(0, v - 0.4);
      const s = i % 2 === 0 ? -1 : 1;
      this.wheels[i].rotation.x = s * bent * 0.6;
      this.toe[i] = s * bent * 0.5 * (i < 2 ? -1 : 1);
      if (i >= 2) this.wheels[i].rotation.y = this.toe[i];
    });
  }

  paint(color: string | null): void {
    if (this.ghost || color === this.painted) return;
    for (const m of [this.bodyMat, this.paintMat]) {
      if ((color === null) !== (this.painted === null)) {
        m.vertexColors = color === null;
        m.needsUpdate = true;
      }
      m.color.set(color ?? '#ffffff');
      m.emissive.set(color ?? '#000000').multiplyScalar(color ? 0.45 : 0);
    }
    this.painted = color;
  }

  setBrakeHeat(heat: number): void {
    const glow = Math.round(discGlow(heat) * 20) / 20;
    if (glow === this.glow || this.ghost) return;
    this.glow = glow;
    this.discMat.color.copy(DISC_DARK).lerp(DISC_HOT, glow);
    this.discMat.emissive.copy(DISC_HOT).multiplyScalar(glow * 0.9);
  }

  set driverVisible(on: boolean) {
    this.driver.visible = on;
    if (this.glassMat instanceof THREE.MeshPhongMaterial) this.glassMat.reflectivity = on ? GLASS_REFLECT : 0;
    // From inside you see the bodywork's underside: no sky reflected in it.
    if (this.paintMat instanceof THREE.MeshPhongMaterial) this.paintMat.reflectivity = on ? PAINT_REFLECT : 0;
  }

  /** No halo: the canopy is the protection. */
  set haloVisible(_on: boolean) {}

  /** Glass on both mirrors, and the rear-view screen at the top of the windscreen (own car). */
  addMirrorGlass(view: THREE.Texture): void {
    const mat = new THREE.MeshBasicMaterial({ map: view });
    this.mats.push(mat);
    const glass = (w: number, h: number, u0: number, u1: number, at: V3, tilt = 0) => {
      const geo = new THREE.PlaneGeometry(w, h);
      mirrorUv(geo, u0, u1);
      geo.rotateZ(tilt);
      geo.rotateY(-Math.PI / 2);
      this.owned.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...at);
      this.mirrors.add(m);
    };
    glass(0.13, 0.085, 0, 0.5, [0.695, 0.805, -0.72]);
    glass(0.13, 0.085, 0.5, 1, [0.695, 0.805, 0.72]);
    const frameGeo = new THREE.BoxGeometry(0.03, 0.08, 0.3);
    this.owned.push(frameGeo);
    const frame = new THREE.Mesh(frameGeo, this.lambert({ color: '#151518' }));
    frame.position.set(0.24, 0.99, D - 0.15);
    this.mirrors.add(frame);
    glass(0.27, 0.06, 0.1, 0.9, [0.224, 0.99, D - 0.15]);
    this.group.add(this.mirrors);
  }

  set mirrorsVisible(on: boolean) {
    this.mirrors.visible = on;
  }

  addSteeringWheel(): SteeringWheel {
    const cockpit = cockpitGeometry(this.livery);
    this.owned.push(cockpit);
    this.group.add(new THREE.Mesh(cockpit, this.bodyMat));
    this.wheel = new SteeringWheel(this.livery, LMH_COCKPIT);
    this.miniWheel.visible = false;
    this.group.add(this.wheel.group, this.wheel.arms, this.wheel.dash);
    return this.wheel;
  }

  dispose(): void {
    for (const g of this.owned) g.dispose();
    for (const m of this.mats) m.dispose();
    this.wheel?.dispose();
  }
}
