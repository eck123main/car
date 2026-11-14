import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOST_FRONT_WING, LOST_REAR_WING, LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR, type CarParts } from '../physics/car';
import { accentOf, type Livery } from '../render/livery';
import { COMPOUNDS, type Compound } from '../sim/tyres';
import {
  CARBON,
  dentAt,
  DISC_DARK,
  DISC_HOT,
  discGlow,
  mirrorUv,
  SHOWS_FROM,
  SteeringWheel,
  strut,
  tbox,
  TYRE,
  WORN_TYRE,
  type Car3d,
  type Cockpit,
  type V3,
} from './carModel';
import {
  FRONT_AXLE,
  GLASS_TOP,
  halfWidth,
  liveryTexture,
  paintReflections,
  REAR_AXLE,
  ROOF_FRONT,
  ROOF_HALF,
  ROOF_REAR,
  shellGeometry,
  shoulderHeight,
  sideBottom,
  shoulderZ,
  sidewallTexture,
  topHeight,
  type Sky,
} from './gt3Skin';
import { QuadBuilder } from './trackMesh';

/**
 * A low-poly GT3 car (think 911 GT3 R, M4 GT3, 296 GT3). Local frame as the F1 model: x forward
 * (centre at 0, nose at +2.3), z to the right, y up; the 4.6 x 2.0 m footprint of `GT3_CAR`.
 * Left-hand drive. Outside: a wide closed body with flared arches, glass, a splitter and a big
 * rear wing on swan-neck mounts. Your own car also gets the cockpit (`addSteeringWheel`): roll
 * cage with padding, bucket seat and six-point harness, door foam, window net, fire
 * extinguisher, switch panel, dash display and mirrors. Kept to a few draw calls: the body,
 * the cockpit and the cage are each one vertex-coloured mesh.
 */

/** The driver sits on the left. */
const D = -0.38;
const TRACK = 0.83;
const GLASS = '#22303d';
const SEAT = '#1d1e22';
const PAD = '#b3141e';
const STRAP = '#d0202e';
const FOAM = '#2a5bd7';
const CAGE = '#d3d6db';

/** Where the driver's eyes are (car frame), for the cockpit cameras. */
export const GT3_EYE: V3 = [-0.62, 1.06, D];

/** Wheel, shoulders and dash display for the arms and the steering wheel. */
export const GT3_COCKPIT: Cockpit = {
  wheel: [-0.13, 0.8, D],
  tilt: 0.3,
  shoulder: [-0.58, 0.9, 0.2],
  style: 'gt',
  display: [0.2, 0.97, D],
};

/** The parts that aren't painted shell: floor, skirts, diffuser, wheel wells, pillars, mirrors, roof scoop, lights. */
function bodyGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  const accent = accentOf(l);
  const dark = '#0b0b0d';
  // Floor, side skirts with an accent line along their bottom edge.
  tbox(q, -2.1, 1.95, 1.84, 1.84, 0.07, 0.12, 0.07, 0.12, CARBON);
  for (const side of [-1, 1]) {
    tbox(q, -0.82, 1.0, 0.08, 0.08, 0.08, 0.2, 0.08, 0.2, CARBON, side * 0.9);
    tbox(q, -0.82, 1.0, 0.012, 0.012, 0.085, 0.1, 0.085, 0.1, accent, side * 0.941);
  }
  // A big diffuser out under the tail, tall strakes.
  tbox(q, -2.44, -1.9, 1.62, 1.62, 0.07, 0.1, 0.07, 0.1, CARBON);
  for (const z of [-0.62, -0.31, 0, 0.31, 0.62]) tbox(q, -2.44, -1.95, 0.02, 0.02, 0.08, 0.23, 0.08, 0.12, CARBON, z);
  for (const side of [-1, 1]) tbox(q, -2.44, -1.95, 0.02, 0.02, 0.08, 0.26, 0.08, 0.16, CARBON, side * 0.8);
  // Dark wheel wells inside the arches.
  for (const c of [FRONT_AXLE, REAR_AXLE]) {
    for (const side of [-1, 1]) {
      const z0 = side * 0.5;
      for (let k = 0; k < 10; k++) {
        const a0 = (Math.PI * k) / 10;
        const a1 = (Math.PI * (k + 1)) / 10;
        const p0: [number, number] = [c + 0.45 * Math.cos(a0), 0.3 + 0.45 * Math.sin(a0)];
        const p1: [number, number] = [c + 0.45 * Math.cos(a1), 0.3 + 0.45 * Math.sin(a1)];
        const z1 = side * (Math.min(halfWidth(p0[0]), halfWidth(p1[0])) - 0.04);
        q.quad([p0[0], p0[1], z0], [p1[0], p1[1], z0], [p1[0], p1[1], z1], [p0[0], p0[1], z1], '#08080a');
      }
    }
  }
  for (const side of [-1, 1]) {
    // Carbon inside the doors.
    tbox(q, -0.88, 0.6, 0.012, 0.012, 0.14, 0.84, 0.14, 0.84, CARBON, side * 0.835);
    // Door mirror on a stalk.
    strut(q, [0.52, 0.86, side * 0.84], [0.47, 0.98, side * 0.98], 0.035, CARBON);
    tbox(q, 0.4, 0.46, 0.17, 0.16, 0.925, 1.045, 0.93, 1.04, l.body, side * 1.04);
    tbox(q, 0.46, 0.6, 0.16, 0.05, 0.93, 1.04, 0.965, 1.0, l.body, side * 1.03);
    // Black A-pillar, and the sail panel from the roof down to the haunch.
    strut(q, [0.62, 0.86, side * 0.84], [-0.12, 1.28, side * 0.64], 0.07, '#111114');
    const backZ = 0.8;
    const backY = topHeight(-1.85, backZ / shoulderZ(-1.85)) + 0.01;
    q.quad([-0.92, shoulderHeight(-0.92) + 0.005, side * shoulderZ(-0.92)], [ROOF_REAR, GLASS_TOP + 0.01, side * ROOF_HALF], [-1.8, REAR_GLASS_Y, side * 0.6], [-1.85, backY, side * backZ], l.pods ?? l.body);
    strut(q, [-0.92, 0.89, side * shoulderZ(-0.92)], [ROOF_REAR, GLASS_TOP, side * ROOF_HALF], 0.05, '#111114');
  }
  // Tail: rain light, exhausts.
  tbox(q, -2.345, -2.325, 0.2, 0.2, 0.52, 0.6, 0.52, 0.6, '#ff2a2a');
  for (const side of [-1, 1]) {
    disc(q, [-2.38, 0.32, side * 0.35], 0.07, 'x', '#6d6f75');
    disc(q, [-2.385, 0.32, side * 0.35], 0.052, 'x', '#050505');
    strut(q, [-2.38, 0.32, side * 0.35], [-2.3, 0.32, side * 0.35], 0.12, '#3b3c40');
  }
  addVents(q);
  addFittings(q);
  // Roof scoop.
  tbox(q, -0.42, -0.14, 0.3, 0.26, 1.31, 1.35, 1.31, 1.42, l.body);
  tbox(q, -0.16, -0.135, 0.22, 0.22, 1.32, 1.4, 1.32, 1.4, dark);
  // Sun strip across the top of the windscreen, and the wiper.
  q.quad([-0.01, 1.212, -0.67], [-0.01, 1.212, 0.67], [-0.12, 1.274, 0.64], [-0.12, 1.274, -0.64], l.wings);
  strut(q, [0.6, 0.885, 0.32], [0.5, 0.925, -0.48], 0.018, '#111111');
  return q.build();
}

