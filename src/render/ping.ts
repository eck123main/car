import type { NetInfo } from '../net/protocol';

/** Green under 60 ms, yellow under 120 ms, red above: about where racing starts to feel laggy. */
export function pingColor(ping: number): string {
  return ping < 60 ? '#2ecc40' : ping < 120 ? '#ffd400' : '#ff4136';
}

/** "42 ms", "42 ms · relayed", or null while unknown (and for the host and bots). */
export function pingText(info: NetInfo | undefined, long = false): string | null {
  if (!info || info.ping === null) return null;
  const ms = `${Math.round(info.ping)} ms`;
  if (info.relayed === null) return ms;
  if (info.relayed) return `${ms} · relayed`;
  return long ? `${ms} · direct` : ms;
}

/**
 * Our own connection to the host, top right next to the minimap (players who joined only).
 * A relayed link is flagged in orange: that's the usual cause of high ping between neighbours.
 */
export function drawOwnPing(ctx: CanvasRenderingContext2D, info: NetInfo | undefined, width: number): void {
  if (!info || info.ping === null) return;
  const route = info.relayed === null ? '' : info.relayed ? ' · relayed' : ' · direct';
  const parts: [string, string][] = [
    ['PING ', '#aaa'],
    [`${Math.round(info.ping)} ms`, pingColor(info.ping)],
    [route, info.relayed ? '#ff8a00' : '#aaa'],
  ];
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  let x = width - 196 - parts.reduce((sum, [t]) => sum + ctx.measureText(t).width, 0);
  for (const [t, color] of parts) {
    ctx.fillStyle = color;
    ctx.fillText(t, x, 18);
    x += ctx.measureText(t).width;
  }
}
