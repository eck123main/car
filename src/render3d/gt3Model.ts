import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOST_FRONT_WING, LOST_REAR_WING, LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR, type CarParts } from '../physics/car';
import type { Livery } from '../render/livery';
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
  wheelGeometry,
  type Car3d,
  type Cockpit,
  type V3,
} from './carModel';
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
const FRONT_AXLE = 1.45;
const REAR_AXLE = -1.25;
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

function bodyGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  const front = l.front ?? l.body;
  const doors = l.pods ?? l.body;
  const dark = '#0b0b0d';
  // Floor, sills and the diffuser under the tail with its strakes.
  tbox(q, -2.1, 1.95, 1.84, 1.84, 0.07, 0.12, 0.07, 0.12, CARBON);
  for (const side of [-1, 1]) tbox(q, -0.9, 0.62, 0.12, 0.12, 0.08, 0.22, 0.08, 0.22, CARBON, side * 0.93);
  tbox(q, -2.38, -1.7, 1.5, 1.5, 0.08, 0.12, 0.08, 0.12, CARBON);
  for (const z of [-0.5, -0.17, 0.17, 0.5]) tbox(q, -2.38, -1.8, 0.02, 0.02, 0.08, 0.3, 0.08, 0.12, CARBON, z);

  // Nose: bumper, grille, headlights, red tow eye.
  tbox(q, 1.95, 2.3, 1.98, 1.8, 0.12, 0.62, 0.14, 0.42, l.nose);
  tbox(q, 2.29, 2.31, 1.2, 1.2, 0.18, 0.34, 0.18, 0.34, dark);
  for (const side of [-1, 1]) {
    tbox(q, 1.98, 2.24, 0.36, 0.3, 0.5, 0.6, 0.42, 0.5, '#f6efcc', side * 0.6);
    strut(q, [2.28, 0.28, side * 0.62], [2.4, 0.3, side * 0.62], 0.04, '#e3141c');
  }
  // Bonnet between the front arches, with two vents over the radiator.
  tbox(q, 0.62, 1.95, 1.2, 1.2, 0.12, 0.84, 0.12, 0.62, front);
  for (const side of [-1, 1]) tbox(q, 1.05, 1.45, 0.42, 0.42, 0.741, 0.752, 0.672, 0.684, dark, side * 0.28);
  for (const side of [-1, 1]) {
    const z = side * 0.79;
    // Front arch over the wheel (the wheel shows under it), its crown rising over the wheel so
    // the driver sees both arches over the bonnet, and the panel behind it.
    tbox(q, 0.62, 1.45, 0.44, 0.44, 0.7, 0.87, 0.7, 0.93, front, z);
    tbox(q, 1.45, 1.95, 0.44, 0.42, 0.7, 0.93, 0.66, 0.73, front, z);
    tbox(q, 0.62, 1.07, 0.44, 0.44, 0.12, 0.7, 0.12, 0.7, front, z);
    // Louvres on top of the arch, letting the air out of the wheel well.
    for (let i = 0; i < 4; i++) {
      const x = 1.15 + i * 0.12;
      const top = x < 1.45 ? 0.87 + ((x - 0.62) / 0.83) * 0.06 : 0.93 - ((x - 1.45) / 0.5) * 0.2;
      tbox(q, x, x + 0.06, 0.3, 0.3, top, top + 0.012, top, top + 0.012, dark, z);
    }
    // Rear arch, wider still, and the panel behind it.
    tbox(q, -2.1, -0.88, 0.46, 0.46, 0.74, 0.9, 0.72, 0.9, l.body, side * 0.78);
    tbox(q, -2.1, -1.62, 0.46, 0.46, 0.14, 0.74, 0.14, 0.74, l.body, side * 0.78);
    // Doors: thin walls round the cabin, carbon inside.
    tbox(q, -0.88, 0.62, 0.08, 0.08, 0.14, 0.88, 0.14, 0.88, doors, side * 0.9);
    tbox(q, -0.88, 0.62, 0.012, 0.012, 0.14, 0.86, 0.14, 0.86, CARBON, side * 0.855);
    // Door mirror on a stalk.
    strut(q, [0.56, 0.9, side * 0.9], [0.5, 0.98, side * 1.0], 0.035, CARBON);
    tbox(q, 0.42, 0.58, 0.16, 0.14, 0.93, 1.04, 0.94, 1.03, l.body, side * 1.04);
    // A-pillar, and the sail panel from the roof down to the rear arch.
    strut(q, [0.62, 0.87, side * 0.87], [-0.12, 1.28, side * 0.66], 0.08, l.body);
    q.quad([-0.88, 0.88, side * 0.92], [-1.0, 1.28, side * 0.66], [-1.8, 0.92, side * 0.6], [-1.9, 0.9, side * 0.92], l.body);
    strut(q, [-0.88, 0.88, side * 0.91], [-1.0, 1.28, side * 0.66], 0.05, CARBON);
    // White number panel on the door (the number itself is a decal over it).
    tbox(q, -0.62, 0.22, 0.012, 0.012, 0.36, 0.78, 0.36, 0.78, '#f2f2f2', side * 0.947);
  }
  if (l.flash) for (const side of [-1, 1]) tbox(q, -1.95, 1.9, 0.012, 0.012, 0.2, 0.3, 0.2, 0.3, l.flash, side * 0.955);
  if (l.stripe) {
    tbox(q, 0.62, 1.95, 0.14, 0.14, 0.843, 0.848, 0.623, 0.628, l.stripe, -0.18);
    tbox(q, 0.62, 1.95, 0.14, 0.14, 0.843, 0.848, 0.623, 0.628, l.stripe, 0.18);
  }

  // Rear deck, tail, lights, exhausts.
  tbox(q, -2.1, -1.05, 1.16, 1.16, 0.14, 0.9, 0.14, 0.9, l.body);
  tbox(q, -2.3, -2.1, 1.84, 1.98, 0.22, 0.84, 0.16, 0.9, l.body);
  tbox(q, -2.316, -2.3, 1.7, 1.7, 0.73, 0.76, 0.73, 0.76, '#7a0c12');
  for (const side of [-1, 1]) tbox(q, -2.322, -2.3, 0.36, 0.36, 0.62, 0.8, 0.62, 0.8, '#d4141e', side * 0.72);
  tbox(q, -2.322, -2.3, 1.6, 1.6, 0.22, 0.4, 0.22, 0.4, '#141416');
  tbox(q, -2.326, -2.3, 0.2, 0.2, 0.52, 0.62, 0.52, 0.62, '#ff2a2a');
  for (const side of [-1, 1]) {
    tbox(q, -2.36, -2.28, 0.12, 0.12, 0.26, 0.38, 0.26, 0.38, '#3b3c40', side * 0.35);
    tbox(q, -2.362, -2.35, 0.08, 0.08, 0.29, 0.35, 0.29, 0.35, '#050505', side * 0.35);
  }

  // Roof with an intake, a number panel and the windscreen's sun strip.
  tbox(q, -1.02, -0.12, 1.32, 1.32, 1.27, 1.32, 1.27, 1.32, l.body);
  tbox(q, -0.75, -0.25, 0.32, 0.26, 1.32, 1.37, 1.32, 1.43, l.body);
  tbox(q, -0.27, -0.245, 0.24, 0.24, 1.33, 1.42, 1.33, 1.42, dark);
  tbox(q, -0.98, -0.42, 0.5, 0.5, 1.32, 1.324, 1.32, 1.324, '#f2f2f2');
  q.quad([-0.01, 1.202, -0.67], [-0.01, 1.202, 0.67], [-0.12, 1.264, 0.64], [-0.12, 1.264, -0.64], l.wings);
  // Wiper resting at the bottom of the windscreen.
  strut(q, [0.6, 0.885, 0.32], [0.5, 0.925, -0.48], 0.018, '#111111');
  return q.build();
}

