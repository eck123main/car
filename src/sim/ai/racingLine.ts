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

const cache = new WeakMap<Track, RacingLine>();

/**
 * A smooth, minimum-curvature line through the track: repeatedly pulls each point towards
 * the midpoint of its neighbours, kept inside the track edges. This naturally finds the
 * outside-inside-outside line through corners.
 */
export function racingLine(track: Track): RacingLine {
  const cached = cache.get(track);
  if (cached) return cached;
  const ss = track.samples;
  const n = ss.length;
  const offset = new Array<number>(n).fill(0);
  const limit = ss.map((s) => Math.max(0, s.halfWidth - EDGE_MARGIN));
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
    [24, 60],
    [12, 80],
    [6, 120],
    [3, 160],
    [1, 120],
  ] as const) {
    for (let it = 0; it < iterations; it++) {
      place();
      for (let i = 0; i < n; i++) {
        const a = at(i - k);
        const b = at(i + k);
        const mx = (px[a] + px[b]) / 2;
        const my = (py[a] + py[b]) / 2;
        const s = ss[i];
        const want = (mx - s.x) * s.nx + (my - s.y) * s.ny;
        offset[i] = clamp(offset[i] + (want - offset[i]) * 0.5, -limit[i], limit[i]);
      }
    }
  }
  place();
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
  const line = { offset, curvature: smooth(curvature, 2) };
  cache.set(track, line);
  return line;
}

/**
 * Target speed at each sample for a car using `pace` (0..1) of its grip: the cornering
 * limit, then braking zones worked backwards from each corner.
 */
export function speedProfile(track: Track, line: RacingLine, p: CarParams, pace: number): number[] {
  const n = line.curvature.length;
  const mu = p.mu * pace;
  const c = p.downforceCoef / p.mass;
  const top = 100;
  const v = line.curvature.map((k) => {
    const kk = Math.abs(k);
    // v^2 * k = mu * (G + c v^2)  ->  v^2 = mu G / (k - mu c)
    const denom = kk - mu * c;
    const corner = denom > 0 ? Math.sqrt((mu * G) / denom) : top;
    return Math.min(top, corner);
  });
  // Braking: work backwards twice (the lap wraps), assuming a share of grip for braking.
  const brakeShare = 0.8 * pace;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      const decel = brakeShare * p.mu * (G + c * next * next) + (p.dragCoef * next * next) / p.mass;
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
