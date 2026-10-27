import { LOST_FRONT_WING, LOST_REAR_WING, LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR, type CarParts } from '../physics/car';
import type { CarParams } from '../physics/carParams';
import { COMPOUNDS, type Compound } from '../sim/tyres';
import { liveryFor, type Livery } from './livery';

export interface CarLook {
  /** DRS flap open: the rear wing lights up green. */
  drsOpen?: boolean;
  /** Tyres fitted: shown as coloured sidewalls, like the real ones. */
  compound?: Compound;
  /** Wet track: the red rain light at the back blinks. */
  rainLight?: boolean;
  /** Seconds, for the rain light's blink. */
  time?: number;
  /** A skin's paint, in place of the colour's team livery. */
  livery?: Livery | null;
  /** Parts knocked off (Car.lost bits): not drawn. */
  lost?: number;
  /** Damage per part (0-1): shows as bare carbon, scratches, bent wings and wheels out of line. */
  parts?: CarParts;
}

/** Damage this small doesn't show. */
const SHOWS_FROM = 0.08;

/**
 * Patches of bare carbon where the paint and bodywork are gone, on the right side of the car
 * (mirrored for the left): x, y (centre), length, width, and the damage from which each shows.
 */
const SIDE_SCUFFS: [number, number, number, number, number][] = [
  [-0.4, 0.5, 0.5, 0.12, SHOWS_FROM],
  [0.15, 0.52, 0.28, 0.09, 0.2],
  [-1.05, 0.44, 0.42, 0.1, 0.3],
  [-0.65, 0.33, 0.32, 0.13, 0.45],
  [-1.35, 0.3, 0.26, 0.14, 0.6],
  [0.3, 0.38, 0.2, 0.14, 0.75],
];
const NOSE_SCUFFS: [number, number, number, number, number][] = [
  [2.45, 0.05, 0.3, 0.14, SHOWS_FROM],
  [2.05, -0.1, 0.35, 0.1, 0.3],
  [1.65, 0.12, 0.3, 0.1, 0.55],
];
const TAIL_SCUFFS: [number, number, number, number, number][] = [
  [-2.25, 0.12, 0.25, 0.14, SHOWS_FROM],
  [-1.9, -0.15, 0.3, 0.1, 0.35],
  [-2.3, -0.2, 0.2, 0.12, 0.6],
];

const CARBON = '#1b1b1b';
const TYRE = '#121212';

