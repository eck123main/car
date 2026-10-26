import { COMPOUNDS, type Compound } from '../sim/tyres';
import { WHEEL_X, WHEEL_Y, type PitScene } from './pitStops';

/** Pit stops from above (see pitStops.ts), drawn in world metres. */

const HELMET = '#f2f2f2';
const TYRE = '#141414';

/** Under the cars: the shadow of a car up on its jacks, rubber laid on release. */
export function drawPitUnder(ctx: CanvasRenderingContext2D, scene: PitScene, poses: ReadonlyMap<string, { x: number; y: number; heading: number }>): void {
  for (const [id, lift] of scene.lift) {
    const p = poses.get(id);
    if (!p || lift <= 0) continue;
    ctx.save();
    ctx.translate(p.x + 0.35 * lift, p.y + 0.35 * lift);
    ctx.rotate(p.heading);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * lift})`;
    roundRect(ctx, -2.9, -1.05, 5.8, 2.1, 0.8);
    ctx.fill();
    ctx.restore();
  }
  ctx.lineWidth = 0.38;
  ctx.lineCap = 'round';
  for (const m of scene.rubber) {
    ctx.strokeStyle = `rgba(10,10,10,${0.55 * m.alpha})`;
    ctx.beginPath();
    ctx.moveTo(m.x0, m.y0);
    ctx.lineTo(m.x1, m.y1);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Over the cars: new tyres on, jacks, the crews, wheel guns, lights and release smoke. */
export function drawPitOver(ctx: CanvasRenderingContext2D, scene: PitScene, poses: ReadonlyMap<string, { x: number; y: number; heading: number }>): void {
  for (const [id, compound] of scene.fitted) {
    const p = poses.get(id);
    if (!p) continue;
    // New tyres on: their sidewalls show the new compound before the car even leaves.
    for (const [a, o] of [[WHEEL_X.front, -WHEEL_Y], [WHEEL_X.front, WHEEL_Y], [WHEEL_X.rear, -WHEEL_Y], [WHEEL_X.rear, WHEEL_Y]]) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.heading);
      ctx.translate(a, o);
      ctx.fillStyle = TYRE;
      ctx.fillRect(-0.36, -0.2, 0.72, 0.4);
      ctx.fillStyle = COMPOUNDS[compound].color;
      ctx.fillRect(-0.3, -0.2, 0.6, 0.09);
      ctx.fillRect(-0.3, 0.11, 0.6, 0.09);
      ctx.restore();
    }
  }
  ctx.strokeStyle = '#c9c9c9';
  ctx.lineWidth = 0.18;
  for (const j of scene.jacks) {
    const dx = Math.cos(j.heading) * 0.3;
    const dy = Math.sin(j.heading) * 0.3;
    ctx.beginPath();
    ctx.moveTo(j.x - dx, j.y - dy);
    ctx.lineTo(j.x + dx, j.y + dy);
    ctx.stroke();
  }
  for (const m of scene.crew) drawPerson(ctx, m.x, m.y, m.heading, m.color, m.tyre);
  ctx.fillStyle = '#ffe680';
  for (const s of scene.sparks) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, 0.24, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const l of scene.lights) {
    ctx.fillStyle = '#111';
    ctx.fillRect(l.x - 0.45, l.y - 0.45, 0.9, 0.9);
    ctx.fillStyle = l.state === 'green' ? '#2ecc40' : l.state === 'red' ? '#ff2a1f' : '#553333';
    ctx.beginPath();
    ctx.arc(l.x, l.y, 0.3, 0, Math.PI * 2);
    ctx.fill();
    if (l.state !== 'off') {
      ctx.fillStyle = l.state === 'green' ? 'rgba(46,204,64,0.25)' : 'rgba(255,42,31,0.25)';
      ctx.beginPath();
      ctx.arc(l.x, l.y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const s of scene.smoke) {
    ctx.fillStyle = `rgba(225,225,225,${0.45 * s.alpha})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A crew member from above: shoulders in the team colour, a white helmet, maybe a tyre. */
function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, facing: number, color: string, tyre: Compound | null): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(facing);
  // Drawn a little larger than life, so they read at race zoom.
  ctx.scale(1.4, 1.4);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.22, 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 0.07;
  ctx.stroke();
  ctx.fillStyle = HELMET;
  ctx.beginPath();
  ctx.arc(0.02, 0, 0.15, 0, Math.PI * 2);
  ctx.fill();
  if (tyre) {
    // Held out in front.
    ctx.fillStyle = TYRE;
    ctx.beginPath();
    ctx.arc(0.5, 0, 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COMPOUNDS[tyre].color;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.arc(0.5, 0, 0.22, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