/** A flat round plate facing along an axis. */
function disc(q: QuadBuilder, c: V3, r: number, axis: 'x' | 'y' | 'z', color: string): void {
  const n = 10;
  const at = (k: number): V3 => {
    const u = r * Math.cos((2 * Math.PI * k) / n);
    const v = r * Math.sin((2 * Math.PI * k) / n);
    if (axis === 'x') return [c[0], c[1] + u, c[2] + v];
    if (axis === 'y') return [c[0] + u, c[1], c[2] + v];
    return [c[0] + u, c[1] + v, c[2]];
  };
  for (let k = 0; k < n; k++) q.quad(c, at(k), at(k + 1), at(k + 1), color);
}

/** A point on the top surface (`s` across it, as in the livery's unwrap), `lift` above it. */
const onTop = (x: number, s: number, lift = 0): V3 => [x, topHeight(x, s) + lift, s * shoulderZ(x)];
/** A point on a side, `f` from sill to shoulder, `out` proud of it. */
function onSide(x: number, f: number, side: number, out = 0): V3 {
  const bottom = sideBottom(x);
  return [x, bottom + (shoulderHeight(x) - bottom) * f, side * (halfWidth(x) + out)];
}

/** One louvre: flush at its front edge, standing open at the back so the air can leave. */
function slat(q: QuadBuilder, x: number, chord: number, s0: number, s1: number, open: number): void {
  // In short pieces, so it follows the curve of the panel underneath.
  const pieces = 6;
  for (let i = 0; i < pieces; i++) {
    const a = s0 + ((s1 - s0) * i) / pieces;
    const b = s0 + ((s1 - s0) * (i + 1)) / pieces;
    q.quad(onTop(x + chord, a, 0.003), onTop(x + chord, b, 0.003), onTop(x, b, open), onTop(x, a, open), CARBON);
    q.quad(onTop(x, a, open), onTop(x, b, open), onTop(x, b, 0.002), onTop(x, a, 0.002), '#040405');
  }
}

/** The real openings, standing proud of the paint: louvres, grille fins, side and arch vents. */
function addVents(q: QuadBuilder): void {
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) slat(q, 1.1 + k * 0.11, 0.06, s * 0.7, s * 0.92, 0.014);
    // Side vents behind the front wheels, a fin on each one's back edge.
    for (let k = 0; k < 3; k++) {
      const x = 0.74 + k * 0.08;
      strut(q, onSide(x, 0.3, s, 0.004), onSide(x + 0.055, 0.72, s, 0.004), 0.018, CARBON);
    }
    // Vents behind the rear wheels, where the air leaves the arches.
    for (let k = 0; k < 3; k++) {
      strut(q, onSide(-1.84, 0.34 + k * 0.17, s, 0.006), onSide(-2.14, 0.38 + k * 0.17, s, 0.002), 0.03, CARBON);
    }
  }
  for (let k = 0; k < 5; k++) slat(q, 1.0 + k * 0.11, 0.065, -0.3, 0.3, 0.016);
  for (let k = 0; k < 5; k++) slat(q, -2.22 + k * 0.07, 0.05, -0.42, 0.42, 0.016);
  // Grille: fins and a bar across the big centre intake, and bars over the two beside it.
  for (let z = -0.28; z <= 0.281; z += 0.08) tbox(q, 2.32, 2.345, 0.012, 0.012, 0.19, 0.37, 0.19, 0.37, '#1c1d21', z);
  tbox(q, 2.32, 2.348, 0.76, 0.76, 0.275, 0.29, 0.275, 0.29, '#1c1d21');
  for (const s of [-1, 1]) {
    tbox(q, 2.3, 2.34, 0.26, 0.26, 0.255, 0.268, 0.255, 0.268, '#1c1d21', s * 0.59);
    // Air duct to the brakes, a round mouth in the bumper's corner.
    disc(q, [2.335, 0.28, s * 0.52], 0.045, 'x', '#050506');
  }
}

