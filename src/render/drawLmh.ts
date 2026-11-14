import { LOST_FRONT_WING, LOST_REAR_WING, LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR, type CarParts } from '../physics/car';
import type { CarParams } from '../physics/carParams';
import { accentOf, type Livery } from './livery';

const CARBON = '#1b1b1b';
const TYRE = '#121212';
const GLASS = '#10151c';

/**
 * Top-down Le Mans Hypercar, drawn in world metres, nose along +x, already translated and turned
 * to the car (see drawCar). A long low prototype: front and rear fenders standing out over the
 * wheels with louvres cut in the tops, a low nose between the front fenders, a narrow bubble
 * canopy, the shark fin down the engine cover to a full-width rear wing. The livery maps as on
 * the GT3: `front` the nose and front fenders, `pods` the rear fenders, `stripe` twin stripes
 * over the canopy and fin, `flash` a swoosh down each side.
 */
export function drawLmhBody(
  ctx: CanvasRenderingContext2D,
  p: CarParams,
  steer: number,
  liv: Livery,
  lost: number,
  dmg: CarParts | undefined,
  toe: (side: number, front: boolean) => number,
  drawDamage: (dmg: CarParts) => void,
  rainLight: boolean,
): void {
  const hl = p.length / 2;
  const hw = p.width / 2;
  const fx = p.cgToFront;
  const rx = -p.cgToRear;
  const tail = -hl + 0.2;
  const accent = accentOf(liv);

  // Wheels: only their outer edge shows past the fenders.
  const wheel = (wx: number, wy: number, angle: number) => {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(angle);
    ctx.fillStyle = TYRE;
    ctx.fillRect(-0.36, -0.17, 0.72, 0.34);
    ctx.restore();
  };
  if (!(lost & LOST_WHEEL_FL)) wheel(fx, -hw + 0.18, steer + toe(-1, true));
  if (!(lost & LOST_WHEEL_FR)) wheel(fx, hw - 0.18, steer + toe(1, true));
  if (!(lost & LOST_WHEEL_RL)) wheel(rx, -hw + 0.19, toe(-1, false));
  if (!(lost & LOST_WHEEL_RR)) wheel(rx, hw - 0.19, toe(1, false));

  // Splitter: a wide carbon blade under the nose, its endplates out at the fender corners.
  if (!(lost & LOST_FRONT_WING)) {
    ctx.fillStyle = CARBON;
    ctx.beginPath();
    ctx.roundRect(hl - 0.42, -hw + 0.04, 0.5, p.width - 0.08, 0.1);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(hl + 0.02, -hw + 0.1, 0.05, p.width - 0.2);
  }

  // Body: fenders out to full width over each axle, pulled in at the sides between them, a
  // rounded nose and a squared-off tail.
  const waist = hw - 0.32;
  const body = new Path2D();
  body.moveTo(hl - 0.05, -0.45);
  body.quadraticCurveTo(hl, -hw + 0.05, hl - 0.4, -hw + 0.02);
  body.lineTo(fx - 0.55, -hw);
  body.quadraticCurveTo(fx - 0.85, -hw, fx - 1.0, -waist);
  body.lineTo(rx + 1.0, -waist);
  body.quadraticCurveTo(rx + 0.8, -hw, rx + 0.5, -hw);
  body.lineTo(tail + 0.25, -hw);
  body.quadraticCurveTo(tail, -hw, tail, -hw + 0.25);
  body.lineTo(tail, hw - 0.25);
  body.quadraticCurveTo(tail, hw, tail + 0.25, hw);
  body.lineTo(rx + 0.5, hw);
  body.quadraticCurveTo(rx + 0.8, hw, rx + 1.0, waist);
  body.lineTo(fx - 1.0, waist);
  body.quadraticCurveTo(fx - 0.85, hw, fx - 0.55, hw);
  body.lineTo(hl - 0.4, hw - 0.02);
  body.quadraticCurveTo(hl, hw - 0.05, hl - 0.05, 0.45);
  body.closePath();
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = liv.body;
  ctx.fillRect(-hl, -hw, p.length, p.width);
  // Front and rear in their own colours, split in chevrons with an accent line.
  const chevron = (color: string, edge: number, tip: number, end: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(edge, -hw);
    ctx.lineTo(end, -hw);
    ctx.lineTo(end, hw);
    ctx.lineTo(edge, hw);
    ctx.lineTo(tip, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(edge, -hw);
    ctx.lineTo(tip, 0);
    ctx.lineTo(edge, hw);
    ctx.stroke();
  };
  if (liv.front && liv.front.toLowerCase() !== liv.body.toLowerCase()) chevron(liv.front, 0.75, 1.15, hl);
  if (liv.pods && liv.pods.toLowerCase() !== liv.body.toLowerCase()) chevron(liv.pods, -0.55, -1.0, -hl);
  if (liv.flash) {
    ctx.fillStyle = liv.flash;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(2.0, side * (hw - 0.02));
      ctx.lineTo(-2.1, side * (hw - 0.02));
      ctx.lineTo(-2.1, side * (hw - 0.2));
      ctx.lineTo(1.5, side * (hw - 0.12));
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
    ctx.fillRect(-hl, -0.22, p.length, 0.12);
    ctx.fillRect(-hl, 0.1, p.length, 0.12);
  }
  if (liv.shine) {
    const g = ctx.createLinearGradient(-1.2, -hw, 0.4, hw);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-hl, -hw, p.length, p.width);
  }
  // The low nose between the front fenders sits in shadow; its tip in the nose colour.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.moveTo(hl, -0.42);
  ctx.lineTo(0.95, -0.36);
  ctx.lineTo(0.95, 0.36);
  ctx.lineTo(hl, 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = liv.nose;
  ctx.fillRect(hl - 0.28, -0.4, 0.28, 0.8);
  // Shading down the sides between the fenders (the body drops away there).
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(rx + 0.9, -hw, fx - rx - 1.8, 0.38);
  ctx.fillRect(rx + 0.9, hw - 0.38, fx - rx - 1.8, 0.38);
  if (dmg) {
    // The F1 car's patches, stretched out to the wider body.
    ctx.save();
    ctx.scale(0.9, 1.6);
    drawDamage(dmg);
    ctx.restore();
  }
  ctx.restore();

  // Louvres cut in the top of each front fender (the wheel shows through), slim headlights
  // at their front, and the light bar across the tail.
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#060607';
    for (let i = 0; i < 5; i++) ctx.fillRect(fx - 0.38 + i * 0.16, side * (hw - 0.36) - 0.16, 0.07, 0.32);
    ctx.fillStyle = '#0d0d10';
    ctx.fillRect(hl - 0.5, side * (hw - 0.42) - 0.13, 0.36, 0.26);
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(hl - 0.44, side * (hw - 0.42) - 0.1, 0.06, 0.2);
    ctx.fillRect(hl - 0.34, side * (hw - 0.42) - 0.1, 0.06, 0.2);
  }
  ctx.fillStyle = '#c00c14';
  ctx.fillRect(tail - 0.02, -hw + 0.1, 0.06, p.width - 0.2);

  // Canopy: a narrow bubble, windscreen forward, a dark roof hatch, the roof intake.
  const cf = 0.85;
  const cr = -0.75;
  ctx.fillStyle = liv.body;
  ctx.beginPath();
  ctx.ellipse((cf + cr) / 2, 0, (cf - cr) / 2, 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 0.05;
  ctx.stroke();
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(cf, -0.12);
  ctx.quadraticCurveTo(cf, -0.5, 0.25, -0.53);
  ctx.lineTo(0.25, 0.53);
  ctx.quadraticCurveTo(cf, 0.5, cf, 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-0.45, -0.42, 0.7, 0.84);
  // The number on the roof, and the snorkel intake behind it.
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.roundRect(-0.35, -0.24, 0.42, 0.48, 0.08);
  ctx.fill();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(-0.2, -0.1, 0.12, 0.2);
  ctx.fillRect(-0.72, -0.14, 0.26, 0.28);
  // Mirrors on stalks out at the front fenders.
  ctx.fillStyle = liv.body;
  ctx.fillRect(0.55, -hw + 0.12, 0.2, 0.2);
  ctx.fillRect(0.55, hw - 0.32, 0.2, 0.2);

  // Shark fin from the roof to the wing: dark, with the accent along its top edge.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(tail - 0.1, -0.07, -0.65 - tail, 0.14);
  ctx.fillStyle = accent;
  ctx.fillRect(tail - 0.1, -0.025, -0.65 - tail, 0.05);
  // Engine cover vents either side of the fin.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) ctx.fillRect(-1.0 - i * 0.18, side * 0.32 - 0.1, 0.08, 0.2);
  }

  // Rear wing: one wide element between big endplates, over the tail.
  if (lost & LOST_REAR_WING) {
    ctx.fillStyle = CARBON;
    ctx.fillRect(tail - 0.05, -0.08, 0.18, 0.16);
  } else {
    const bend = dmg?.rearWing ?? 0;
    const side = dmg && dmg.left > dmg.right ? -1 : 1;
    ctx.save();
    if (bend >= 0.08) {
      ctx.translate(tail, 0);
      ctx.rotate(-side * bend * 0.2);
      ctx.translate(-tail, 0);
    }
    ctx.fillStyle = liv.wings;
    ctx.fillRect(-hl, -hw + 0.06, 0.4, p.width - 0.12);
    ctx.fillStyle = accent;
    ctx.fillRect(-hl - 0.04, -hw + 0.06, 0.05, p.width - 0.12);
    ctx.fillStyle = liv.endplates;
    if (!(bend > 0.5 && side < 0)) ctx.fillRect(-hl - 0.05, -hw, 0.75, 0.1);
    if (!(bend > 0.5 && side > 0)) ctx.fillRect(-hl - 0.05, hw - 0.1, 0.75, 0.1);
    ctx.restore();
  }

  if (rainLight) {
    ctx.fillStyle = 'rgba(255, 30, 30, 0.45)';
    ctx.fillRect(-hl - 0.5, -0.3, 0.5, 0.6);
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(-hl - 0.1, -0.12, 0.12, 0.24);
  }
}
