import { LOST_FRONT_WING, LOST_REAR_WING, LOST_WHEEL_FL, LOST_WHEEL_FR, LOST_WHEEL_RL, LOST_WHEEL_RR, type CarParts } from '../physics/car';
import type { CarParams } from '../physics/carParams';
import { accentOf, type Livery } from './livery';

const CARBON = '#1b1b1b';
const TYRE = '#121212';
const GLASS = '#10151c';
/** Deep-dish wheels in gold, the drift scene's favourite. */
export const DRIFT_RIM = '#c9a23a';

/**
 * Top-down pro drift car (Formula Drift style), drawn in world metres, nose along +x, already
 * translated and turned to the car (see drawCar). A long-bonnet coupe with bolt-on carbon
 * overfenders (riveted) sticking out over fat tyres, a big heat extractor in the bonnet, the
 * intercooler showing through the front lip, louvres over the rear window and a tall wing with
 * big square endplates. The livery is a bold slash over the bonnet and a torn edge over the rear
 * quarters, in the livery's front / pods colours with its accent along the edges.
 */
export function drawDriftBody(
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
  const accent = accentOf(liv);
  // The body proper is narrower than the car: the fenders carry it out to full width.
  const bw = hw - 0.2;

  // Fat tyres with gold rims, poking out under the fenders (the fronts turned well over).
  const wheel = (wx: number, wy: number, angle: number, wide: number) => {
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(angle);
    ctx.fillStyle = TYRE;
    ctx.fillRect(-0.34, -wide / 2, 0.68, wide);
    ctx.fillStyle = DRIFT_RIM;
    ctx.fillRect(-0.2, Math.sign(wy) * (wide / 2 - 0.05) - 0.03, 0.4, 0.06);
    ctx.restore();
  };
  if (!(lost & LOST_WHEEL_FL)) wheel(fx, -hw + 0.2, steer * 1.3 + toe(-1, true), 0.32);
  if (!(lost & LOST_WHEEL_FR)) wheel(fx, hw - 0.2, steer * 1.3 + toe(1, true), 0.32);
  if (!(lost & LOST_WHEEL_RL)) wheel(rx, -hw + 0.21, toe(-1, false), 0.38);
  if (!(lost & LOST_WHEEL_RR)) wheel(rx, hw - 0.21, toe(1, false), 0.38);

  // Front lip: a deep flat carbon lip, the accent along its edge.
  if (!(lost & LOST_FRONT_WING)) {
    ctx.fillStyle = CARBON;
    ctx.beginPath();
    ctx.roundRect(hl - 0.3, -bw - 0.02, 0.42, 2 * bw + 0.04, 0.08);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(hl + 0.06, -bw + 0.05, 0.05, 2 * bw - 0.1);
  }

  // Body: a long bonnet with a square-ish nose, straight sides, a short tail.
  const body = new Path2D();
  body.moveTo(hl, -bw + 0.25);
  body.quadraticCurveTo(hl, -bw, hl - 0.25, -bw);
  body.lineTo(-hl + 0.2, -bw);
  body.quadraticCurveTo(-hl, -bw, -hl, -bw + 0.2);
  body.lineTo(-hl, bw - 0.2);
  body.quadraticCurveTo(-hl, bw, -hl + 0.2, bw);
  body.lineTo(hl - 0.25, bw);
  body.quadraticCurveTo(hl, bw, hl, bw - 0.25);
  body.closePath();
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = liv.body;
  ctx.fillRect(-hl, -hw, p.length, p.width);
  // The slash: a wide band raked across the bonnet, accent lines on both edges.
  const slash = (color: string, x0: number, x1: number, rake: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x0 + rake, -hw);
    ctx.lineTo(x1 + rake, -hw);
    ctx.lineTo(x1 - rake, hw);
    ctx.lineTo(x0 - rake, hw);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(x0 + rake, -hw);
    ctx.lineTo(x0 - rake, hw);
    ctx.moveTo(x1 + rake, -hw);
    ctx.lineTo(x1 - rake, hw);
    ctx.stroke();
  };
  const front = liv.front && liv.front.toLowerCase() !== liv.body.toLowerCase() ? liv.front : accent;
  slash(front, 1.0, 1.55, 0.35);
  // The torn edge over the rear quarters: a zigzag from the doors back.
  const tail = liv.pods && liv.pods.toLowerCase() !== liv.body.toLowerCase() ? liv.pods : null;
  if (tail) {
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(-hl, -hw);
    ctx.lineTo(-0.7, -hw);
    const teeth = 7;
    for (let i = 0; i <= teeth; i++) {
      const y = -hw + (p.width * i) / teeth;
      ctx.lineTo(i % 2 ? -1.15 : -0.85 - (i % 3) * 0.08, y);
    }
    ctx.lineTo(-hl, hw);
    ctx.closePath();
    ctx.fill();
  }
  if (liv.checks) {
    ctx.fillStyle = liv.checks;
    const sq = 0.3;
    for (let i = 0; i * sq < 1.4; i++) {
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
  ctx.fillStyle = liv.nose;
  ctx.fillRect(hl - 0.22, -hw, 0.22, p.width);
  if (dmg) {
    ctx.save();
    ctx.scale(0.85, 1.55);
    drawDamage(dmg);
    ctx.restore();
  }
  ctx.restore();

  // The intercooler behind the open grille: silver fins across the nose.
  ctx.fillStyle = '#9da2aa';
  ctx.fillRect(hl - 0.2, -0.55, 0.12, 1.1);
  ctx.fillStyle = '#5d6168';
  for (let y = -0.5; y < 0.5; y += 0.1) ctx.fillRect(hl - 0.2, y, 0.12, 0.03);
  // Red tow hook off the lip.
  ctx.fillStyle = '#e3141c';
  ctx.fillRect(hl + 0.02, 0.62, 0.22, 0.07);

  // Pop-up-style headlights: dark lenses on the nose corners.
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#0d0d10';
    ctx.fillRect(hl - 0.5, side * (bw - 0.32) - 0.14, 0.28, 0.28);
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(hl - 0.44, side * (bw - 0.32) - 0.08, 0.16, 0.16);
  }
  // Tail lights.
  ctx.fillStyle = '#c00c14';
  ctx.fillRect(-hl, -bw + 0.08, 0.07, 0.4);
  ctx.fillRect(-hl, bw - 0.48, 0.07, 0.4);

  // Bonnet: the big heat extractor in the middle, with slats, and four bonnet pins.
  ctx.fillStyle = '#16171b';
  ctx.beginPath();
  ctx.roundRect(0.95, -0.42, 0.8, 0.84, 0.06);
  ctx.fill();
  ctx.fillStyle = '#050506';
  for (let i = 0; i < 6; i++) ctx.fillRect(1.0 + i * 0.12, -0.38, 0.05, 0.76);
  ctx.fillStyle = '#c4c7cc';
  for (const [x, y] of [[0.78, 0.6], [2.0, 0.55]]) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x, s * y, 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Bolt-on overfenders: carbon boxes out to the full width, riveted along the outside.
  const fender = (cx: number, side: number, len: number) => {
    ctx.fillStyle = CARBON;
    ctx.beginPath();
    ctx.moveTo(cx + len / 2 + 0.22, side * (bw - 0.02));
    ctx.lineTo(cx + len / 2, side * (hw + 0.03));
    ctx.lineTo(cx - len / 2, side * (hw + 0.03));
    ctx.lineTo(cx - len / 2 - 0.22, side * (bw - 0.02));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(cx - len / 2, side * (hw + 0.03) - 0.03, len, 0.06);
    ctx.fillStyle = '#c4c7cc';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(cx - len / 2 + 0.05 + ((len - 0.1) * i) / 4, side * (hw - 0.06), 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  for (const side of [-1, 1]) {
    fender(fx, side, 1.0);
    fender(rx, side, 1.1);
  }
  // Side-exit exhaust on the right, just ahead of the rear wheel.
  ctx.fillStyle = '#6d6f75';
  ctx.fillRect(rx + 0.58, bw - 0.02, 0.1, 0.16);
  ctx.fillRect(rx + 0.72, bw - 0.02, 0.1, 0.16);

  // Cabin: windscreen, the roof with a number roundel and a scoop, louvres over the rear window.
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(0.62, -0.64);
  ctx.lineTo(0.62, 0.64);
  ctx.lineTo(-0.1, 0.7);
  ctx.lineTo(-0.1, -0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(-1.1, -0.7, 1.0, 1.4);
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.arc(-0.62, 0, 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 0.06;
  ctx.stroke();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(-0.72, -0.12, 0.18, 0.24);
  ctx.fillRect(-0.32, -0.14, 0.24, 0.28);
  ctx.fillStyle = GLASS;
  ctx.beginPath();
  ctx.moveTo(-1.1, -0.68);
  ctx.lineTo(-1.1, 0.68);
  ctx.lineTo(-1.6, 0.56);
  ctx.lineTo(-1.6, -0.56);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = CARBON;
  for (let i = 0; i < 5; i++) ctx.fillRect(-1.18 - i * 0.09, -0.6 + i * 0.015, 0.05, 1.2 - i * 0.03);

  // Door mirrors.
  ctx.fillStyle = liv.body;
  ctx.fillRect(0.4, -bw - 0.1, 0.16, 0.18);
  ctx.fillRect(0.4, bw - 0.08, 0.16, 0.18);

  // The wing: tall straight uprights off the boot, a wide plane and big square endplates.
  if (lost & LOST_REAR_WING) {
    ctx.fillStyle = CARBON;
    ctx.fillRect(-2.1, -0.4, 0.14, 0.08);
    ctx.fillRect(-2.1, 0.32, 0.14, 0.08);
  } else {
    const bend = dmg?.rearWing ?? 0;
    const side = dmg && dmg.left > dmg.right ? -1 : 1;
    ctx.save();
    if (bend >= 0.08) {
      ctx.translate(-2.2, 0);
      ctx.rotate(-side * bend * 0.2);
      ctx.translate(2.2, 0);
    }
    ctx.fillStyle = liv.wings;
    ctx.fillRect(-2.6, -1.0, 0.5, 2.0);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-2.6, -1.0, 0.12, 2.0);
    ctx.fillStyle = accent;
    ctx.fillRect(-2.65, -1.0, 0.05, 2.0);
    ctx.fillStyle = CARBON;
    ctx.fillRect(-2.2, -0.4, 0.14, 0.08);
    ctx.fillRect(-2.2, 0.32, 0.14, 0.08);
    ctx.fillStyle = liv.endplates;
    if (!(bend > 0.5 && side < 0)) ctx.fillRect(-2.7, -1.08, 0.7, 0.1);
    if (!(bend > 0.5 && side > 0)) ctx.fillRect(-2.7, 0.98, 0.7, 0.1);
    ctx.restore();
  }

  if (rainLight) {
    ctx.fillStyle = 'rgba(255, 30, 30, 0.45)';
    ctx.fillRect(-hl - 0.5, -0.3, 0.5, 0.6);
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(-hl - 0.1, -0.12, 0.12, 0.24);
  }
}
