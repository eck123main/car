import type { TimeEntry } from '../net/leaderboard';
import { MEDAL_COLORS, MEDAL_NAMES, MEDALS, medalFor, nextMedal, type Medal, type MedalTimes } from '../sim/medals';
import { formatLapTime } from './hud';

/** Ghost cars are always this colour, so they never look like the player's own car. */
export const GHOST_COLOR = '#00e5ff';

export interface BoardView {
  rows: TimeEntry[];
  /** This browser's player id (its row is highlighted). */
  me: string;
  state: 'loading' | 'ok' | 'error';
  global: boolean;
  trackName: string;
  /** Which ghost is out, e.g. 'P1 Max', 'your best' or 'off'. */
  ghost: string;
}

const ROWS_SHOWN = 10;

/** Time trial leaderboard, left side under the timing panel. Returns where it ends (y). */
export function drawLeaderboard(ctx: CanvasRenderingContext2D, v: BoardView): number {
  const x = 20;
  let y = 190;
  const w = 280;
  const rowH = 22;
  const mine = v.rows.findIndex((r) => r.player === v.me);
  // The top ten, plus our own row if we're further down.
  const shown = v.rows.slice(0, ROWS_SHOWN).map((r, i) => ({ r, pos: i + 1 }));
  if (mine >= ROWS_SHOWN) shown.push({ r: v.rows[mine], pos: mine + 1 });
  const lines = Math.max(1, shown.length);
  const h = 34 + lines * rowH + 44;
  ctx.fillStyle = 'rgba(10,10,14,0.7)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText(`${v.global ? 'WORLD' : 'THIS DEVICE'} · ${v.trackName.toUpperCase()}`.slice(0, 40), x + 12, y + 22);
  y += 32;

  ctx.font = '13px system-ui, sans-serif';
  if (v.state !== 'ok' || shown.length === 0) {
    ctx.fillStyle = '#888';
    const msg = v.state === 'loading' ? 'Loading times…' : v.state === 'error' ? "Couldn't reach the leaderboard" : 'No times yet: set the first!';
    ctx.fillText(msg, x + 12, y + 16);
    y += rowH;
  }
  const best = v.rows[0]?.time ?? 0;
  for (const { r, pos } of v.state === 'ok' ? shown : []) {
    if (r.player === v.me) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 4, y, w - 8, rowH);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = pos === 1 ? '#b84dff' : '#aaa';
    ctx.fillText(String(pos), x + 26, y + 16);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(r.name.slice(0, 14), x + 36, y + 16);
    ctx.textAlign = 'right';
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillStyle = pos === 1 ? '#b84dff' : '#ccc';
    ctx.fillText(pos === 1 ? formatLapTime(r.time) : `+${(r.time - best).toFixed(3)}`, x + w - 12, y + 16);
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    y += rowH;
  }

  ctx.fillStyle = '#8a8d96';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`G ghost: ${v.ghost.slice(0, 18)}`, x + 12, y + 20);
  ctx.fillText('R / ENTER restart lap', x + 12, y + 36);
  // Who to beat next.
  const target = mine === -1 ? v.rows[v.rows.length - 1] : v.rows[mine - 1];
  if (v.state === 'ok' && target && mine !== 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd400';
    ctx.fillText(`Next: ${target.name.slice(0, 10)} ${formatLapTime(target.time)}`, x + w - 12, y + 20);
    ctx.textAlign = 'left';
  }
  return y + 44;
}

export interface MedalView {
  times: MedalTimes;
  /** Our best lap on this track. */
  best: number | null;
  /** Only signed-in players earn medals. */
  signedIn: boolean;
}

/** A medal: a disc in its colour, filled when won. */
export function drawMedalIcon(ctx: CanvasRenderingContext2D, medal: Medal, x: number, y: number, r: number, won: boolean): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  if (won) {
    ctx.fillStyle = MEDAL_COLORS[medal];
    ctx.fill();
  } else {
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = MEDAL_COLORS[medal];
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** The track's medal times under the leaderboard: which are won, and how far off the next one is. */
export function drawMedals(ctx: CanvasRenderingContext2D, top: number, v: MedalView): void {
  const x = 20;
  const w = 280;
  const rowH = 20;
  const h = 32 + MEDALS.length * rowH + (v.signedIn ? 6 : 22);
  ctx.fillStyle = 'rgba(10,10,14,0.7)';
  ctx.beginPath();
  ctx.roundRect(x, top, w, h, 8);
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText('MEDALS', x + 12, top + 22);
  const have = v.signedIn ? medalFor(v.best, v.times) : null;
  const next = v.signedIn ? nextMedal(v.best, v.times) : null;
  let y = top + 30;
  for (const m of MEDALS) {
    const won = have !== null && MEDALS.indexOf(m) >= MEDALS.indexOf(have);
    drawMedalIcon(ctx, m, x + 20, y + rowH / 2, 6, won);
    ctx.textAlign = 'left';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = won ? MEDAL_COLORS[m] : '#ccc';
    ctx.fillText(MEDAL_NAMES[m], x + 34, y + 15);
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText(formatLapTime(v.times[m]), x + 110, y + 15);
    ctx.textAlign = 'right';
    if (won) {
      ctx.fillText('✓', x + w - 12, y + 15);
    } else if (m === next && v.best !== null) {
      // How far off the next medal our best is.
      ctx.fillStyle = '#ffd400';
      ctx.fillText(`+${(v.best - v.times[m]).toFixed(3)}`, x + w - 12, y + 15);
    }
    y += rowH;
  }
  ctx.textAlign = 'left';
  if (!v.signedIn) {
    ctx.fillStyle = '#8a8d96';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Sign in to earn medals', x + 12, y + 14);
  }
}

/** Big notice when a lap has been ruled out, with the choice of what to do. */
export function drawInvalidPrompt(ctx: CanvasRenderingContext2D, reason: string, width: number, height: number): void {
  const w = Math.min(560, width - 40);
  const x = width / 2 - w / 2;
  const y = height * 0.22;
  ctx.fillStyle = 'rgba(10,10,14,0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 84, 10);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff4136';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.fillText(`LAP INVALID · ${reason}`, width / 2, y + 34);
  ctx.fillStyle = '#ddd';
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText('R / ENTER  restart from the start      or keep driving to finish the lap', width / 2, y + 64);
  ctx.textAlign = 'left';
}

/** A short result line in the middle of the screen (new record, leaderboard place). */
export function drawNotice(ctx: CanvasRenderingContext2D, text: string, color: string, width: number, height: number): void {
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const tw = ctx.measureText(text).width + 40;
  const y = height * 0.22 + 110;
  ctx.fillStyle = 'rgba(10,10,14,0.8)';
  ctx.beginPath();
  ctx.roundRect(width / 2 - tw / 2, y, tw, 44, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, y + 31);
  ctx.textAlign = 'left';
}
