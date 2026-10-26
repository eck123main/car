import type { IdealLine } from '../sim/ai/idealLine';
import type { Track } from '../track/track';

/** Driving aid colours: full throttle, hold the corner, brake. */
export const CUE_COLORS = ['#2ecc40', '#ffd400', '#ff2a1f'] as const;

/** How much of the line is shown (m): a little behind the car, and ahead. */
const BEHIND = 10;
const AHEAD = 320;

/**
 * The ideal line from above, in world metres: from just behind the car to a few hundred metres
 * ahead, coloured green (throttle), yellow (hold the corner) and red (brake), fading out ahead.
 */
export function drawIdealLine(ctx: CanvasRenderingContext2D, track: Track, ideal: IdealLine, trackIndex: number | null): void {
  if (trackIndex === null) return;
  const ss = track.samples;
  const n = ss.length;
  const step = track.length / n;
  const from = trackIndex - Math.round(BEHIND / step);
  const count = Math.round((BEHIND + AHEAD) / step);
  const point = (k: number): [number, number] => {
    const i = (((from + k) % n) + n) % n;
    const o = ideal.line.offset[i];
    return [ss[i].x + ss[i].nx * o, ss[i].y + ss[i].ny * o];
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.9;
  // Runs of one colour drawn as one path; the fade goes in steps.
  let k = 0;
  while (k < count) {
    const i = (((from + k) % n) + n) % n;
    const cue = ideal.cue[i];
    const fade = Math.floor((k / count) * 4);
    let end = k + 1;
    while (end < count && ideal.cue[(((from + end) % n) + n) % n] === cue && Math.floor((end / count) * 4) === fade) end++;
    ctx.globalAlpha = 0.85 * (1 - fade * 0.22);
    ctx.strokeStyle = CUE_COLORS[cue];
    ctx.beginPath();
    const [x0, y0] = point(k);
    ctx.moveTo(x0, y0);
    for (let j = k + 1; j <= Math.min(end, count - 1); j++) {
      const [x, y] = point(j);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    k = end;
  }
  ctx.restore();
}
