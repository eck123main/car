import type { Car } from '../physics/car';
import type { Track } from '../track/track';

const GEAR_SPEEDS_KMH = [0, 85, 125, 160, 195, 230, 265, 300];

/** Draws in CSS pixels; expects ctx already scaled by devicePixelRatio. */
export function drawHud(ctx: CanvasRenderingContext2D, car: Car, trackName: string, width: number, height: number): void {
  const kmh = car.speed * 3.6;
  const gear = car.forwardSpeed < -0.5 ? 'R' : String(gearFor(kmh));

  // Speed / gear panel.
  const px = 20;
  const py = height - 150;
  panel(ctx, px, py, 230, 130);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(String(Math.round(kmh)), px + 130, py + 56);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.textAlign = 'left';
  ctx.fillText('km/h', px + 136, py + 56);
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillStyle = '#ffd400';
  ctx.textAlign = 'center';
  ctx.fillText(gear, px + 200, py + 56);

  bar(ctx, px + 14, py + 76, 200, 10, car.throttle, '#2ecc40', 'THR');
  bar(ctx, px + 14, py + 94, 200, 10, car.brake, '#ff4136', 'BRK');
  bar(ctx, px + 14, py + 112, 200, 10, car.damage, '#ff851b', 'DMG');

  // Surface warning.
  const off = [car.surfaceFront, car.surfaceRear].find((s) => s === 'gravel' || s === 'grass');
  if (off && !car.retired) {
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = off === 'gravel' ? '#e8c77a' : '#7fd36b';
    ctx.fillText(off.toUpperCase(), width / 2, 50);
  }

  if (car.retired) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, height / 2 - 60, width, 120);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4136';
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.fillText('DNF — CRASHED', width / 2, height / 2 + 4);
    ctx.fillStyle = '#ddd';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('Press R to reset', width / 2, height / 2 + 38);
  }

  ctx.textAlign = 'left';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`${trackName}    WASD / Arrows: drive    R: reset to track    C: camera mode`, 20, 28);
}

/** Small track map in the top-right corner. */
export class Minimap {
  private readonly path = new Path2D();
  private readonly scale: number;
  private readonly minX: number;
  private readonly minY: number;
  readonly size = 200;

  constructor(track: Track) {
    const xs = track.samples.map((s) => s.x);
    const ys = track.samples.map((s) => s.y);
    this.minX = Math.min(...xs);
    this.minY = Math.min(...ys);
    this.scale = (this.size - 20) / Math.max(Math.max(...xs) - this.minX, Math.max(...ys) - this.minY);
    track.samples.forEach((s, i) => {
      const [x, y] = this.toMap(s.x, s.y);
      if (i === 0) this.path.moveTo(x, y);
      else this.path.lineTo(x, y);
    });
    this.path.closePath();
  }

  private toMap(x: number, y: number): [number, number] {
    return [10 + (x - this.minX) * this.scale, 10 + (y - this.minY) * this.scale];
  }

  draw(ctx: CanvasRenderingContext2D, width: number, cars: Car[]): void {
    const ox = width - this.size - 20;
    const oy = 20;
    panel(ctx, ox, oy, this.size, this.size);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#999';
    ctx.lineJoin = 'round';
    ctx.stroke(this.path);
    for (const car of cars) {
      const [x, y] = this.toMap(car.x, car.y);
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
}

function gearFor(kmh: number): number {
  let g = 1;
  for (let i = 1; i < GEAR_SPEEDS_KMH.length; i++) if (kmh > GEAR_SPEEDS_KMH[i]) g = i + 1;
  return g;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(10,10,14,0.7)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, value: number, color: string, label: string): void {
  ctx.fillStyle = '#aaa';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y + h - 1);
  const bx = x + 32;
  const bw = w - 32;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, y, bw, h);
  ctx.fillStyle = color;
  ctx.fillRect(bx, y, bw * Math.max(0, Math.min(1, value)), h);
}