/** The small things a race car has that a road car doesn't. */
function addFittings(q: QuadBuilder): void {
  const steel = '#c4c7cc';
  // Bonnet pins.
  for (const [x, s] of [[0.78, 0.58], [2.02, 0.5]] as const) {
    for (const side of [-1, 1]) {
      const c = onTop(x, side * s, 0.012);
      disc(q, c, 0.03, 'y', steel);
      disc(q, [c[0], c[1] + 0.001, c[2]], 0.012, 'y', '#2b2c30');
    }
  }
  for (const side of [-1, 1]) {
    // Door handle: a short pull strap in a recess.
    tbox(q, -0.82, -0.66, 0.012, 0.012, 0.74, 0.78, 0.74, 0.78, '#0c0c0e', side * (halfWidth(-0.74) - 0.012));
    tbox(q, -0.79, -0.69, 0.014, 0.014, 0.752, 0.768, 0.752, 0.768, '#e3141c', side * (halfWidth(-0.74) - 0.008));
  }
  // Tow straps: a red loop on the nose, a yellow one on the tail.
  const loop = (x: number, dir: number, y: number, z: number, color: string) => {
    strut(q, [x, y + 0.05, z], [x + dir * 0.11, y, z], 0.028, color);
    strut(q, [x + dir * 0.11, y, z], [x, y - 0.05, z], 0.028, color);
  };
  loop(2.31, 1, 0.26, 0.42, '#e3141c');
  loop(-2.33, -1, 0.5, -0.56, '#f2c312');
  // Fuel: the quick-fill coupling on the right rear quarter, in a yellow ring.
  const fill = onSide(-1.08, 0.86, 1, 0.006);
  disc(q, fill, 0.065, 'z', '#f2c312');
  disc(q, [fill[0], fill[1], fill[2] + 0.002], 0.044, 'z', steel);
  disc(q, [fill[0], fill[1], fill[2] + 0.004], 0.02, 'z', '#1b1c20');
  // Air jack: the lance socket on the rear deck.
  const jack = onTop(-1.93, -0.45, 0.012);
  disc(q, jack, 0.05, 'y', steel);
  disc(q, [jack[0], jack[1] + 0.001, jack[2]], 0.026, 'y', '#e3141c');
  // Timing transponder and antenna on the roof, behind the scoop.
  tbox(q, -0.8, -0.72, 0.05, 0.05, 1.32, 1.335, 1.32, 1.335, '#111114', 0.3);
  strut(q, [-0.78, 1.32, -0.3], [-0.84, 1.46, -0.3], 0.008, '#111114');
}

/** Where the rear window meets the deck. */
const REAR_GLASS_Y = topHeight(-1.8, 0.6 / shoulderZ(-1.8)) + 0.01;

/** The glass: windscreen, side windows and the rear window (see-through). */
function glassGeometry(): THREE.BufferGeometry {
  const q = new QuadBuilder();
  q.quad([0.62, 0.86, -0.84], [0.62, 0.86, 0.84], [ROOF_FRONT, GLASS_TOP, ROOF_HALF], [ROOF_FRONT, GLASS_TOP, -ROOF_HALF], GLASS);
  for (const side of [-1, 1]) {
    q.quad([0.6, 0.88, side * shoulderZ(0.6)], [-0.92, 0.89, side * shoulderZ(-0.92)], [ROOF_REAR, GLASS_TOP, side * ROOF_HALF], [ROOF_FRONT, GLASS_TOP, side * ROOF_HALF], GLASS);
  }
  q.quad([ROOF_REAR, GLASS_TOP, -ROOF_HALF], [ROOF_REAR, GLASS_TOP, ROOF_HALF], [-1.8, REAR_GLASS_Y, 0.6], [-1.8, REAR_GLASS_Y, -0.6], GLASS);
  return q.build();
}

/** Splitter with an accent lip, end fences and canards (it can be knocked off, like an F1 front wing). */
export function gt3SplitterGeometry(accent = '#e10600'): THREE.BufferGeometry {
  const q = new QuadBuilder();
  tbox(q, 1.9, 2.42, 1.9, 1.72, 0.065, 0.095, 0.065, 0.095, CARBON);
  tbox(q, 2.395, 2.425, 1.72, 1.72, 0.093, 0.106, 0.093, 0.106, accent);
  for (const side of [-1, 1]) {
    tbox(q, 2.0, 2.41, 0.02, 0.02, 0.095, 0.22, 0.095, 0.14, CARBON, side * 0.84);
    // Canards on the bumper's corners, two a side, raked up towards the back.
    tbox(q, 1.98, 2.26, 0.2, 0.15, 0.3, 0.316, 0.37, 0.386, CARBON, side * 0.93);
    tbox(q, 1.96, 2.2, 0.17, 0.12, 0.41, 0.426, 0.47, 0.486, CARBON, side * 0.91);
  }
  return q.build();
}

