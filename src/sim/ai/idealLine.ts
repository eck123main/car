import { F1_CAR } from '../../physics/carParams';
import type { Track } from '../../track/track';
import type { PlayerInput, RaceWorld } from '../world';
import { IDLE_INPUT } from '../world';
import { TRACKS } from '../../tracks';
import IDEAL from '../../tracks/ideal-lines.json';
import type { CarParams } from '../../physics/carParams';
import { racingLine, speedProfile, type RacingLine } from './racingLine';

/**
 * The ideal line: the fastest racing line and speeds found for each track by driving laps in
 * the real physics (`scripts/ideal-lines.ts`), shown to players as a driving aid.
 */
export interface IdealSettings {
  /** Gap kept between the car's centre and the track edge (m). */
  margin: number;
  /** Share of the grip used in corners. */
  corner: number;
  /** Share of the grip used for braking. */
  brake: number;
}

export interface IdealRecord extends IdealSettings {
  /** The lap the ideal driver set with these settings (s). */
  time: number;
  /** The line: offsets from the centreline (m), one per `COARSE` samples. */
  offsets: number[];
}

export interface IdealLine {
  line: RacingLine;
  /** Planned speed at each track sample (m/s): the most the car may carry there. */
  speed: number[];
  /** What to do at each sample, for the driving aid: 0 = full throttle, 1 = hold the corner, 2 = brake. */
  cue: Uint8Array;
  /** The lap time it was worth, if the track has been searched (s). */
  time: number | null;
}

const RECORDS = IDEAL as Record<string, IdealRecord>;
const cache = new WeakMap<Track, IdealLine>();

/** The ideal line for a track (the bots' line where the search hasn't been run yet). */
export function idealLine(track: Track, trackId = idOf(track)): IdealLine {
  const cached = cache.get(track);
  if (cached) return cached;
  const rec = trackId ? RECORDS[trackId] : undefined;
  const ideal = rec?.offsets.length === Math.floor(track.samples.length / COARSE)
    ? { ...buildIdeal(track, rec, rec.offsets), time: rec.time }
    : fallback(track);
  cache.set(track, ideal);
  return ideal;
}

/** A built-in track's id, found by its name. */
function idOf(track: Track): string | undefined {
  return Object.keys(TRACKS).find((id) => TRACKS[id].name === track.name);
}

function fallback(track: Track): IdealLine {
  const line = racingLine(track);
  const speed = speedProfile(track, line, F1_CAR, 1);
  return { line, speed, cue: cues(track, line, speed, F1_CAR, 1), time: null };
}

/** The line through these coarse offsets, with its planned speeds. */
export function buildIdeal(track: Track, s: IdealSettings, coarse: number[]): Omit<IdealLine, 'time'> {
  const line = coarseLine(track, coarse, s.margin);
  const speed = idealSpeeds(track, line, F1_CAR, s.corner, s.brake);
  return { line, speed, cue: cues(track, line, speed, F1_CAR, s.corner) };
}

/** ERS on top of the engine while working out where the car gets to on a straight (W). */
const ERS_POWER = 120_000;

/**
 * Throttle / hold / brake along the line. The planned speed only says how fast the car may
 * go; the speed it really reaches comes from accelerating out of each corner (engine + ERS,
 * grip shared with cornering), so a braking zone starts where that speed meets the braking
 * curve, not where a car at an impossible top speed would brake.
 */
export function cues(track: Track, line: RacingLine, plan: number[], p: CarParams, corner: number): Uint8Array {
  const ss = track.samples;
  const n = ss.length;
  const ds = track.length / n;
  const c = p.downforceCoef / p.mass;
  const v = plan.slice();
  // Accelerating forwards, twice round so the lap wraps.
  let start = 0;
  for (let i = 1; i < n; i++) if (plan[i] < plan[start]) start = i;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const j = (i + 1) % n;
      const vi = v[i];
      const grip = p.mu * (G + c * vi * vi);
      const lat = Math.min(1, (vi * vi * Math.abs(line.curvature[i])) / (grip * corner));
      const share = Math.min(1, Math.sqrt(Math.max(0, (1 - lat * lat) / p.combinedGripPenalty)));
      const drive = Math.min(p.maxDriveForce, (p.power + ERS_POWER) / Math.max(vi, 1), grip * p.mass * share);
      const acc = (drive - p.dragCoef * vi * vi - p.rollingResistance * p.mass * G) / p.mass - G * ss[i].grade;
      v[j] = Math.min(plan[j], Math.sqrt(Math.max(0, vi * vi + 2 * acc * ds)));
    }
  }
  const cue = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const ahead = v[(i + 2) % n];
    if (ahead < v[i] - 0.15) cue[i] = 2;
    // At the planned speed with the corner using most of the grip: hold it there.
    else if (v[i] >= plan[i] - 0.5 && (v[i] * v[i] * Math.abs(line.curvature[i])) / (p.mu * (G + c * v[i] * v[i])) > 0.6) cue[i] = 1;
  }
  return cue;
}