/** The glass: windscreen, side windows and the rear window (see-through). */
function glassGeometry(): THREE.BufferGeometry {
  const q = new QuadBuilder();
  q.quad([0.62, 0.86, -0.84], [0.62, 0.86, 0.84], [-0.12, 1.27, 0.64], [-0.12, 1.27, -0.64], GLASS);
  for (const side of [-1, 1]) q.quad([0.6, 0.88, side * 0.9], [-0.88, 0.88, side * 0.9], [-1.0, 1.27, side * 0.66], [-0.12, 1.27, side * 0.66], GLASS);
  q.quad([-1.02, 1.27, -0.64], [-1.02, 1.27, 0.64], [-1.8, 0.91, 0.6], [-1.8, 0.91, -0.6], GLASS);
  return q.build();
}

/** Splitter and dive planes on the nose (it can be knocked off, like an F1 front wing). */
export function gt3SplitterGeometry(): THREE.BufferGeometry {
  const q = new QuadBuilder();
  tbox(q, 1.85, 2.45, 1.94, 1.94, 0.07, 0.1, 0.07, 0.1, CARBON);
  for (const side of [-1, 1]) {
    tbox(q, 2.05, 2.28, 0.22, 0.2, 0.3, 0.32, 0.35, 0.37, CARBON, side * 0.94);
    tbox(q, 2.0, 2.2, 0.2, 0.18, 0.4, 0.42, 0.44, 0.46, CARBON, side * 0.9);
  }
  return q.build();
}

