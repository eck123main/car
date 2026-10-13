import type { TimeEntry } from '../net/leaderboard';
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
  /** Which ghost is out: 'record', 'personal' or 'off'. */
  ghost: string;
}

const ROWS_SHOWN = 10;

/** Time trial leaderboard, left side under the timing panel. */
export function drawLeaderboard(ctx: CanvasRenderingContext2D, v: BoardView): void {
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
  const ghost = v.ghost === 'record' ? 'record' : v.ghost === 'personal' ? 'your best' : 'off';
  ctx.fillText(`G ghost: ${ghost}`, x + 12, y + 20);
  ctx.fillText('ENTER restart lap', x + 12, y + 36);
  // Who to beat next.
  const target = mine === -1 ? v.rows[v.rows.length - 1] : v.rows[mine - 1];
  if (v.state === 'ok' && target && mine !== 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd400';
    ctx.fillText(`Next: ${target.name.slice(0, 10)} ${formatLapTime(target.time)}`, x + w - 12, y + 20);
    ctx.textAlign = 'left';
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
  ctx.fillText('ENTER  restart from the line      or keep driving to finish the lap', width / 2, y + 64);
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