const G = 9.81;

/**
 * Planned speed along a line: the cornering limit with `corner` of the grip, then braking zones
 * worked backwards with `brake` of the grip, less what the corner already uses (the car's grip
 * is shared between braking and turning, as in `Car.step`).
 */
export function idealSpeeds(track: Track, line: RacingLine, p: CarParams, corner: number, brake: number): number[] {
  const ss = track.samples;
  const n = ss.length;
  const c = p.downforceCoef / p.mass;
  const mu = p.mu * corner;
  const top = 100;
  const weight = (i: number, v: number) => Math.max(0.3, Math.min(1.8, 1 + (v * v * ss[i].vcurv) / G));
  const v = line.curvature.map((k, i) => {
    // v^2 k = mu (G + vcurv v^2 + c v^2)  ->  v^2 = mu G / (k - mu c - mu vcurv)
    const denom = Math.abs(k) - mu * c - mu * ss[i].vcurv;
    return denom > 0 ? Math.min(top, Math.sqrt((mu * G) / denom)) : top;
  });
  const ds = track.length / n;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      const grip = G * weight(i, next) + c * next * next;
      const lat = Math.min(1, (next * next * Math.abs(line.curvature[i])) / (mu * grip));
      const share = Math.min(p.brakeGrip, Math.sqrt(Math.max(0, (1 - lat * lat) / p.combinedGripPenalty)));
      const decel = Math.max(1, brake * p.mu * grip * share + (p.dragCoef * next * next) / p.mass + G * ss[i].grade);
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * decel * ds));
    }
  }
  return v;
}

/** Samples per point of the coarse solve (2 m each). */
export const COARSE = 4;

interface Point {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/**
 * The minimum-curvature line: offsets across the track (inside the edges less `margin`) that
 * make the line bend least overall (curvature squared per metre of line), solved on a coarse
 * grid (8 m) by Gauss-Newton steps, each a bounded least-squares problem. Through a fast corner
 * this is one wide arc using the whole width, which is what lets the car carry the most speed
 * through it. Returns the coarse offsets (see `offsetsFromCoarse`).
 */
export function solveMinimumCurvature(track: Track, margin: number): number[] {
  const ss = track.samples;
  const n = ss.length;
  const m = Math.floor(n / COARSE);
  // Each coarse point is bounded by the narrowest edge near it.
  const pts: Point[] = [];
  const lim: number[] = [];
  for (let j = 0; j < m; j++) {
    const i = Math.round((j * n) / m) % n;
    pts.push(ss[i]);
    let w = Infinity;
    for (let o = -COARSE; o <= COARSE; o++) w = Math.min(w, ss[(i + o + n) % n].halfWidth);
    lim.push(Math.max(0, w - margin));
  }
  const at = (i: number) => ((i % m) + m) % m;
  const residual = (a: ArrayLike<number>, j: number, k = -1, da = 0) => {
    const p = (i: number) => {
      const s = pts[at(i)];
      const o = a[at(i)] + (at(i) === k ? da : 0);
      return [s.x + s.nx * o, s.y + s.ny * o];
    };
    const [x0, y0] = p(j - 1);
    const [x1, y1] = p(j);
    const [x2, y2] = p(j + 1);
    // Curvature, weighted by the length of line it covers.
    return menger(x0, y0, x1, y1, x2, y2) * Math.sqrt((Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1)) / 2);
  };
  const energy = (a: ArrayLike<number>) => {
    let e = 0;
    for (let j = 0; j < m; j++) e += residual(a, j) ** 2;
    return e;
  };
  let a = new Float64Array(m);
  let e = energy(a);
  let step = 4;
  const H = new Float64Array(m * m);
  const g = new Float64Array(m);
  for (let round = 0; round < 60 && step > 0.01; round++) {
    // Linearise each residual in its three offsets.
    H.fill(0);
    g.fill(0);
    for (let j = 0; j < m; j++) {
      const r = residual(a, j);
      const ids = [at(j - 1), j, at(j + 1)];
      const d = ids.map((k) => (residual(a, j, k, 1e-3) - r) / 1e-3);
      for (let u = 0; u < 3; u++) {
        g[ids[u]] += d[u] * r;
        for (let v = 0; v < 3; v++) H[ids[u] * m + ids[v]] += d[u] * d[v];
      }
    }
    for (let i = 0; i < m; i++) H[i * m + i] += 1e-6;
    // Solve for the change, within the edges and the step size.
    const lo = Array.from(a, (x, i) => Math.max(-lim[i], x - step) - x);
    const hi = Array.from(a, (x, i) => Math.min(lim[i], x + step) - x);
    const dx = boxQP(H, g, lo, hi, m);
    const next = a.map((x, i) => x + dx[i]);
    const en = energy(next);
    if (en < e) {
      a = next;
      if (e - en < 1e-7 * e) break;
      e = en;
      step = Math.min(8, step * 1.5);
    } else step /= 2;
  }
  return Array.from(a);
}

