import type { Car } from '../physics/car';
import type { Track } from '../track/track';
import { SECTOR_COUNT, type LapTimer } from '../game/lapTimer';
import { COMPOUNDS } from '../sim/tyres';
import type { PitAdvice } from '../sim/strategy';
import type { Racer } from '../sim/world';

/** Side of the minimap square (CSS px); the damage panel sits under it. */
export const MINIMAP_SIZE = 260;

const GEAR_SPEEDS_KMH = [0, 85, 125, 160, 195, 230, 265, 300];

/** Draws in CSS pixels; expects ctx already scaled by devicePixelRatio. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  car: Car,
  trackName: string,
  width: number,
  height: number,
  resetHint: string,
  /** Seconds until a reset car goes back on track, if it is waiting. */
  recovering: number | null = null,
): void {
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
    ctx.fillText(off.toUpperCase(), width / 2, 108);
  }

  if (recovering !== null) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, height / 2 - 50, width, 100);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd400';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillText(`RECOVERING  ${Math.max(0, recovering).toFixed(1)} s`, width / 2, height / 2 + 14);
  } else if (car.retired) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, height / 2 - 60, width, 120);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4136';
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.fillText('CRASHED OUT', width / 2, height / 2 + 4);
    ctx.fillStyle = '#ddd';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(resetHint, width / 2, height / 2 + 38);
  }

  ctx.textAlign = 'left';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`${trackName}    WASD/Arrows drive · Space DRS · Shift ERS · P pit limiter · 1-5 next tyres · R reset`, 20, 28);
}

/** Small track map in the top-right corner. */
export class Minimap {
  private readonly path = new Path2D();
  private readonly scale: number;
  private readonly minX: number;
  private readonly minY: number;
  readonly size = MINIMAP_SIZE;

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

