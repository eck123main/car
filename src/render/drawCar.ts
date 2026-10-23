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
}

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
  wheel(p.cgToFront, -hw + 0.2, steer);
  wheel(p.cgToFront, hw - 0.2, steer);
  wheel(-p.cgToRear, -hw + 0.22, 0);
  wheel(-p.cgToRear, hw - 0.22, 0);
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
  ctx.restore();

  // Sidepod inlets.
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0.2, -0.58, 0.2, 0.26);
  ctx.fillRect(0.2, 0.32, 0.2, 0.26);
  // Engine cover fin.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-2.25, -0.05, 1.7, 0.1);

  // Front wing: two elements and endplates.
  ctx.fillStyle = liv.wings;
  ctx.fillRect(hl - 0.42, -hw + 0.08, 0.2, p.width - 0.16);
  ctx.fillStyle = liv.endplates;
  ctx.fillRect(hl - 0.18, -hw + 0.12, 0.13, p.width - 0.24);
  ctx.fillRect(hl - 0.5, -hw + 0.02, 0.48, 0.12);
  ctx.fillRect(hl - 0.5, hw - 0.14, 0.48, 0.12);

  // Rear wing: mainplane and endplates; the whole wing lights up green with DRS open.
  if (look.drsOpen) {
    ctx.fillStyle = 'rgba(46, 204, 64, 0.35)';
    ctx.fillRect(-hl - 0.9, -0.85, 0.9, 1.7);
    ctx.fillStyle = '#39ff5a';
    ctx.fillRect(-hl - 0.1, -0.95, 0.6, 1.9);
  } else {
    ctx.fillStyle = liv.wings;
    ctx.fillRect(-hl, -0.8, 0.45, 1.6);
    ctx.fillStyle = liv.endplates;
    ctx.fillRect(-hl - 0.02, -0.92, 0.5, 0.14);
    ctx.fillRect(-hl - 0.02, 0.78, 0.5, 0.14);
  }

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