/** Signed curvature of the circle through three points (1/m; positive = turning right). */
function menger(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const l = Math.hypot(x1 - x0, y1 - y0) * Math.hypot(x2 - x1, y2 - y1) * Math.hypot(x2 - x0, y2 - y0);
  return (2 * ((x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1))) / Math.max(l, 1e-9);
}

/**
 * The line through coarse offsets (one per `COARSE` samples) on every sample: offsets by a
 * periodic cubic (within the edges), curvature from the coarse points themselves (resampling
 * along the centreline's normals adds ripples the car would have to slow for).
 */
export function coarseLine(track: Track, coarse: number[], margin: number): RacingLine {
  const ss = track.samples;
  const n = ss.length;
  const m = coarse.length;
  const pt = (j: number) => {
    const s = ss[Math.round((((j % m) + m) % m) * n / m) % n];
    const o = coarse[((j % m) + m) % m];
    return [s.x + s.nx * o, s.y + s.ny * o];
  };
  const k = Array.from({ length: m }, (_, j) => {
    const [x0, y0] = pt(j - 1);
    const [x1, y1] = pt(j);
    const [x2, y2] = pt(j + 1);
    return menger(x0, y0, x1, y1, x2, y2);
  });
  const offset = new Array<number>(n);
  const curvature = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const f = (i * m) / n;
    const j = Math.floor(f);
    const t = f - j;
    const p0 = coarse[(j - 1 + m) % m];
    const p1 = coarse[j % m];
    const p2 = coarse[(j + 1) % m];
    const p3 = coarse[(j + 2) % m];
    const v = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const limit = Math.max(0, ss[i].halfWidth - margin);
    offset[i] = Math.max(-limit, Math.min(limit, v));
    curvature[i] = k[j % m] + (k[(j + 1) % m] - k[j % m]) * t;
  }
  return { offset, curvature };
}

/**
 * min 1/2 x'Hx + g'x with lo <= x <= hi (H symmetric positive definite, m x m): an active-set
 * method, solving the free variables exactly (dense Cholesky) each round.
 */
