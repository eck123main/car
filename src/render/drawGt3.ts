import { LOST_FRONT_WING, LOST_REAR_WING, LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR, type CarParts } from '../physics/car';
import type { CarParams } from '../physics/carParams';
import type { Livery } from './livery';

const CARBON = '#1b1b1b';
const TYRE = '#121212';
const GLASS = '#10151c';

/**
 * Top-down GT3 car, drawn in world metres, nose along +x, already translated and turned to the
 * car (see drawCar). A wide closed body with flared arches, the cabin glass, a big rear wing on
 * swan-neck mounts and a splitter. The livery maps onto it: `front` the bonnet, `pods` the
 * doors, `stripe` a racing stripe over bonnet and roof, `flash` a swoosh along each side.
 */
export function drawGt3Body(
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
  const fx = 1.42;
  const rx = -1.3;

  // Wheels: only their outer edge shows past the arches.
  const wheel = (wx: number, wy: number, angle: number) => {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(angle);
    ctx.fillStyle = TYRE;
    ctx.fillRect(-0.34, -0.17, 0.68, 0.34);
    ctx.restore();
  };
  if (!(lost & LOST_WHEEL_FL)) wheel(fx, -hw + 0.18, steer + toe(-1, true));
  if (!(lost & LOST_WHEEL_FR)) wheel(fx, hw - 0.18, steer + toe(1, true));
  if (!(lost & LOST_WHEEL_RL)) wheel(rx, -hw + 0.19, toe(-1, false));
  if (!(lost & LOST_WHEEL_RR)) wheel(rx, hw - 0.19, toe(1, false));

  // Splitter: a carbon lip sticking out under the front bumper.
  if (!(lost & LOST_FRONT_WING)) {
    ctx.fillStyle = CARBON;
    ctx.beginPath();
    ctx.roundRect(hl - 0.35, -hw + 0.08, 0.5, p.width - 0.16, 0.12);
    ctx.fill();
  }

  // Body: rounded nose, arches flared out over the wheels, pulled in at the doors.
  const body = new Path2D();
  const waist = hw - 0.11;
  body.moveTo(hl, -0.55);
  body.quadraticCurveTo(hl, -hw + 0.1, hl - 0.35, -hw + 0.06);
  body.lineTo(fx + 0.45, -hw);
  body.lineTo(fx - 0.5, -hw);
  body.quadraticCurveTo(fx - 0.75, -waist, fx - 0.95, -waist);
  body.lineTo(rx + 0.85, -waist);
  body.quadraticCurveTo(rx + 0.6, -hw, rx + 0.4, -hw);
  body.lineTo(rx - 0.55, -hw);
  body.quadraticCurveTo(-hl + 0.05, -hw + 0.05, -hl, -hw + 0.3);
  body.lineTo(-hl, hw - 0.3);
  body.quadraticCurveTo(-hl + 0.05, hw - 0.05, rx - 0.55, hw);
  body.lineTo(rx + 0.4, hw);
  body.quadraticCurveTo(rx + 0.6, hw, rx + 0.85, waist);
  body.lineTo(fx - 0.95, waist);
  body.quadraticCurveTo(fx - 0.75, waist, fx - 0.5, hw);
  body.lineTo(fx + 0.45, hw);
  body.lineTo(hl - 0.35, hw - 0.06);
  body.quadraticCurveTo(hl, hw - 0.1, hl, 0.55);
  body.closePath();
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = liv.body;
  ctx.fillRect(-hl, -hw, p.length, p.width);
  if (liv.front) {
    ctx.fillStyle = liv.front;
    ctx.fillRect(0.55, -hw, hl, p.width);
  }
  if (liv.pods) {
    ctx.fillStyle = liv.pods;
    ctx.fillRect(-1.0, -hw, 1.55, 0.3);
    ctx.fillRect(-1.0, hw - 0.3, 1.55, 0.3);
  }
  if (liv.flash) {
    ctx.fillStyle = liv.flash;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(1.9, side * (hw - 0.02));
      ctx.lineTo(-1.9, side * (hw - 0.02));
      ctx.lineTo(-1.9, side * (hw - 0.2));
      ctx.lineTo(1.4, side * (hw - 0.12));
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
    ctx.fillRect(-hl, -0.24, p.length, 0.14);
    ctx.fillRect(-hl, 0.1, p.length, 0.14);
  }
  if (liv.shine) {
    const g = ctx.createLinearGradient(-1.2, -hw, 0.4, hw);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-hl, -hw, p.length, p.width);
  }
  // Nose: the bumper in the nose colour.
  ctx.fillStyle = liv.nose;
  ctx.fillRect(hl - 0.3, -hw, 0.3, p.width);
  if (dmg) {
    // The F1 car's patches, stretched out to the wider body.
    ctx.save();
    ctx.scale(0.85, 1.65);
    drawDamage(dmg);
    ctx.restore();
  }
  ctx.restore();

  // Headlights at the front corners, tail lights across the back.
  ctx.fillStyle = '#f4f1d8';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hl - 0.28, side * (hw - 0.3), 0.12, 0.2, side * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#b3121b';
  ctx.fillRect(-hl, -hw + 0.22, 0.07, p.width - 0.44);

  // Bonnet vents over the radiator and louvres on the front arches.
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  for (const side of [-1, 1]) {
    ctx.fillRect(1.15, side * 0.32 - 0.12, 0.42, 0.24);
    for (let i = 0; i < 4; i++) ctx.fillRect(fx - 0.25 + i * 0.13, side * (hw - 0.3) - 0.11, 0.05, 0.22);
  }

  // Cabin: windscreen, roof (with a number panel and the intake), rear window.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(0.7, -0.66);
  ctx.lineTo(0.7, 0.66);
  ctx.lineTo(-0.1, 0.72);
  ctx.lineTo(-0.1, -0.72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-1.15, -0.72, 1.05, 1.44);
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(-0.95, -0.3, 0.6, 0.6);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(-0.32, -0.1, 0.16, 0.2);
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(-1.15, -0.7);
  ctx.lineTo(-1.15, 0.7);
  ctx.lineTo(-1.75, 0.55);
  ctx.lineTo(-1.75, -0.55);
  ctx.closePath();
  ctx.fill();

  // Door mirrors.
  ctx.fillStyle = liv.body;
  ctx.fillRect(0.38, -hw - 0.1, 0.18, 0.2);
  ctx.fillRect(0.38, hw - 0.1, 0.18, 0.2);

  // Rear wing on swan-neck mounts, overhanging the tail.
  if (lost & LOST_REAR_WING) {
    ctx.fillStyle = CARBON;
    ctx.fillRect(-2.2, -0.42, 0.16, 0.1);
    ctx.fillRect(-2.2, 0.32, 0.16, 0.1);
  } else {
    const bend = dmg?.rearWing ?? 0;
    const side = dmg && dmg.left > dmg.right ? -1 : 1;
    ctx.save();
    if (bend >= 0.08) {
      ctx.translate(-2.2, 0);
      ctx.rotate(-side * bend * 0.2);
      ctx.translate(2.2, 0);
    }
    ctx.fillStyle = CARBON;
    ctx.fillRect(-2.25, -0.42, 0.3, 0.1);
    ctx.fillRect(-2.25, 0.32, 0.3, 0.1);
    ctx.fillStyle = liv.wings;
    ctx.fillRect(-2.55, -0.95, 0.42, 1.9);
    ctx.fillStyle = liv.endplates;
    if (!(bend > 0.5 && side < 0)) ctx.fillRect(-2.6, -1.0, 0.55, 0.1);
    if (!(bend > 0.5 && side > 0)) ctx.fillRect(-2.6, 0.9, 0.55, 0.1);
    ctx.restore();
  }

  if (rainLight) {
    ctx.fillStyle = 'rgba(255, 30, 30, 0.45)';
    ctx.fillRect(-hl - 0.5, -0.3, 0.5, 0.6);
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(-hl - 0.1, -0.12, 0.12, 0.24);
  }
}