/**
 * Top-down F1 car, drawn in world metres, nose along +x. Same outline for every car; the
 * paint comes from the car's livery. Details are kept bold, as a car is only ~35 px long.
 */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  p: CarParams,
  x: number,
  y: number,
  heading: number,
  steer: number,
  color: string,
  look: CarLook = {},
): void {
  const hl = p.length / 2;
  const hw = p.width / 2;
  const liv = look.livery ?? liveryFor(color);
  const lost = look.lost ?? 0;
  const dmg = look.parts;
  // Wings bend towards the side that took the hit.
  const hitSide = dmg && dmg.left > dmg.right ? -1 : 1;
  /** A broken suspension knocks the wheel out of line (front: toe out, rear: toe in). */
  const toe = (side: number, front: boolean) => {
    const d = dmg ? (side > 0 ? dmg.right : dmg.left) : 0;
    return d > 0.4 ? (d - 0.4) * 0.6 * side * (front ? 1 : -1) : 0;
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  // Floor: a dark carbon edge showing round the sidepods.
  ctx.fillStyle = CARBON;
  ctx.beginPath();
  ctx.moveTo(1.0, -0.42);
  ctx.lineTo(0.5, -0.72);
  ctx.lineTo(-1.5, -0.72);
  ctx.lineTo(-2.3, -0.45);
  ctx.lineTo(-2.3, 0.45);
  ctx.lineTo(-1.5, 0.72);
  ctx.lineTo(0.5, 0.72);
  ctx.lineTo(1.0, 0.42);
  ctx.closePath();
  ctx.fill();

  // Wheels, with the compound's colour on both sidewalls.
  const sidewall = look.compound ? COMPOUNDS[look.compound].color : null;
  const wheel = (wx: number, wy: number, angle: number) => {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(angle);
    ctx.fillStyle = TYRE;
    ctx.fillRect(-0.36, -0.2, 0.72, 0.4);
    if (sidewall) {
      ctx.fillStyle = sidewall;
      ctx.fillRect(-0.3, -0.2, 0.6, 0.09);
      ctx.fillRect(-0.3, 0.11, 0.6, 0.09);
    }
    ctx.restore();
  };
  if (!(lost & LOST_WHEEL_FL)) wheel(p.cgToFront, -hw + 0.2, steer + toe(-1, true));
  if (!(lost & LOST_WHEEL_FR)) wheel(p.cgToFront, hw - 0.2, steer + toe(1, true));
  if (!(lost & LOST_WHEEL_RL)) wheel(-p.cgToRear, -hw + 0.22, toe(-1, false));
  if (!(lost & LOST_WHEEL_RR)) wheel(-p.cgToRear, hw - 0.22, toe(1, false));
  // Suspension arms out to the wheels.
  ctx.strokeStyle = CARBON;
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(p.cgToFront, side * 0.25);
    ctx.lineTo(p.cgToFront, side * (hw - 0.3));
    ctx.moveTo(-p.cgToRear, side * 0.3);
    ctx.lineTo(-p.cgToRear, side * (hw - 0.3));
  }
  ctx.stroke();

  // Body: narrow nose, wider sidepods. The livery is painted inside this outline.
  const body = new Path2D();
  body.moveTo(hl - 0.1, 0);
  body.lineTo(1.2, -0.28);
  body.lineTo(0.4, -0.6);
  body.lineTo(-1.4, -0.55);
  body.lineTo(-hl + 0.4, -0.3);
  body.lineTo(-hl + 0.4, 0.3);
  body.lineTo(-1.4, 0.55);
  body.lineTo(0.4, 0.6);
  body.lineTo(1.2, 0.28);
  body.closePath();
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = liv.body;
  ctx.fillRect(-hl, -hw, p.length, p.width);
  if (liv.front) {
    // Front half in a second colour, with a slanted break behind the cockpit.
    ctx.fillStyle = liv.front;
    ctx.beginPath();
    ctx.moveTo(hl, -hw);
    ctx.lineTo(-0.3, -hw);
    ctx.lineTo(-0.9, 0);
    ctx.lineTo(-0.3, hw);
    ctx.lineTo(hl, hw);
    ctx.closePath();
    ctx.fill();
  }
  if (liv.pods) {
    ctx.fillStyle = liv.pods;
    ctx.fillRect(-1.7, -hw, 2.2, hw - 0.28);
    ctx.fillRect(-1.7, 0.28, 2.2, hw - 0.28);
  }
  if (liv.flash) {
    // A swoosh along each sidepod, sweeping back towards the rear wing.
    ctx.fillStyle = liv.flash;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0.45, side * 0.6);
      ctx.lineTo(-1.6, side * 0.32);
      ctx.lineTo(-1.6, side * 0.2);
      ctx.lineTo(0.2, side * 0.45);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (liv.checks) {
    ctx.fillStyle = liv.checks;
    const sq = 0.3;
    for (let i = 0; i * sq < p.length; i++) {
      for (let j = 0; j * sq < p.width; j++) if ((i + j) % 2 === 0) ctx.fillRect(-hl + i * sq, -hw + j * sq, sq, sq);
    }
  }
  if (liv.stripe) {
    ctx.fillStyle = liv.stripe;
    ctx.fillRect(-hl, -0.09, p.length, 0.18);
  }
  if (liv.shine) {
    // Metallic: a bright band across the body, fading out either side.
    const g = ctx.createLinearGradient(-1.2, -hw, 0.4, hw);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-hl, -hw, p.length, p.width);
  }
  // Nose tip.
  ctx.fillStyle = liv.nose;
  ctx.fillRect(hl - 0.75, -hw, 0.75, p.width);
  if (dmg) drawBodyDamage(ctx, dmg);
  ctx.restore();

  // Sidepod inlets.
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0.2, -0.58, 0.2, 0.26);
  ctx.fillRect(0.2, 0.32, 0.2, 0.26);
  // Engine cover fin.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-2.25, -0.05, 1.7, 0.1);

  // Front wing: two elements and endplates. Knocked off: just the broken pylons on the nose.
  if (lost & LOST_FRONT_WING) {
    ctx.fillStyle = CARBON;
    ctx.fillRect(hl - 0.45, -0.22, 0.3, 0.08);
    ctx.fillRect(hl - 0.45, 0.14, 0.3, 0.08);
  } else drawFrontWing(ctx, liv, hl, hw, p.width, dmg?.frontWing ?? 0, hitSide);

  // Rear wing: mainplane and endplates; the whole wing lights up green with DRS open.
  if (lost & LOST_REAR_WING) {
    ctx.fillStyle = CARBON;
    ctx.fillRect(-hl + 0.1, -0.08, 0.45, 0.16);
  } else if (look.drsOpen) {
    ctx.fillStyle = 'rgba(46, 204, 64, 0.35)';
    ctx.fillRect(-hl - 0.9, -0.85, 0.9, 1.7);
    ctx.fillStyle = '#39ff5a';
    ctx.fillRect(-hl - 0.1, -0.95, 0.6, 1.9);
  } else drawRearWing(ctx, liv, -hl, dmg?.rearWing ?? 0, hitSide);

  // Rain light: blinks red on a wet track, as the rules require.
  if (look.rainLight && Math.floor((look.time ?? 0) * 4) % 2 === 0) {
    ctx.fillStyle = 'rgba(255, 30, 30, 0.45)';
    ctx.fillRect(-hl - 0.55, -0.32, 0.5, 0.64);
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(-hl - 0.12, -0.16, 0.14, 0.32);
  }

  // Mirrors.
  ctx.fillStyle = liv.body;
  ctx.fillRect(0.45, -0.72, 0.16, 0.14);
  ctx.fillRect(0.45, 0.58, 0.16, 0.14);

  // Cockpit, helmet and halo (a hoop round the driver with a strut to the front).
  ctx.fillStyle = '#0d0d0d';
  ctx.beginPath();
  ctx.ellipse(-0.1, 0, 0.5, 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = liv.helmet;
  ctx.beginPath();
  ctx.arc(-0.2, 0, 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b2b2b';
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.ellipse(-0.1, 0, 0.42, 0.24, 0, 0, Math.PI * 2);
  ctx.moveTo(0.32, 0);
  ctx.lineTo(0.55, 0);
  ctx.stroke();

  ctx.restore();
}

/** Bare carbon and scratches where the body took hits (inside the body outline). */
function drawBodyDamage(ctx: CanvasRenderingContext2D, dmg: CarParts): void {
  const patches = (list: [number, number, number, number, number][], d: number, flip: number) => {
    for (const [x, y, l, w, from] of list) {
      if (d < from) continue;
      // Ragged: a skewed quad rather than a neat rectangle.
      const yy = y * flip;
      ctx.beginPath();
      ctx.moveTo(x - l / 2, yy - w / 2);
      ctx.lineTo(x + l / 2 - w * 0.4, yy - w / 2);
      ctx.lineTo(x + l / 2, yy + w / 2);
      ctx.lineTo(x - l / 2 + w * 0.3, yy + w / 2);
      ctx.closePath();
      ctx.fill();
    }
  };
  ctx.fillStyle = CARBON;
  patches(SIDE_SCUFFS, dmg.right, 1);
  patches(SIDE_SCUFFS, dmg.left, -1);
  patches(NOSE_SCUFFS, dmg.frontWing, 1);
  patches(TAIL_SCUFFS, dmg.rearWing, 1);
  // Scratches along a damaged side.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const d = side > 0 ? dmg.right : dmg.left;
    if (d < 0.15) continue;
    ctx.moveTo(-1.5, side * 0.5);
    ctx.lineTo(-0.2, side * 0.58);
    if (d < 0.35) continue;
    ctx.moveTo(-1.1, side * 0.36);
    ctx.lineTo(0.3, side * 0.48);
  }
  ctx.stroke();
}