export function boxQP(H: Float64Array, g: Float64Array, lo: number[], hi: number[], m: number): Float64Array {
  // 0 = free, -1 / 1 = held at the lower / upper bound.
  const state = new Int8Array(m);
  const x = new Float64Array(m);
  for (let round = 0; round < 300; round++) {
    const free: number[] = [];
    for (let i = 0; i < m; i++) {
      if (state[i] === 0) free.push(i);
      else x[i] = state[i] > 0 ? hi[i] : lo[i];
    }
    const f = free.length;
    const A = new Float64Array(f * f);
    const rhs = new Float64Array(f);
    for (let r = 0; r < f; r++) {
      const i = free[r];
      let s = -g[i];
      for (let k = 0; k < m; k++) if (state[k] !== 0) s -= H[i * m + k] * x[k];
      rhs[r] = s;
      for (let c = 0; c < f; c++) A[r * f + c] = H[i * m + free[c]];
    }
    const sol = cholesky(A, rhs, f);
    // Free variables past a bound: hold the worst ones there and solve again.
    let worst = 0;
    for (let r = 0; r < f; r++) worst = Math.max(worst, sol[r] - hi[free[r]], lo[free[r]] - sol[r]);
    let changed = false;
    for (let r = 0; r < f; r++) {
      const i = free[r];
      x[i] = sol[r];
      const over = Math.max(sol[r] - hi[i], lo[i] - sol[r]);
      if (over > 1e-9 && over >= worst * 0.5) {
        state[i] = sol[r] > hi[i] ? 1 : -1;
        changed = true;
      }
    }
    if (changed) continue;
    for (let i = 0; i < m; i++) x[i] = Math.max(lo[i], Math.min(hi[i], x[i]));
    // Held variables that would rather move back inside: free them.
    for (let i = 0; i < m; i++) {
      if (state[i] === 0 || hi[i] - lo[i] < 1e-12) continue;
      let grad = g[i];
      for (let k = 0; k < m; k++) grad += H[i * m + k] * x[k];
      if (grad * state[i] > 1e-9) {
        state[i] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return x;
}

/** Solves A x = b for a symmetric positive definite A (f x f, row-major), in place. */
function cholesky(A: Float64Array, b: Float64Array, f: number): Float64Array {
  for (let j = 0; j < f; j++) {
    let d = A[j * f + j];
    for (let k = 0; k < j; k++) d -= A[j * f + k] * A[j * f + k];
    const l = Math.sqrt(Math.max(d, 1e-12));
    A[j * f + j] = l;
    for (let i = j + 1; i < f; i++) {
      let s = A[i * f + j];
      for (let k = 0; k < j; k++) s -= A[i * f + k] * A[j * f + k];
      A[i * f + j] = s / l;
    }
  }
  const x = new Float64Array(b);
  for (let i = 0; i < f; i++) {
    let s = x[i];
    for (let k = 0; k < i; k++) s -= A[i * f + k] * x[k];
    x[i] = s / A[i * f + i];
  }
  for (let i = f - 1; i >= 0; i--) {
    let s = x[i];
    for (let k = i + 1; k < f; k++) s -= A[k * f + i] * x[k];
    x[i] = s / A[i * f + i];
  }
  return x;
}

/**
 * Drives the ideal line alone (time trial): steers onto the line a little ahead and keeps to
 * the planned speed. Used to search for the settings and to check the line can be driven.
 */
export class LineDriver {
  /** Steering looks this far ahead (m): base + per m/s. */
  look = [6, 0.28];
  constructor(
    private readonly track: Track,
    private readonly ideal: Omit<IdealLine, 'time'>,
    private readonly racerId: string,
  ) {}

  drive(world: RaceWorld): PlayerInput {
    const me = world.racers.find((r) => r.id === this.racerId);
    if (!me) return IDLE_INPUT;
    const car = me.car;
    const q = this.track.query(car.x, car.y, car.trackIndex);
    if (!q) return IDLE_INPUT;
    const { line, speed: profile } = this.ideal;
    const n = this.track.samples.length;
    const speed = car.speed;

    // Steering: pure pursuit towards the line a little ahead.
    const look = this.look[0] + speed * this.look[1];
    const aheadIdx = (q.index + Math.round(look / 2)) % n;
    const ahead = this.track.samples[aheadIdx];
    const tx = ahead.x + ahead.nx * line.offset[aheadIdx];
    const ty = ahead.y + ahead.ny * line.offset[aheadIdx];
    let alpha = Math.atan2(ty - car.y, tx - car.x) - car.heading;
    alpha = Math.atan2(Math.sin(alpha), Math.cos(alpha));
    const curvature = (2 * Math.sin(alpha)) / Math.max(Math.hypot(tx - car.x, ty - car.y), 1);
    const p = car.params;
    const grip = p.mu * car.gripFactor * (p.mass * 9.81 + p.downforceCoef * speed * speed);
    const maxYaw = Math.min(speed / p.minTurnRadius, grip / p.mass / Math.max(speed, 1));
    const steer = Math.max(-1, Math.min(1, (curvature * Math.max(speed, 3)) / Math.max(maxYaw, 0.05)));

    // Speed: the planned speed here and just ahead (pedals take a moment to act).
    const lookIdx = Math.round((speed * 0.12) / 2);
    const target = Math.min(profile[q.index], profile[(q.index + lookIdx) % n]);
    const err = target - speed;
    // Running wide at full lock: lift.
    const lift = Math.abs(steer) > 0.98 && Math.abs(car.steer) > 0.98;
    const throttle = lift ? 0 : err > 0.2 ? 1 : err > -0.2 ? 0.5 : 0;
    const brake = err < -0.5 && speed > 1 ? Math.min(1, -err / 1.5) : 0;
    const straight = Math.abs(line.curvature[q.index]) < 1 / 250;
    return { ...IDLE_INPUT, throttle, brake, steer, drs: true, ers: straight && throttle === 1 && speed > 30 };
  }
}