  draw(ctx: CanvasRenderingContext2D, width: number, cars: { x: number; y: number; color: string }[]): void {
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

export function formatLapTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

const SECTOR_COLORS = { best: '#b84dff', slower: '#ffd400', pending: 'rgba(255,255,255,0.15)' };

/** Lap / sector timing panel, top left. `delta` is the live gap to the best lap, if known. */
export function drawTiming(ctx: CanvasRenderingContext2D, timer: LapTimer, now: number, delta: number | null): void {
  const x = 20;
  const y = 44;
  const w = 250;
  panel(ctx, x, y, w, 132);
  ctx.textAlign = 'left';

  const current = timer.currentTime(now);
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText(current === null ? 'OUT LAP' : `LAP ${timer.lapsCompleted + 1}`, x + 14, y + 22);
  if (current !== null && !timer.valid) {
    ctx.fillStyle = '#ff4136';
    ctx.fillText('LAP DELETED', x + 80, y + 22);
  }

  ctx.font = 'bold 28px ui-monospace, monospace';
  ctx.fillStyle = current !== null && !timer.valid ? '#888' : '#fff';
  ctx.fillText(current === null ? '-:--.---' : formatLapTime(current), x + 14, y + 54);

  const shownDelta = timer.valid ? delta : null;
  if (shownDelta !== null) {
    ctx.font = 'bold 16px ui-monospace, monospace';
    ctx.fillStyle = shownDelta <= 0 ? '#2ecc40' : '#ff4136';
    ctx.textAlign = 'right';
    ctx.fillText(`${shownDelta <= 0 ? '-' : '+'}${Math.abs(shownDelta).toFixed(3)}`, x + w - 14, y + 54);
    ctx.textAlign = 'left';
  }

  // Sector bars: purple = personal best, yellow = slower.
  const barW = (w - 28 - 2 * 6) / SECTOR_COUNT;
  for (let i = 0; i < SECTOR_COUNT; i++) {
    const t = timer.sectors[i];
    const best = timer.bestSectors[i];
    let color = SECTOR_COLORS.pending;
    if (t !== undefined) color = !timer.valid ? '#666' : best === null || t <= best ? SECTOR_COLORS.best : SECTOR_COLORS.slower;
    ctx.fillStyle = color;
    ctx.fillRect(x + 14 + i * (barW + 6), y + 64, barW, 6);
  }

  ctx.font = '13px ui-monospace, monospace';
  ctx.fillStyle = '#aaa';
  ctx.fillText('LAST', x + 14, y + 92);
  ctx.fillText('BEST', x + 14, y + 112);
  ctx.fillStyle = '#fff';
  const last = timer.lastLap;
  ctx.fillText(last ? formatLapTime(last.time) + (last.valid ? '' : '  deleted') : '-', x + 60, y + 92);
  ctx.fillStyle = SECTOR_COLORS.best;
  ctx.fillText(timer.bestLap ? formatLapTime(timer.bestLap.time) : '-', x + 60, y + 112);
  if (timer.trackLimitWarnings > 0) {
    ctx.fillStyle = '#ffb347';
    ctx.textAlign = 'right';
    ctx.fillText(`Track limits: ${timer.trackLimitWarnings}`, x + w - 14, y + 112);
    ctx.textAlign = 'left';
  }
}

export interface Toast {
  text: string;
  color: string;
  until: number;
}

/** Short messages in the top middle (lap times, track limits). */
export function drawToasts(ctx: CanvasRenderingContext2D, toasts: Toast[], now: number, width: number): void {
  let y = 150;
  ctx.textAlign = 'center';
  ctx.font = 'bold 20px system-ui, sans-serif';
  for (const t of toasts) {
    if (t.until < now) continue;
    const tw = ctx.measureText(t.text).width + 32;
    panel(ctx, width / 2 - tw / 2, y - 24, tw, 34);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, width / 2, y);
    y += 42;
  }
  ctx.textAlign = 'left';
}

/** Tyres, ERS, DRS, limiter and slipstream for the local car, bottom left. */
export function drawRacerStatus(ctx: CanvasRenderingContext2D, r: Racer, _width: number, height: number, advice?: PitAdvice): void {
  const x = 260;
  const y = height - 150;
  const w = 210;
  panel(ctx, x, y, w, 130);

  // Tyre compound badge + wear.
  const c = COMPOUNDS[r.tyres.compound];
  ctx.beginPath();
  ctx.arc(x + 30, y + 32, 16, 0, Math.PI * 2);
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = c.color;
  ctx.stroke();
  ctx.fillStyle = c.color;
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(c.letter, x + 30, y + 38);
  ctx.textAlign = 'left';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#ddd';
  ctx.fillText(c.name, x + 56, y + 28);
  const wear = r.tyres.wear;
  ctx.fillStyle = wear > 0.75 ? '#ff4136' : wear > 0.5 ? '#ffb347' : '#aaa';
  ctx.fillText(`${Math.round(wear * 100)}% worn`, x + 56, y + 45);
  if (r.input.nextTyre !== r.tyres.compound) {
    const next = COMPOUNDS[r.input.nextTyre];
    ctx.fillStyle = next.color;
    ctx.textAlign = 'right';
    ctx.fillText(`Next: ${next.letter}`, x + w - 14, y + 28);
    ctx.textAlign = 'left';
  }
  // Pit window for the compulsory stop, or a tick once it's done.
  if (advice?.window) {
    const [a, b] = advice.window;
    ctx.fillStyle = advice.boxNow ? '#ffd400' : '#aaa';
    ctx.textAlign = 'right';
    ctx.fillText(a === b ? `Pit: lap ${a}` : `Pit: laps ${a}-${b}`, x + w - 14, y + 45);
    ctx.textAlign = 'left';
  } else if (r.pit.stops > 0) {
    ctx.fillStyle = '#2ecc40';
    ctx.textAlign = 'right';
    ctx.fillText(`${r.pit.stops} stop${r.pit.stops > 1 ? 's' : ''} ✓`, x + w - 14, y + 45);
    ctx.textAlign = 'left';
  }

  bar(ctx, x + 14, y + 64, w - 28, 10, r.ers, r.ersActive ? '#4dd2ff' : '#1f7fbf', 'ERS');

  // DRS light: grey = no, outlined = allowed in this/next zone, filled = open.
  const bx = x + 14;
  const by = y + 88;
  ctx.lineWidth = 2;
  ctx.strokeStyle = r.drsEligible || r.drsOpen ? '#2ecc40' : '#555';
  ctx.fillStyle = r.drsOpen ? '#2ecc40' : 'transparent';
  ctx.beginPath();
  ctx.roundRect(bx, by, 52, 26, 4);
  ctx.fill();
  ctx.stroke();
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = r.drsOpen ? '#06210a' : r.drsEligible ? '#2ecc40' : '#666';
  ctx.fillText('DRS', bx + 26, by + 18);

  ctx.font = 'bold 12px system-ui, sans-serif';
  if (r.input.limiter) {
    ctx.fillStyle = '#ffd400';
    ctx.fillText('PIT LIMITER', bx + 105, by + 17);
  } else if (r.slipstream > 0.2) {
    ctx.fillStyle = '#9fd8ff';
    ctx.fillText('TOW', bx + 90, by + 17);
  }
  ctx.textAlign = 'left';
}
