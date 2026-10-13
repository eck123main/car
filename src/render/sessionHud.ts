import type { NetInfo, SessionSnap } from '../net/protocol';
import { COMPOUNDS } from '../sim/tyres';
import type { RaceWorld, Racer } from '../sim/world';
import { formatLapTime } from './hud';
import { pingColor } from './ping';

/** Five red start lights, top centre. */
export function drawLights(ctx: CanvasRenderingContext2D, lit: number, width: number): void {
  const r = 18;
  const gap = 14;
  const total = 5 * 2 * r + 4 * gap;
  const x0 = width / 2 - total / 2 + r;
  const y = 190;
  ctx.fillStyle = 'rgba(10,10,14,0.85)';
  ctx.beginPath();
  ctx.roundRect(x0 - r - 14, y - r - 14, total + 28, 2 * r + 28, 10);
  ctx.fill();
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(x0 + i * (2 * r + gap), y, r, 0, Math.PI * 2);
    ctx.fillStyle = i < lit ? '#ff1a1a' : '#2a2a2e';
    ctx.fill();
  }
}

/** Lap counter or qualifying status, top centre. */
const SAFETY_CAR_YELLOW = '#ffb000';

export function drawSessionBanner(
  ctx: CanvasRenderingContext2D,
  session: SessionSnap,
  me: Racer,
  now: number,
  width: number,
): void {
  let text = '';
  let color = '#ffffff';
  if (session.phase === 'qualifying') {
    const q = session.quali.find(([id]) => id === me.id)?.[1];
    if (q?.status === 'waiting') text = `QUALIFYING · you go out in ${Math.max(0, q.releaseAt - now).toFixed(0)}s`;
    else if (q?.status === 'outLap') text = 'QUALIFYING · OUT LAP';
    else if (q?.status === 'flying') {
      text = 'QUALIFYING · FLYING LAP';
      color = '#b84dff';
    } else if (q?.status === 'done') {
      const pos = session.standings.find((s) => s.id === me.id)?.position;
      text = q.time !== null ? `QUALIFYING DONE · ${formatLapTime(q.time)} · P${pos}` : 'QUALIFYING DONE · no time';
    }
  } else if (session.phase === 'grid') {
    text = 'ON THE GRID · pick starting tyres with 1-5';
  } else if (session.phase === 'race') {
    const laps = Math.min(session.laps, me.timer.lapsCompleted + 1);
    text = `LAP ${laps}/${session.laps}`;
    if (session.safetyCar === 'deployed') {
      text += ' · SAFETY CAR · no overtaking';
      color = SAFETY_CAR_YELLOW;
    } else if (session.safetyCar === 'inThisLap') {
      text += ' · SAFETY CAR IN THIS LAP';
      color = SAFETY_CAR_YELLOW;
    } else if (session.noOvertaking.includes(me.id)) {
      text += ' · RESTART · no overtaking until the line';
      color = SAFETY_CAR_YELLOW;
    }
  }
  if (!text) return;
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(text).width + 28;
  ctx.fillStyle = 'rgba(10,10,14,0.75)';
  ctx.beginPath();
  ctx.roundRect(width / 2 - w / 2, 14, w, 30, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, 35);
  ctx.textAlign = 'left';
}

/** Spectating: whose car we're watching, under the session banner. */
export function drawSpectating(ctx: CanvasRenderingContext2D, name: string, color: string, width: number): void {
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const label = 'SPECTATING  ';
  const hint = '   ← → switch driver';
  const total = ctx.measureText(label + name + hint).width + 28;
  const x0 = width / 2 - total / 2;
  ctx.fillStyle = 'rgba(10,10,14,0.75)';
  ctx.beginPath();
  ctx.roundRect(x0, 50, total, 30, 6);
  ctx.fill();
  ctx.textAlign = 'left';
  let x = x0 + 14;
  ctx.fillStyle = '#bbb';
  ctx.fillText(label, x, 71);
  x += ctx.measureText(label).width;
  ctx.fillStyle = color;
  ctx.fillText(name, x, 71);
  x += ctx.measureText(name).width;
  ctx.fillStyle = '#888';
  ctx.fillText(hint, x, 71);
}

/**
 * Timing tower: position, name, ping (online players), gap, tyre. Left side under the timing
 * panel. A ping shown as "R 140" (orange) goes through a relay server rather than direct.
 */
export function drawTower(
  ctx: CanvasRenderingContext2D,
  session: SessionSnap,
  world: RaceWorld,
  meId: string,
  net: readonly NetInfo[] = [],
): void {
  const x = 20;
  let y = 190;
  const w = 280;
  const rowH = 22;
  const rows = session.standings;
  ctx.fillStyle = 'rgba(10,10,14,0.7)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, rows.length * rowH + 10, 8);
  ctx.fill();
  y += 5;
  ctx.font = '13px system-ui, sans-serif';
  for (const s of rows) {
    const r = world.racer(s.id);
    if (!r) continue;
    if (s.id === meId) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 4, y, w - 8, rowH);
    }
    ctx.fillStyle = '#aaa';
    ctx.textAlign = 'right';
    ctx.fillText(String(s.position), x + 26, y + 16);
    ctx.fillStyle = r.color;
    ctx.fillRect(x + 32, y + 4, 4, rowH - 8);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(r.name.slice(0, 12), x + 42, y + 16);
    const link = net.find((n) => n.id === s.id);
    if (link && link.ping !== null) {
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = link.relayed ? '#ff8a00' : pingColor(link.ping);
      ctx.fillText(`${link.relayed ? 'R ' : ''}${Math.round(link.ping)}`, x + 172, y + 15);
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'left';
    }

    let right = '';
    if (s.status === 'dnf') right = 'DNF';
    else if (s.status === 'pit') right = 'PIT';
    else if (session.phase === 'qualifying') right = s.bestLap !== null ? (s.position === 1 ? formatLapTime(s.bestLap) : `+${(s.gap ?? 0).toFixed(3)}`) : '';
    else if (s.position === 1) right = s.status === 'finished' ? 'FINISHED' : 'Leader';
    else if (s.lapsDown > 0) right = `+${s.lapsDown} lap${s.lapsDown > 1 ? 's' : ''}`;
    else if (s.gap !== null) right = `+${s.gap.toFixed(1)}`;
    if (s.penalties > 0 && session.phase !== 'qualifying') right += ` (+${s.penalties}s)`;
    ctx.textAlign = 'right';
    ctx.fillStyle = s.status === 'dnf' ? '#ff4136' : s.status === 'pit' ? '#ffd400' : '#ccc';
    ctx.fillText(right, x + w - 30, y + 16);
    const c = COMPOUNDS[r.tyres.compound];
    ctx.fillStyle = c.color;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillText(c.letter, x + w - 12, y + 16);
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    y += rowH;
  }
}

/** Driver names above other cars. Drawn in world metres. */
export function drawNameTag(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, color: string): void {
  ctx.font = 'bold 2.2px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const w = ctx.measureText(name).width + 1.2;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - w / 2, y - 6.2, w, 2.8);
  ctx.fillStyle = color;
  ctx.fillText(name, x, y - 4.1);
  ctx.textAlign = 'left';
}
