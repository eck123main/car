import type { CarParams } from '../../physics/carParams';
import type { Track } from '../../track/track';

const G = 9.81;
/** Gap kept between the car's centre and the track edge on the racing line (m). */
const EDGE_MARGIN = 2.2;

export interface RacingLine {
  /** Lateral offset from the centreline at each track sample (positive = right). */
  offset: number[];
  /** Signed curvature of the line at each sample (1/m). */
  curvature: number[];
}

const cache = new WeakMap<Track, Map<number, RacingLine>>();

/**
 * A smooth, minimum-curvature line through the track: repeatedly pulls each point towards
 * the midpoint of its neighbours, kept inside the track edges. This naturally finds the
 * outside-inside-outside line through corners. `margin` is the gap kept between the car's
 * centre and the track edge (m).
 */
export function racingLine(track: Track, margin = EDGE_MARGIN): RacingLine {
  let lines = cache.get(track);
  if (!lines) cache.set(track, (lines = new Map()));
  const cached = lines.get(margin);
  if (cached) return cached;
  const ss = track.samples;
  const n = ss.length;
  const offset = new Array<number>(n).fill(0);
  const limit = ss.map((s) => Math.max(0, s.halfWidth - margin));
  const px = new Array<number>(n);
  const py = new Array<number>(n);
  const at = (i: number) => ((i % n) + n) % n;
  const place = () => {
    for (let i = 0; i < n; i++) {
      px[i] = ss[i].x + ss[i].nx * offset[i];
      py[i] = ss[i].y + ss[i].ny * offset[i];
    }
  };
  // Coarse to fine: wide stencils straighten long sections fast, narrow ones smooth details.
  for (const [k, iterations] of [
    [24, 40],
    [12, 60],
    [6, 150],
    [3, 400],
    [2, 600],
    [1, 800],
  ] as const) {
    for (let it = 0; it < iterations; it++) {
      place();
      for (let i = 0; i < n; i++) {
        // Minimum curvature, not minimum length: aim for the point that keeps the bend
        // equal to its neighbours' (a 4th-order stencil). Pulling towards the plain midpoint
        // would make a taut string that hugs the inside and kinks at the apex.
        const a2 = at(i - 2 * k);
        const a = at(i - k);
        const b = at(i + k);
        const b2 = at(i + 2 * k);
        const mx = (-px[a2] + 4 * px[a] + 4 * px[b] - px[b2]) / 6;
        const my = (-py[a2] + 4 * py[a] + 4 * py[b] - py[b2]) / 6;
        const s = ss[i];
        const want = (mx - s.x) * s.nx + (my - s.y) * s.ny;
        offset[i] = clamp(offset[i] + (want - offset[i]) * 0.5, -limit[i], limit[i]);
      }
    }
  }
  const line = lineFromOffsets(track, offset);
  lines.set(margin, line);
  return line;
}

/** The racing line through these offsets from the centreline, with its curvature. */
export function lineFromOffsets(track: Track, offset: number[]): RacingLine {
  const ss = track.samples;
  const n = ss.length;
  const at = (i: number) => ((i % n) + n) % n;
  const px = offset.map((o, i) => ss[i].x + ss[i].nx * o);
  const py = offset.map((o, i) => ss[i].y + ss[i].ny * o);
  const curvature = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = at(i - 3);
    const b = at(i + 3);
    const ax = px[i] - px[a];
    const ay = py[i] - py[a];
    const bx = px[b] - px[i];
    const by = py[b] - py[i];
    const len = (Math.hypot(ax, ay) + Math.hypot(bx, by)) / 2;
    curvature[i] = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) / Math.max(len, 0.1);
  }
  return { offset, curvature: smooth(curvature, 2) };
}

/**
 * Target speed at each sample for a car using `pace` (0..1) of its grip: the cornering
 * limit, then braking zones worked backwards from each corner, braking with `brakeShare` of
 * the grip.
 */
export function speedProfile(track: Track, line: RacingLine, p: CarParams, pace: number, brakeShare = 0.8 * pace): number[] {
  const n = line.curvature.length;
  const mu = p.mu * pace;
  const c = p.downforceCoef / p.mass;
  const top = 100;
  // Hills (one sample per point of the line): a crest makes the car lighter, a dip heavier.
  const ss = track.samples.length === n ? track.samples : null;
  const v = line.curvature.map((k, i) => {
    const kk = Math.abs(k);
    // v^2 * k = mu * (G + vcurv v^2 + c v^2)  ->  v^2 = mu G / (k - mu c - mu vcurv)
    const denom = kk - mu * c - mu * (ss?.[i].vcurv ?? 0);
    const corner = denom > 0 ? Math.sqrt((mu * G) / denom) : top;
    return Math.min(top, corner);
  });
  // Braking: work backwards twice (the lap wraps), assuming a share of grip for braking.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      const grade = ss?.[i].grade ?? 0;
      const weight = Math.max(0.3, 1 + (next * next * (ss?.[i].vcurv ?? 0)) / G);
      // Braking uphill stops sooner, downhill later.
      const decel = Math.max(1, brakeShare * p.mu * (G * weight + c * next * next) + (p.dragCoef * next * next) / p.mass + G * grade);
      const ds = track.length / n;
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * decel * ds));
    }
  }
  return v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smooth(values: number[], radius: number): number[] {
  const n = values.length;
  return values.map((_, i) => {
    let sum = 0;
    for (let j = -radius; j <= radius; j++) sum += values[(((i + j) % n) + n) % n];
    return sum / (2 * radius + 1);
  });
}