/** Rear wing: two elements, big endplates, a gurney flap, on swan-neck mounts (they come off with it). */
export function gt3RearWingGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  const accent = accentOf(l);
  for (const side of [-1, 1]) {
    const z = side * 0.4;
    strut(q, [-1.86, 0.93, z], [-1.92, 1.2, z], 0.05, CARBON);
    strut(q, [-1.92, 1.2, z], [-2.0, 1.33, z], 0.05, CARBON);
    strut(q, [-2.0, 1.33, z], [-2.16, 1.3, z], 0.05, CARBON);
    tbox(q, -2.48, -1.96, 0.025, 0.025, 1.17, 1.41, 1.15, 1.29, l.endplates, side * 0.97);
    tbox(q, -2.48, -2.45, 0.03, 0.03, 1.175, 1.405, 1.175, 1.405, accent, side * 0.97);
  }
  // Main plane, trailing edge higher than the leading edge, and the flap over its back.
  tbox(q, -2.38, -1.98, 1.92, 1.92, 1.27, 1.31, 1.2, 1.24, l.wings);
  tbox(q, -2.46, -2.33, 1.92, 1.92, 1.345, 1.365, 1.305, 1.325, l.wings);
  tbox(q, -2.47, -2.455, 1.92, 1.92, 1.355, 1.4, 1.355, 1.4, accent);
  return q.build();
}

/**
 * The cockpit (own car): dash, the display's hood, the steering column, switch panel, door foam,
 * bucket seat, harness. One vertex-coloured mesh.
 */
function cockpitGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  // Headliner under the roof (the roof itself is painted).
  q.quad([-1.02, 1.265, -0.64], [-0.12, 1.265, -0.64], [-0.12, 1.265, 0.64], [-1.02, 1.265, 0.64], '#2a2b30');
  // Dashboard across the car, rising towards the windscreen, and the hood over the display.
  tbox(q, 0.2, 0.62, 1.68, 1.68, 0.45, 0.8, 0.45, 0.84, CARBON);
  tbox(q, 0.1, 0.36, 0.3, 0.3, 1.04, 1.055, 1.0, 1.015, CARBON, D);
  strut(q, [0.24, 0.84, D], [0.22, 0.93, D], 0.05, CARBON);
  // Steering column and the quick-release hub.
  strut(q, [-0.1, 0.81, D], [0.42, 0.64, D], 0.07, '#2a2b30');
  // Fire system and kill switch on the dash: red, and yellow, in white surrounds.
  for (const [z, c] of [[0.14, '#e8262b'], [0.28, '#ffcf1f']] as const) {
    tbox(q, 0.185, 0.2, 0.09, 0.09, 0.64, 0.73, 0.64, 0.73, '#f2f2f2', z);
    tbox(q, 0.17, 0.19, 0.055, 0.055, 0.66, 0.71, 0.66, 0.71, c, z);
  }
  // Switch panel on the centre console: rows of lit switches.
  tbox(q, -0.12, 0.4, 0.34, 0.34, 0.14, 0.62, 0.14, 0.78, CARBON, 0.02);
  const lit = ['#e8262b', '#27b34a', '#ffcf1f', '#2f6dff', '#f2f2f2', '#ff7a1a'];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      const x = -0.06 + i * 0.11;
      const top = 0.62 + ((x + 0.12) / 0.52) * 0.16;
      tbox(q, x, x + 0.05, 0.05, 0.05, top, top + 0.02, top, top + 0.02, lit[(i + j * 2) % lit.length], 0.02 + (j - 1) * 0.09);
    }
  }
  // Traction control, ABS and brake bias: three rotary knobs with white pointers.
  for (const z of [-0.08, 0.02, 0.12]) {
    tbox(q, 0.33, 0.39, 0.05, 0.05, 0.79, 0.825, 0.8, 0.835, '#26272b', z);
    tbox(q, 0.355, 0.39, 0.008, 0.008, 0.826, 0.83, 0.836, 0.84, '#f2f2f2', z);
  }
  // Brake bias lever on the tunnel, by the driver's right hand.
  strut(q, [-0.1, 0.62, -0.12], [-0.06, 0.74, -0.12], 0.018, '#c9ccd1');
  tbox(q, -0.09, -0.03, 0.035, 0.035, 0.74, 0.78, 0.74, 0.78, '#e8262b', -0.12);
  // Electronics on the bare passenger side: ECU and power box on a tray, orange wiring loom.
  tbox(q, -0.72, -0.1, 0.42, 0.42, 0.14, 0.18, 0.14, 0.18, CARBON, 0.46);
  tbox(q, -0.68, -0.38, 0.22, 0.22, 0.18, 0.3, 0.18, 0.3, '#3a3d44', 0.36);
  tbox(q, -0.34, -0.14, 0.16, 0.16, 0.18, 0.27, 0.18, 0.27, '#b5b8bd', 0.34);
  strut(q, [-0.38, 0.27, 0.3], [-0.1, 0.5, 0.2], 0.022, '#e0701a');
  strut(q, [-0.1, 0.5, 0.2], [0.2, 0.6, 0.2], 0.022, '#e0701a');
  strut(q, [-0.5, 0.3, 0.46], [-1.02, 0.5, 0.74], 0.018, '#e0701a');
  // Drinks: a bag behind the seat, its tube running up to the helmet.
  tbox(q, -1.03, -0.97, 0.16, 0.16, 0.5, 0.74, 0.5, 0.74, '#d7dade', D + 0.32);
  strut(q, [-1.0, 0.74, D + 0.32], [-0.82, 1.0, D + 0.17], 0.012, '#e9edf2');
  // Energy-absorbing foam on the inside of both doors (FIA side impact protection).
  for (const side of [-1, 1]) tbox(q, -0.78, 0.3, 0.13, 0.13, 0.2, 0.64, 0.2, 0.64, FOAM, side * 0.79);
  // Bucket seat: shell, cushion, side bolsters and the wings round the head.
  tbox(q, -0.95, -0.38, 0.5, 0.5, 0.14, 0.3, 0.14, 0.26, SEAT, D);
  tbox(q, -0.92, -0.42, 0.38, 0.38, 0.3, 0.33, 0.26, 0.29, PAD, D);
  q.box(
    [[-0.99, 0.28, D - 0.27], [-0.87, 0.28, D - 0.27], [-0.87, 0.28, D + 0.27], [-0.99, 0.28, D + 0.27]],
    [[-1.08, 1.14, D - 0.27], [-0.96, 1.14, D - 0.27], [-0.96, 1.14, D + 0.27], [-1.08, 1.14, D + 0.27]],
    SEAT,
  );
  for (const side of [-1, 1]) {
    tbox(q, -0.95, -0.5, 0.06, 0.06, 0.28, 0.52, 0.28, 0.42, PAD, D + side * 0.25);
    tbox(q, -1.05, -0.74, 0.05, 0.05, 0.8, 1.14, 0.84, 1.1, SEAT, D + side * 0.21);
  }
  // Six-point harness, red: shoulder straps from the harness bar over the shoulders, lap and
  // crotch straps, all to the round buckle.
  const buckle: V3 = [-0.34, 0.48, D];
  for (const side of [-1, 1]) {
    strut(q, [-1.04, 0.95, D + side * 0.1], [-0.66, 0.93, D + side * 0.1], 0.045, STRAP);
    strut(q, [-0.66, 0.93, D + side * 0.1], [buckle[0], buckle[1] + 0.03, D + side * 0.04], 0.045, STRAP);
    strut(q, [-0.62, 0.3, D + side * 0.24], [buckle[0], buckle[1] - 0.02, D + side * 0.04], 0.045, STRAP);
    strut(q, [-0.5, 0.16, D + side * 0.06], [buckle[0], buckle[1] - 0.04, D + side * 0.02], 0.04, STRAP);
  }
  tbox(q, buckle[0] - 0.02, buckle[0] + 0.02, 0.09, 0.09, buckle[1] - 0.045, buckle[1] + 0.045, buckle[1] - 0.045, buckle[1] + 0.045, '#c9ccd1', D);
  // Air hose to the helmet, from the cool box behind the seat.
  strut(q, [-1.0, 0.7, D + 0.24], [-0.82, 1.08, D + 0.14], 0.035, '#3a3c42');
  // A little colour on the floor: the livery's wing colour on the pedal box cover.
  tbox(q, 0.2, 0.55, 0.36, 0.36, 0.12, 0.3, 0.12, 0.42, l.wings, D);
  return q.build();
}