/** Rear wing with endplates and a gurney flap, on swan-neck mounts (they come off with it). */
export function gt3RearWingGeometry(l: Livery): THREE.BufferGeometry {
  const q = new QuadBuilder();
  for (const side of [-1, 1]) {
    strut(q, [-1.95, 0.9, side * 0.36], [-2.06, 1.22, side * 0.36], 0.05, CARBON);
    strut(q, [-2.06, 1.22, side * 0.36], [-2.38, 1.43, side * 0.36], 0.05, CARBON);
    tbox(q, -2.76, -2.14, 0.03, 0.03, 1.08, 1.56, 1.14, 1.46, l.endplates, side * 0.97);
  }
  // Main plane, trailing edge higher than the leading edge.
  tbox(q, -2.68, -2.22, 1.9, 1.9, 1.4, 1.445, 1.32, 1.365, l.wings);
  tbox(q, -2.7, -2.67, 1.9, 1.9, 1.43, 1.49, 1.43, 1.49, CARBON);
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
function netTexture(): THREE.CanvasTexture {
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

const numberTextures = new Map<number, THREE.CanvasTexture>();

/** A race number decal (black on the white panels), made once per number. */
function numberTexture(n: number): THREE.CanvasTexture {
  let t = numberTextures.get(n);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b0b0d';
  ctx.font = 'italic 900 78px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 64, 52, 120);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  numberTextures.set(n, t);
  return t;
}

/** The car's number, the same for a livery every time (2-99). */
export function raceNumber(l: Livery): number {
  let h = 0;
  for (const ch of `${l.body}${l.wings}${l.helmet}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 2 + (h % 98);
}

/** Planes for the number on both doors and the roof panel. */
function numberGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(0.7, 0.4);
    // Facing out of the car; the left one turned round so the number reads the right way.
    g.rotateY(side > 0 ? Math.PI : 0);
    g.translate(-0.2, 0.57, side * 0.955);
    parts.push(g);
  }
  const roof = new THREE.PlaneGeometry(0.5, 0.4);
  roof.rotateX(-Math.PI / 2);
  roof.rotateY(-Math.PI / 2);
  roof.translate(-0.7, 1.327, 0);
  parts.push(roof);
  return mergeGeometries(parts);
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
  scuff: null as THREE.BufferGeometry | null,
  shadow: null as THREE.Mesh | null,
};

/** A centre-lock wheel's rim, six spokes and nut, facing out along +z. */
function spokeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(0.235, 0.028, 4, 18)];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.BoxGeometry(0.035, 0.2, 0.02);
    g.translate(0, 0.11, 0);
    g.rotateZ((i * Math.PI) / 3);
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
  private readonly basePositions: Float32Array;
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
    opts: { ghost?: string; opacity?: number } = {},
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
    this.bandMat = lambert({ color: '#ffffff' });
    this.discMat = lambert({ color: DISC_DARK });
    const rimMat = lambert({ color: '#2a2c31' });
    const nutMat = lambert({ color: livery.wings });

    this.bodyGeo = bodyGeometry(livery);
    this.basePositions = (this.bodyGeo.getAttribute('position').array as Float32Array).slice();
    this.group.add(new THREE.Mesh(this.bodyGeo, this.bodyMat));

    // Glass: tinted, see-through from inside and out.
    const glassGeo = glassGeometry();
    this.owned.push(glassGeo);
    const glassMat = ghost ? this.bodyMat : new THREE.MeshLambertMaterial({ color: '#2b3a48', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    if (!ghost) this.mats.push(glassMat);
    this.group.add(new THREE.Mesh(glassGeo, glassMat));

    if (!ghost) {
      const numGeo = numberGeometry();
      this.owned.push(numGeo);
      const numMat = new THREE.MeshBasicMaterial({ map: numberTexture(raceNumber(livery)), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
      this.mats.push(numMat);
      this.group.add(new THREE.Mesh(numGeo, numMat));
    }

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
    const torsoGeo = new THREE.BoxGeometry(0.28, 0.5, 0.42);
    const hansGeo = new THREE.BoxGeometry(0.12, 0.06, 0.3);
    this.owned.push(helmetGeo, visorGeo, torsoGeo, hansGeo);
    const visor = new THREE.Mesh(visorGeo, lambert({ color: '#0b0c10' }));
    visor.position.set(0.105, 0.02, 0);
    this.head.add(new THREE.Mesh(helmetGeo, lambert({ color: livery.helmet })), visor);
    this.head.position.set(GT3_EYE[0] - 0.02, GT3_EYE[1] - 0.02, D);
    const torso = new THREE.Mesh(torsoGeo, lambert({ color: livery.body }));
    torso.position.set(-0.74, 0.62, D);
    torso.rotation.z = -0.18;
    const hans = new THREE.Mesh(hansGeo, carbon);
    hans.position.set(-0.68, 0.88, D);
    this.driver.add(this.head, torso, hans);
    this.group.add(this.driver);
    const miniGeo = new THREE.BoxGeometry(0.03, 0.26, 0.26);
    this.owned.push(miniGeo);
    this.miniWheel = new THREE.Mesh(miniGeo, carbon);
    this.miniWheel.position.set(...GT3_COCKPIT.wheel);
    this.miniWheel.rotation.z = GT3_COCKPIT.tilt;
    this.group.add(this.miniWheel);

    // Splitter and rear wing hang from mounts, so damage can droop and twist them.
    const splitterGeo = gt3SplitterGeometry();
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

    // Wheels: tyre, a thin band in the compound's colour, dark six-spoke rims, the brake disc.
    shared.wheelFront ??= wheelGeometry(0.34, 0.3);
    shared.wheelRear ??= wheelGeometry(0.345, 0.33);
    shared.band ??= new THREE.TorusGeometry(0.3, 0.008, 3, 20);
    shared.spokes ??= spokeGeometry();
    shared.nut ??= new THREE.CylinderGeometry(0.045, 0.045, 0.03, 6).rotateX(Math.PI / 2);
    shared.disc ??= new THREE.CircleGeometry(0.19, 14);
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
    const pos = this.bodyGeo.getAttribute('position') as THREE.BufferAttribute;
    const base = this.basePositions;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < base.length; i += 3) {
      const [dx, dy, dz] = dentAt(base[i], base[i + 1], base[i + 2], parts);
      arr[i] = base[i] + dx;
      arr[i + 1] = base[i + 1] + dy;
      arr[i + 2] = base[i + 2] + dz;
    }
    pos.needsUpdate = true;
    this.bodyGeo.computeVertexNormals();
    this.bodyGeo.computeBoundingSphere();
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
    netGeo.translate(-0.4, 1.07, -0.865);
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
    for (const g of this.owned) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.ownedTextures) t.dispose();
    this.wheel?.dispose();
  }
}