/**
 * Front wing, nose along +x, its front edge at x = hl (also drawn on its own as debris).
 * bend: damage (0-1), twisting it back on the `side` it was hit (+1 right) and, from 0.45,
 * knocking that endplate off.
 */
export function drawFrontWing(ctx: CanvasRenderingContext2D, liv: Livery, hl: number, hw: number, width: number, bend = 0, side = 1): void {
  const bent = bend >= SHOWS_FROM;
  ctx.save();
  if (bent) {
    ctx.translate(hl - 0.3, 0);
    ctx.rotate(side * bend * 0.22);
    ctx.translate(-(hl - 0.3), 0);
  }
  ctx.fillStyle = liv.wings;
  ctx.fillRect(hl - 0.42, -hw + 0.08, 0.2, width - 0.16);
  ctx.fillStyle = liv.endplates;
  ctx.fillRect(hl - 0.18, -hw + 0.12, 0.13, width - 0.24);
  if (!(bend > 0.45 && side < 0)) ctx.fillRect(hl - 0.5, -hw + 0.02, 0.48, 0.12);
  if (!(bend > 0.45 && side > 0)) ctx.fillRect(hl - 0.5, hw - 0.14, 0.48, 0.12);
  if (bent) {
    // A crack across the elements, near the damaged end.
    ctx.fillStyle = CARBON;
    ctx.fillRect(hl - 0.46, side * (hw - 0.45) - 0.04, 0.42, 0.08);
  }
  ctx.restore();
}

/** Rear wing, its back edge at x = back. bend: as for the front wing (endplate gone from 0.5). */
export function drawRearWing(ctx: CanvasRenderingContext2D, liv: Livery, back: number, bend = 0, side = 1): void {
  const bent = bend >= SHOWS_FROM;
  ctx.save();
  if (bent) {
    ctx.translate(back + 0.22, 0);
    ctx.rotate(-side * bend * 0.25);
    ctx.translate(-(back + 0.22), 0);
  }
  ctx.fillStyle = liv.wings;
  ctx.fillRect(back, -0.8, 0.45, 1.6);
  ctx.fillStyle = liv.endplates;
  if (!(bend > 0.5 && side < 0)) ctx.fillRect(back - 0.02, -0.92, 0.5, 0.14);
  if (!(bend > 0.5 && side > 0)) ctx.fillRect(back - 0.02, 0.78, 0.5, 0.14);
  if (bent) {
    ctx.fillStyle = CARBON;
    ctx.fillRect(back + 0.05, side * 0.45 - 0.04, 0.35, 0.08);
  }
  ctx.restore();
}