/** A tube (cylinder) from p to r, for the roll cage. */
function tube(p: V3, r: V3, radius: number): THREE.BufferGeometry {
  const a = new THREE.Vector3(...p);
  const b = new THREE.Vector3(...r);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(radius, radius, len, 8, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/**
 * The roll cage: main hoop behind the seats, tubes up the A-pillars and along the roof, a header
 * bar over the windscreen, a roof diagonal, door bars (an X on the driver's side), the dash bar,
 * the harness bar and back stays. Returns the tubes and the black padding near the driver's head.
 */
function cageGeometry(): { cage: THREE.BufferGeometry; padding: THREE.BufferGeometry } {
  const r = 0.021;
  const tubes: [V3, V3][] = [];
  const pads: [V3, V3][] = [];
  for (const s of [-1, 1]) {
    tubes.push(
      [[-1.04, 0.12, s * 0.8], [-1.04, 0.95, s * 0.8]],
      [[-1.04, 0.95, s * 0.8], [-1.04, 1.23, s * 0.58]],
      [[0.56, 0.12, s * 0.8], [0.56, 0.86, s * 0.8]],
      [[0.56, 0.86, s * 0.8], [-0.1, 1.24, s * 0.6]],
      [[-0.1, 1.24, s * 0.6], [-1.04, 1.23, s * 0.58]],
      [[-1.04, 1.23, s * 0.58], [-1.85, 0.9, s * 0.55]],
    );
  }
  tubes.push(
    [[-0.1, 1.24, -0.6], [-0.1, 1.24, 0.6]],
    [[-1.04, 1.23, -0.58], [-1.04, 1.23, 0.58]],
    [[-1.04, 1.23, -0.58], [-1.04, 0.14, 0.8]],
    [[0.5, 0.72, -0.8], [0.5, 0.72, 0.8]],
    [[-1.04, 0.95, -0.8], [-1.04, 0.95, 0.8]],
    // Door bars: an X on the driver's side, one bar on the other.
    [[0.52, 0.3, -0.8], [-1.0, 0.8, -0.8]],
    [[0.52, 0.8, -0.8], [-1.0, 0.32, -0.8]],
    [[0.52, 0.4, 0.8], [-1.0, 0.72, 0.8]],
  );
  // Padding on the tubes the driver's helmet could hit.
  pads.push(
    [[0.2, 1.1, -0.7], [-0.1, 1.24, -0.6]],
    [[-0.1, 1.24, -0.6], [-1.0, 1.23, -0.58]],
    [[-1.04, 1.23, -0.58], [-1.04, 1.23, -0.1]],
    [[0.2, 0.62, -0.8], [-0.8, 0.72, -0.8]],
  );
  return {
    cage: mergeGeometries(tubes.map(([a, b]) => tube(a, b, r))),
    padding: mergeGeometries(pads.map(([a, b]) => tube(a, b, 0.042))),
  };
}

/** The window net on the driver's door: black mesh with a red strap along the top. */
export function netTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#0d0d0f';
  ctx.lineWidth = 2;
  for (let x = -48; x < 176; x += 9) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 48, 48);
    ctx.moveTo(x + 48, 0);
    ctx.lineTo(x, 48);
    ctx.stroke();
  }
  ctx.fillStyle = STRAP;
  ctx.fillRect(0, 0, 128, 5);
  ctx.fillRect(0, 43, 128, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The car's number, the same for a livery every time (2-99). */
export function raceNumber(l: Livery): number {
  let h = 0;
  for (const ch of `${l.body}${l.wings}${l.helmet}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 2 + (h % 98);
}

type Scuff = { zone: keyof CarParts; at: V3; size: V3; from: number };

const SCUFFS: Scuff[] = [
  ...([
    [-0.2, 0.5, 0.5, 0.14, SHOWS_FROM],
    [0.3, 0.3, 0.35, 0.1, 0.2],
    [-1.4, 0.6, 0.4, 0.12, 0.3],
    [-0.6, 0.25, 0.3, 0.1, 0.45],
    [1.2, 0.5, 0.3, 0.12, 0.6],
  ] as const).flatMap(([x, y, l, h, from]): Scuff[] => [
    { zone: 'right', at: [x, y, 0.97], size: [l, h, 0.02], from },
    { zone: 'left', at: [x, y, -0.97], size: [l, h, 0.02], from },
  ]),
  { zone: 'frontWing', at: [2.1, 0.52, 0.3], size: [0.25, 0.02, 0.2], from: SHOWS_FROM },
  { zone: 'frontWing', at: [2.25, 0.4, -0.5], size: [0.15, 0.12, 0.25], from: 0.35 },
  { zone: 'rearWing', at: [-2.2, 0.88, 0.2], size: [0.2, 0.02, 0.3], from: SHOWS_FROM },
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

/** A slick: flat across the tread, the shoulders rolled into the sidewalls. */
export function tyreGeometry(radius: number, width: number): THREE.BufferGeometry {
  const h = width / 2;
  const profile = [[0, -h], [radius - 0.03, -h], [radius - 0.01, -h + 0.018], [radius, -h + 0.05], [radius, h - 0.05], [radius - 0.01, h - 0.018], [radius - 0.03, h], [0, h]];
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 24).rotateX(Math.PI / 2);
}

export const PAINT_REFLECT = 0.6;
export const GLASS_REFLECT = 0.55;

/** Material settings for a surface that reflects the sky and the land round it. */
export function reflective(sky: Sky = 'day', amount: number): THREE.MeshPhongMaterialParameters {
  return { envMap: paintReflections(sky), combine: THREE.MixOperation, reflectivity: amount };
}

/** Like real paint: little reflection looking straight at it, a lot along it. */
export function withFresnel(m: THREE.MeshPhongMaterial): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <envmap_fragment>',
      'specularStrength *= 0.16 + 0.84 * pow(1.0 - saturate(dot(normalize(vViewPosition), normal)), 3.0);\n#include <envmap_fragment>',
    );
  };
}

/** A centre-lock wheel's rim, ten thin spokes and nut, facing out along +z. */
export function spokeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.235, 0.028, 4, 18)];
  for (let i = 0; i < 10; i++) {
    const g = new THREE.BoxGeometry(0.024, 0.2, 0.024);
    g.translate(0, 0.11, 0);
    g.rotateZ((i * Math.PI) / 5);
    parts.push(g);
  }
  const nut = new THREE.CylinderGeometry(0.04, 0.04, 0.04, 6).rotateX(Math.PI / 2);
  parts.push(nut);
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

export class Gt3Model implements Car3d {
  readonly group = new THREE.Group();
  wheel: SteeringWheel | null = null;
  private readonly frontWheels: THREE.Group[] = [];
  private readonly wheels: THREE.Group[] = [];
  private readonly splitter: THREE.Mesh;
  private readonly rearWing: THREE.Mesh;
  private readonly splitterMount = new THREE.Group();
  private readonly rearWingMount = new THREE.Group();
  private readonly bodyGeo: THREE.BufferGeometry;
  private readonly shellGeo: THREE.BufferGeometry;
  /** Geometry that dents, with its undamaged positions. */
  private readonly dentable: { geo: THREE.BufferGeometry; base: Float32Array }[] = [];
  private readonly shellMat: THREE.MeshPhongMaterial | THREE.MeshLambertMaterial;
  private readonly glassMat: THREE.Material;
  private readonly shellMap: THREE.Texture | null = null;
  private readonly scuffs: { mesh: THREE.Mesh; scuff: Scuff }[] = [];
  private readonly toe = [0, 0, 0, 0];
  private readonly driver = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly miniWheel: THREE.Mesh;
  private readonly mirrors = new THREE.Group();
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly bodyMat: THREE.MeshLambertMaterial;
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

    this.bodyGeo = bodyGeometry(livery);
    this.group.add(new THREE.Mesh(this.bodyGeo, this.bodyMat));
    // The painted shell: glossy paint with the livery texture.
    this.shellGeo = shellGeometry();
    if (ghost) this.shellMat = lambert({});
    else {
      this.shellMap = liveryTexture(livery, raceNumber(livery));
      this.shellMat = new THREE.MeshPhongMaterial({ map: this.shellMap, shininess: 90, specular: '#555555', side: THREE.DoubleSide, ...reflective(opts.sky, PAINT_REFLECT) });
      withFresnel(this.shellMat);
      this.mats.push(this.shellMat);
    }
    this.group.add(new THREE.Mesh(this.shellGeo, this.shellMat));
    for (const geo of [this.bodyGeo, this.shellGeo]) this.dentable.push({ geo, base: (geo.getAttribute('position').array as Float32Array).slice() });

    // Glass: tinted, see-through from inside and out.
    const glassGeo = glassGeometry();
    this.owned.push(glassGeo);
    const glassMat = ghost ? this.bodyMat : new THREE.MeshPhongMaterial({ color: '#2b3a48', transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, shininess: 120, specular: '#777777', ...reflective(opts.sky, GLASS_REFLECT) });
    if (!ghost) this.mats.push(glassMat);
    this.glassMat = glassMat;
    this.group.add(new THREE.Mesh(glassGeo, glassMat));

    shared.scuff ??= new THREE.BoxGeometry(1, 1, 1);
    const carbon = lambert({ color: CARBON });
    for (const scuff of SCUFFS) {
      const mesh = new THREE.Mesh(shared.scuff, carbon);
      mesh.scale.set(...scuff.size);
      mesh.visible = false;
      this.group.add(mesh);
      this.scuffs.push({ mesh, scuff });
    }

    // The driver, seen through the windows from outside: helmet, suit, HANS collar.
    const helmetGeo = new THREE.SphereGeometry(0.14, 12, 8);
    const visorGeo = new THREE.BoxGeometry(0.06, 0.06, 0.19);
    const torsoGeo = new THREE.CapsuleGeometry(0.17, 0.26, 3, 10);
    const seatGeo = new THREE.BoxGeometry(0.1, 0.86, 0.54);
    const hansGeo = new THREE.BoxGeometry(0.12, 0.06, 0.3);
    this.owned.push(helmetGeo, visorGeo, torsoGeo, hansGeo, seatGeo);
    const visor = new THREE.Mesh(visorGeo, lambert({ color: '#0b0c10' }));
    visor.position.set(0.105, 0.02, 0);
    this.head.add(new THREE.Mesh(helmetGeo, lambert({ color: livery.helmet })), visor);
    this.head.position.set(GT3_EYE[0] - 0.02, GT3_EYE[1] - 0.02, D);
    const torso = new THREE.Mesh(torsoGeo, lambert({ color: livery.body }));
    torso.position.set(-0.74, 0.62, D);
    torso.rotation.z = -0.18;
    const hans = new THREE.Mesh(hansGeo, carbon);
    hans.position.set(-0.68, 0.88, D);
    // The seat behind them, only drawn from outside (inside there is the cockpit's own).
    const seat = new THREE.Mesh(seatGeo, lambert({ color: SEAT }));
    seat.position.set(-0.98, 0.7, D);
    seat.rotation.z = 0.12;
    this.driver.add(this.head, torso, hans, seat);
    this.group.add(this.driver);
    const miniGeo = new THREE.BoxGeometry(0.03, 0.26, 0.26);
    this.owned.push(miniGeo);
    this.miniWheel = new THREE.Mesh(miniGeo, carbon);
    this.miniWheel.position.set(...GT3_COCKPIT.wheel);
    this.miniWheel.rotation.z = GT3_COCKPIT.tilt;
    this.group.add(this.miniWheel);

    // Splitter and rear wing hang from mounts, so damage can droop and twist them.
    const splitterGeo = gt3SplitterGeometry(accentOf(livery));
    const wingGeo = gt3RearWingGeometry(livery);
    this.owned.push(splitterGeo, wingGeo);
    this.splitter = new THREE.Mesh(splitterGeo, this.bodyMat);
    this.rearWing = new THREE.Mesh(wingGeo, this.bodyMat);
    this.splitterMount.position.set(1.9, 0.09, 0);
    this.splitter.position.set(-1.9, -0.09, 0);
    this.splitterMount.add(this.splitter);
    this.rearWingMount.position.set(-1.95, 0.9, 0);
    this.rearWing.position.set(1.95, -0.9, 0);
    this.rearWingMount.add(this.rearWing);
    this.group.add(this.splitterMount, this.rearWingMount);

    // Wheels: tyre, a thin band in the compound's colour, black ten-spoke rims, the brake disc and caliper.
    shared.wheelFront ??= tyreGeometry(0.34, 0.3);
    shared.wheelRear ??= tyreGeometry(0.345, 0.33);
    shared.band ??= new THREE.RingGeometry(0.262, 0.336, 40);
    shared.spokes ??= spokeGeometry();
    shared.nut ??= new THREE.CylinderGeometry(0.045, 0.045, 0.03, 6).rotateX(Math.PI / 2);
    shared.disc ??= new THREE.CircleGeometry(0.19, 14);
    shared.caliper ??= new THREE.BoxGeometry(0.1, 0.17, 0.05).rotateZ(-0.7).translate(0.1, 0.09, 0);
    const addWheel = (x: number, z: number, geo: THREE.BufferGeometry, width: number) => {
      const g = new THREE.Group();
      g.position.set(x, 0.34, z);
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
      // The centre-lock nut in the car's wing colour.
      const nut = new THREE.Mesh(shared.nut!, nutMat);
      face(nut, 0.02);
      this.group.add(g);
      this.wheels.push(g);
      return g;
    };
    this.frontWheels.push(addWheel(FRONT_AXLE, -TRACK, shared.wheelFront, 0.3), addWheel(FRONT_AXLE, TRACK, shared.wheelFront, 0.3));
    addWheel(REAR_AXLE, -TRACK - 0.01, shared.wheelRear, 0.33);
    addWheel(REAR_AXLE, TRACK + 0.01, shared.wheelRear, 0.33);

    if (!ghost) {
      shared.shadow ??= new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 2.1).rotateX(-Math.PI / 2),
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
    this.frontWheels.forEach((w, i) => (w.rotation.y = -steer * 0.38 + this.toe[i]));
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

  /** Knocked off: the splitter (Car's "front wing"), the rear wing, wheels. */
  setLost(lost: number): void {
    if (lost === this.lost) return;
    this.lost = lost;
    this.splitterMount.visible = !(lost & LOST_FRONT_WING);
    this.rearWingMount.visible = !(lost & LOST_REAR_WING);
    [LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR].forEach((bit, i) => (this.wheels[i].visible = !(lost & bit)));
  }

  /** Dents, bare carbon, the splitter and wing hanging off, wheels out of line (as the F1 car). */
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
    const body = this.bodyMat;
    if ((color === null) !== (this.painted === null)) {
      body.vertexColors = color === null;
      body.needsUpdate = true;
    }
    this.painted = color;
    body.color.set(color ?? '#ffffff');
    body.emissive.set(color ?? '#000000').multiplyScalar(color ? 0.45 : 0);
    const shell = this.shellMat;
    shell.map = color ? null : this.shellMap;
    shell.needsUpdate = true;
    shell.color.set(color ?? '#ffffff');
    shell.emissive.set(color ?? '#000000').multiplyScalar(color ? 0.45 : 0);
  }

  setBrakeHeat(heat: number): void {
    const glow = Math.round(discGlow(heat) * 20) / 20;
    if (glow === this.glow || this.ghost) return;
    this.glow = glow;
    this.discMat.color.copy(DISC_DARK).lerp(DISC_HOT, glow);
    this.discMat.emissive.copy(DISC_HOT).multiplyScalar(glow * 0.9);
  }

  /** Inside the car: the driver's own helmet and body would fill the view. */
  set driverVisible(on: boolean) {
    this.driver.visible = on;
    // From inside, the windscreen is for seeing through.
    if (this.glassMat instanceof THREE.MeshPhongMaterial) this.glassMat.reflectivity = on ? GLASS_REFLECT : 0;
  }

  /** A GT car has no halo. */
  set haloVisible(_on: boolean) {}

  /** Glass on both door mirrors and the mirror inside, showing the view behind (own car only). */
  addMirrorGlass(view: THREE.Texture): void {
    const mat = new THREE.MeshBasicMaterial({ map: view });
    this.mats.push(mat);
    const glass = (w: number, h: number, u0: number, u1: number, at: V3) => {
      const geo = new THREE.PlaneGeometry(w, h);
      mirrorUv(geo, u0, u1);
      geo.rotateY(-Math.PI / 2);
      this.owned.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(...at);
      this.mirrors.add(m);
    };
    glass(0.13, 0.085, 0, 0.5, [0.415, 0.985, -1.04]);
    glass(0.13, 0.085, 0.5, 1, [0.415, 0.985, 1.04]);
    // The mirror under the header bar, a wide strip of the whole view behind.
    const frameGeo = new THREE.BoxGeometry(0.03, 0.06, 0.24);
    this.owned.push(frameGeo);
    const frame = new THREE.Mesh(frameGeo, this.lambert({ color: '#151518' }));
    frame.position.set(-0.07, 1.185, 0.02);
    this.mirrors.add(frame);
    glass(0.22, 0.045, 0.15, 0.85, [-0.086, 1.185, 0.02]);
    this.group.add(this.mirrors);
  }

  set mirrorsVisible(on: boolean) {
    this.mirrors.visible = on;
  }

  /** Your own car: the full cockpit, the GT wheel with the display on the dash, and the arms. */
  addSteeringWheel(): SteeringWheel {
    const cockpit = cockpitGeometry(this.livery);
    const { cage, padding } = cageGeometry();
    this.owned.push(cockpit, cage, padding);
    this.group.add(new THREE.Mesh(cockpit, this.bodyMat));
    this.group.add(new THREE.Mesh(cage, this.lambert({ color: CAGE })));
    this.group.add(new THREE.Mesh(padding, this.lambert({ color: '#121214' })));
    // Fire extinguisher strapped to the floor on the passenger side, with its pull handle.
    const bottleGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.46, 12).rotateZ(Math.PI / 2);
    const headGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.1, 8).rotateZ(Math.PI / 2);
    this.owned.push(bottleGeo, headGeo);
    const bottle = new THREE.Mesh(bottleGeo, this.lambert({ color: '#d0141c' }));
    bottle.position.set(-0.25, 0.22, 0.48);
    const head = new THREE.Mesh(headGeo, this.lambert({ color: '#c9ccd1' }));
    head.position.set(0.03, 0.22, 0.48);
    this.group.add(bottle, head);
    // Window net in the driver's window.
    const net = netTexture();
    const netGeo = new THREE.PlaneGeometry(0.92, 0.36);
    netGeo.translate(-0.4, 1.07, -0.8);
    this.owned.push(netGeo);
    const netMat = new THREE.MeshBasicMaterial({ map: net, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
    this.mats.push(netMat);
    this.group.add(new THREE.Mesh(netGeo, netMat));
    this.ownedTextures.push(net);

    this.wheel = new SteeringWheel(this.livery, GT3_COCKPIT);
    this.miniWheel.visible = false;
    this.group.add(this.wheel.group, this.wheel.arms, this.wheel.dash);
    return this.wheel;
  }

  dispose(): void {
    this.bodyGeo.dispose();
    this.shellGeo.dispose();
    for (const g of this.owned) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.ownedTextures) t.dispose();
    this.wheel?.dispose();
  }
}
