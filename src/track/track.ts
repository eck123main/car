import { SURFACES, type DrsZone, type PitDef, type Surface, type SurfaceType, type TrackDef } from './types';

/** Width of the kerb band just outside the track edge (m). */
export const KERB_WIDTH = 1.2;
/** Distance between centreline samples (m). */
const SAMPLE_SPACING = 2;
const GRID_CELL = 16;
/** Pit lane layout, measured out from the track edge on the pit side (m). */
export const PIT_WALL_OFFSET = 1;
export const PIT_LANE_INNER = 2;
export const PIT_LANE_WIDTH = 8;
/** Open gap in the pit wall at the pit entry and exit (m). */
const PIT_OPENING = 35;
/** The lane surface tapers into the track over this distance before the entry and after the exit (m). */
const PIT_TAPER = 30;

export interface PitLane {
  /** +1 = right of the track, -1 = left. */
  side: 1 | -1;
  /** Lap distances (m) where the pit lane starts and ends. */
  entry: number;
  exit: number;
  /** The pit wall runs between these lap distances; the gaps either side are the way in and out. */
  wallStart: number;
  wallEnd: number;
  /** Lap distance of each pit box (one per car). */
  boxes: number[];
}

/**
 * One centreline sample. "Right"/"left" are relative to the driving direction;
 * the normal (nx, ny) points to the right.
 */
export interface TrackSample {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  /** Distance along the lap from the start line (m). */
  s: number;
  halfWidth: number;
  /** Smoothed signed curvature (1/m); positive = turning right. */
  curvature: number;
  kerbR: boolean;
  kerbL: boolean;
  /** Distance from centreline to the wall on each side (m). */
  wallR: number;
  wallL: number;
  surfR: SurfaceType;
  surfL: SurfaceType;
  /** Furthest a wall may go on each side before it meets another part of the track. */
  maxWallR: number;
  maxWallL: number;
  /** Pit lane alongside (on the pit side). */
  pit: boolean;
  /** How far the pit lane surface reaches beyond the track edge (m): full in the lane, tapering at each end. */
  pitWidth: number;
  /** Pit wall between the track and the pit lane. */
  pitWall: boolean;
}

export interface TrackHit {
  index: number;
  /** Signed lateral offset from the centreline (m); positive = right. */
  d: number;
  s: number;
  sample: TrackSample;
  nx: number;
  ny: number;
}

export interface WallContact {
  /** Unit normal pointing back towards the track. */
  nx: number;
  ny: number;
  depth: number;
}

export class Track {
  readonly name: string;
  readonly samples: TrackSample[];
  readonly length: number;
  readonly drsZones: DrsZone[];
  readonly pit: PitLane | null;
  private readonly grid = new Map<number, number[]>();

  constructor(def: TrackDef) {
    this.name = def.name;
    const pts = resampleClosed(splineClosed(def.points), SAMPLE_SPACING);
    this.length = pts.length * SAMPLE_SPACING;
    this.samples = buildSamples(pts, def.width / 2);
    this.pit = buildPitLane(this.samples, this.length, def.pit);
    this.buildGrid();
    this.fixWallOwnership();
    this.drsZones = def.drsZones ?? findDrsZones(this.samples, this.length);
  }

  /** Forward distance along the lap from a to b (0..length). */
  forwardDistance(a: number, b: number): number {
    return (((b - a) % this.length) + this.length) % this.length;
  }

  /** Whether lap distance s lies in [from, to), allowing for the start-line wrap. */
  inRange(s: number, from: number, to: number): boolean {
    return this.forwardDistance(from, s) < this.forwardDistance(from, to);
  }

  /**
   * Shrink any wall whose far side is closer to a different part of the track, so
   * collision checks against the nearest centreline always see the right wall.
   */
  private fixWallOwnership(): void {
    const owned = (s: TrackSample, offset: number) => {
      const hit = this.query(s.x + s.nx * offset, s.y + s.ny * offset);
      if (!hit) return true;
      const ds = Math.abs(hit.s - s.s);
      return Math.min(ds, this.length - ds) < 30;
    };
    for (const s of this.samples) {
      const floor = s.halfWidth + 0.3;
      while (s.wallR > floor && !owned(s, s.wallR + 1)) s.wallR -= 0.5;
      while (s.wallL > floor && !owned(s, -(s.wallL + 1))) s.wallL -= 0.5;
    }
  }

  /** Nearest centreline segment to a point, or null if far away from the track. */
  query(x: number, y: number): TrackHit | null {
    const list = this.grid.get(cellKey(Math.floor(x / GRID_CELL), Math.floor(y / GRID_CELL)));
    if (!list) return null;
    const n = this.samples.length;
    let best = -1;
    let bestD2 = Infinity;
    let bestT = 0;
    for (const i of list) {
      const a = this.samples[i];
      const b = this.samples[(i + 1) % n];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const t = clamp(((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey), 0, 1);
      const dx = x - (a.x + ex * t);
      const dy = y - (a.y + ey * t);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
        bestT = t;
      }
    }
    if (best < 0) return null;
    const a = this.samples[best];
    const b = this.samples[(best + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    const nx = -ey / len;
    const ny = ex / len;
    const px = a.x + ex * bestT;
    const py = a.y + ey * bestT;
    return {
      index: best,
      d: (x - px) * nx + (y - py) * ny,
      s: a.s + bestT * SAMPLE_SPACING,
      sample: bestT < 0.5 ? a : b,
      nx,
      ny,
    };
  }

  surfaceAt(x: number, y: number): Surface {
    const hit = this.query(x, y);
    if (!hit) return SURFACES.wall;
    const { d, sample } = hit;
    const right = d >= 0;
    const off = Math.abs(d);
    if (off <= sample.halfWidth) return SURFACES.asphalt;
    if (this.onPitSide(sample, d) && off <= sample.halfWidth + sample.pitWidth) return SURFACES.pit;
    if (off <= sample.halfWidth + KERB_WIDTH && (right ? sample.kerbR : sample.kerbL)) return SURFACES.kerb;
    if (off <= (right ? sample.wallR : sample.wallL)) return SURFACES[right ? sample.surfR : sample.surfL];
    return SURFACES.wall;
  }

  /**
   * Wall penetration at a point (e.g. a car corner). The car's centre decides which side
   * of the pit wall it is on, since the pit wall can be hit from both sides.
   */
  wallContact(x: number, y: number, carX = x, carY = y): WallContact | null {
    const hit = this.query(x, y);
    if (!hit) return null;
    const { d, sample, nx, ny } = hit;
    if (d > sample.wallR) return { nx: -nx, ny: -ny, depth: d - sample.wallR };
    if (-d > sample.wallL) return { nx, ny, depth: -d - sample.wallL };
    if (this.pit && sample.pitWall) {
      const side = this.pit.side;
      const wall = sample.halfWidth + PIT_WALL_OFFSET;
      const here = d * side;
      const car = ((carX - x) * nx + (carY - y) * ny + d) * side;
      if (car < wall && here > wall) return { nx: -nx * side, ny: -ny * side, depth: here - wall };
      if (car >= wall && here < wall) return { nx: nx * side, ny: ny * side, depth: wall - here };
    }
    return null;
  }

  /** Is lateral offset d on the pit lane side of a sample with pit lane surface (lane or taper)? */
  onPitSide(sample: TrackSample, d: number): boolean {
    return sample.pitWidth > 0 && this.pit !== null && d * this.pit.side > 0;
  }

  private buildGrid(): void {
    const n = this.samples.length;
    let reach = 0;
    for (const s of this.samples) reach = Math.max(reach, s.wallR, s.wallL);
    reach += 10;
    for (let i = 0; i < n; i++) {
      const a = this.samples[i];
      const b = this.samples[(i + 1) % n];
      const x0 = Math.floor((Math.min(a.x, b.x) - reach) / GRID_CELL);
      const x1 = Math.floor((Math.max(a.x, b.x) + reach) / GRID_CELL);
      const y0 = Math.floor((Math.min(a.y, b.y) - reach) / GRID_CELL);
      const y1 = Math.floor((Math.max(a.y, b.y) + reach) / GRID_CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cellKey(cx, cy);
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }
}

/**
 * Pit lane alongside the start/finish straight, like at real circuits. Uses the side from
 * the track file when given (if there is room), otherwise whichever side has more room.
 */
function buildPitLane(samples: TrackSample[], length: number, def: PitDef | undefined): PitLane | null {
  const n = samples.length;
  const at = (i: number) => samples[((i % n) + n) % n];
  // Pit lanes follow the start/finish straight and any gentle bends either side of it.
  const straight = (i: number) => Math.abs(at(i).curvature) < 1 / 100;
  let back = 0;
  while (back < n / 3 && straight(-back - 1)) back++;
  let fwd = 0;
  while (fwd < n / 3 && straight(fwd + 1)) fwd++;
  const explicit = def?.from !== undefined && def?.to !== undefined;
  const first = explicit ? Math.round(def!.from! / SAMPLE_SPACING) : -back + 5;
  const last = explicit ? Math.round(def!.to! / SAMPLE_SPACING) : fwd - 10;
  if ((last - first) * SAMPLE_SPACING < 2 * PIT_OPENING + 80) return null;

  const range: TrackSample[] = [];
  for (let i = first; i <= last; i++) range.push(at(i));
  const need = (s: TrackSample) => s.halfWidth + PIT_LANE_INNER + PIT_LANE_WIDTH + 1;
  // On the inside of a bend the lane must also stay clear of the bend's centre.
  const limit = (s: TrackSample, side: 1 | -1) => {
    const wall = side > 0 ? s.maxWallR : s.maxWallL;
    return s.curvature * side > 0 ? Math.min(wall, 0.8 / Math.abs(s.curvature)) : wall;
  };
  const room = (side: 1 | -1) => Math.min(...range.map((s) => limit(s, side) - need(s)));
  const preferred: 1 | -1 = def?.side === 'left' ? -1 : 1;
  const order: (1 | -1)[] = def ? [preferred, -preferred as 1 | -1] : room(1) >= room(-1) ? [1, -1] : [-1, 1];
  const side = order.find((sd) => room(sd) >= 0);
  if (!side) return null;

  const wrap = (v: number) => ((v % length) + length) % length;
  const laneLength = range.length * SAMPLE_SPACING;
  const full = PIT_LANE_INNER + PIT_LANE_WIDTH;
  range.forEach((s, k) => {
    s.pit = true;
    s.pitWidth = full;
    const along = k * SAMPLE_SPACING;
    s.pitWall = along >= PIT_OPENING && along <= laneLength - PIT_OPENING;
    if (side > 0) {
      s.wallR = Math.max(s.wallR, need(s));
      s.kerbR = false;
    } else {
      s.wallL = Math.max(s.wallL, need(s));
      s.kerbL = false;
    }
  });

  // Taper the lane surface into the track at both ends, so cars can merge without leaving it.
  const taperSamples = Math.round(PIT_TAPER / SAMPLE_SPACING);
  for (let k = 1; k <= taperSamples; k++) {
    const width = full * (1 - k / (taperSamples + 1));
    for (const s of [at(first - k), at(last + k)]) {
      if (s.pit) continue;
      s.pitWidth = Math.max(s.pitWidth, width);
      if (side > 0) {
        s.wallR = Math.max(s.wallR, s.halfWidth + width + 1);
        s.kerbR = false;
      } else {
        s.wallL = Math.max(s.wallL, s.halfWidth + width + 1);
        s.kerbL = false;
      }
    }
  }

  const entry = wrap(first * SAMPLE_SPACING);
  const exit = wrap(last * SAMPLE_SPACING);
  const wallStart = wrap(entry + PIT_OPENING);
  const wallEnd = wrap(exit - PIT_OPENING);
  // One box per possible car, spread along the pit wall section.
  const spacing = Math.min(14, (laneLength - 2 * PIT_OPENING - 30) / 10);
  const boxes = Array.from({ length: 10 }, (_, i) => wrap(wallStart + 15 + i * spacing));
  return { side, entry, exit, wallStart, wallEnd, boxes };
}

/** DRS zones on the two longest straights: open just after the straight starts, close before braking. */
function findDrsZones(samples: TrackSample[], length: number): DrsZone[] {
  const n = samples.length;
  const straight = samples.map((s) => Math.abs(s.curvature) < 1 / 500);
  const first = straight.indexOf(false);
  if (first < 0) return [];
  const runs: { start: number; len: number }[] = [];
  let runStart = -1;
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    if (straight[i] && runStart < 0) runStart = i;
    if (!straight[i] && runStart >= 0) {
      runs.push({ start: runStart, len: (((i - runStart) % n) + n) % n });
      runStart = -1;
    }
  }
  const wrap = (v: number) => ((v % length) + length) % length;
  return runs
    .map((r) => ({ start: samples[r.start].s, len: r.len * SAMPLE_SPACING }))
    .filter((r) => r.len >= 200)
    .sort((a, b) => b.len - a.len)
    .slice(0, 2)
    .map((r) => ({ detect: wrap(r.start - 80), start: wrap(r.start + 20), end: wrap(r.start + r.len - 40) }))
    .sort((a, b) => a.start - b.start);
}

function cellKey(cx: number, cy: number): number {
  return cx * 100003 + cy;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

type Pt = [number, number];

/** Closed centripetal Catmull-Rom spline through the control points. */
function splineClosed(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const steps = Math.max(8, Math.ceil(dist(p1, p2)));
    const t1 = Math.sqrt(dist(p0, p1)) || 1e-4;
    const t2 = t1 + (Math.sqrt(dist(p1, p2)) || 1e-4);
    const t3 = t2 + (Math.sqrt(dist(p2, p3)) || 1e-4);
    for (let j = 0; j < steps; j++) {
      const t = t1 + ((t2 - t1) * j) / steps;
      const a1 = mix(p0, p1, t / t1);
      const a2 = mix(p1, p2, (t - t1) / (t2 - t1));
      const a3 = mix(p2, p3, (t - t2) / (t3 - t2));
      const b1 = mix(a1, a2, t / t2);
      const b2 = mix(a2, a3, (t - t1) / (t3 - t1));
      out.push(mix(b1, b2, (t - t1) / (t2 - t1)));
    }
  }
  return out;
}

/** Resample a closed polyline to (almost) evenly spaced points. */
function resampleClosed(poly: Pt[], spacing: number): Pt[] {
  const n = poly.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += dist(poly[i], poly[(i + 1) % n]);
  const count = Math.round(total / spacing);
  const step = total / count;
  const out: Pt[] = [];
  let seg = 0;
  let segStart = 0;
  let segLen = dist(poly[0], poly[1 % n]);
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (segStart + segLen < target && seg < n - 1) {
      segStart += segLen;
      seg++;
      segLen = dist(poly[seg], poly[(seg + 1) % n]);
    }
    out.push(mix(poly[seg], poly[(seg + 1) % n], segLen > 0 ? (target - segStart) / segLen : 0));
  }
  return out;
}

function buildSamples(pts: Pt[], halfWidth: number): TrackSample[] {
  const n = pts.length;
  const at = (i: number) => pts[((i % n) + n) % n];

  // Raw signed curvature from the turn angle between neighbouring segments.
  const rawK = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const [ax, ay] = sub(at(i), at(i - 1));
    const [bx, by] = sub(at(i + 1), at(i));
    rawK[i] = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) / SAMPLE_SPACING;
  }
  const k = smoothClosed(rawK, 10);
  const kAbsMax = windowMaxAbs(rawK, 15);

  // Run-off: wide on the outside of corners, narrow on the inside.
  const runR = new Array<number>(n);
  const runL = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const extra = clamp((Math.abs(k[i]) - 1 / 400) * 3000, 0, 22);
    const right = k[i] > 0;
    runR[i] = right ? 7 : 12 + extra;
    runL[i] = right ? 12 + extra : 7;
  }
  const runRs = smoothClosed(runR, 20);
  const runLs = smoothClosed(runL, 20);

  const samples: TrackSample[] = [];
  for (let i = 0; i < n; i++) {
    const [dx, dy] = sub(at(i + 1), at(i - 1));
    const len = Math.hypot(dx, dy);
    const tx = dx / len;
    const ty = dy / len;
    const cornering = Math.abs(k[i]) > 1 / 300;
    // Keep the inside wall clear of the corner's centre of curvature.
    const maxInside = Math.max(1.5, 0.8 / Math.max(kAbsMax[i], 1e-6) - halfWidth - KERB_WIDTH);
    const turningRight = k[i] > 0;
    const runoffR = turningRight ? Math.min(runRs[i], maxInside) : runRs[i];
    const runoffL = turningRight ? runLs[i] : Math.min(runLs[i], maxInside);
    samples.push({
      x: at(i)[0],
      y: at(i)[1],
      tx,
      ty,
      nx: -ty,
      ny: tx,
      s: i * SAMPLE_SPACING,
      halfWidth,
      curvature: k[i],
      kerbR: cornering,
      kerbL: cornering,
      wallR: halfWidth + KERB_WIDTH + runoffR,
      wallL: halfWidth + KERB_WIDTH + runoffL,
      surfR: cornering && !turningRight ? 'gravel' : 'grass',
      surfL: cornering && turningRight ? 'gravel' : 'grass',
      maxWallR: Infinity,
      maxWallL: Infinity,
      pit: false,
      pitWidth: 0,
      pitWall: false,
    });
  }
  limitWallsByClearance(samples);
  return samples;
}

/**
 * Where two parts of the track run close together, pull both walls back to just short
 * of the halfway line between them. Otherwise one section's run-off overlaps the other
 * and cars slip through the walls.
 */
function limitWallsByClearance(samples: TrackSample[]): void {
  const n = samples.length;
  const total = n * SAMPLE_SPACING;
  let reach = 0;
  for (const s of samples) reach = Math.max(reach, s.wallR, s.wallL);
  const searchR = reach * 2 + SAMPLE_SPACING;
  const clearR = new Array<number>(n).fill(Infinity);
  const clearL = new Array<number>(n).fill(Infinity);

  for (let i = 0; i < n; i++) {
    const a = samples[i];
    for (let j = 0; j < n; j++) {
      const b = samples[j];
      const c = samples[(j + 1) % n];
      if (Math.abs(b.x - a.x) > searchR || Math.abs(b.y - a.y) > searchR) continue;
      const t = rayHitsSegment(a.x, a.y, a.nx, a.ny, b, c);
      if (t === null) continue;
      // Ignore the bit of track we're on: a genuinely different section is much
      // further away along the lap than it is in a straight line.
      let ds = Math.abs(b.s - a.s);
      ds = Math.min(ds, total - ds);
      if (ds < 1.3 * Math.abs(t) + 4) continue;
      if (t > 0) clearR[i] = Math.min(clearR[i], t);
      else clearL[i] = Math.min(clearL[i], -t);
    }
  }

  const minR = windowMin(clearR, 3);
  const minL = windowMin(clearL, 3);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const floor = s.halfWidth + 0.3;
    s.maxWallR = minR[i] / 2 - 1;
    s.maxWallL = minL[i] / 2 - 1;
    s.wallR = Math.max(floor, Math.min(s.wallR, minR[i] / 2 - 1));
    s.wallL = Math.max(floor, Math.min(s.wallL, minL[i] / 2 - 1));
  }
}

/** Signed distance along the line (ox, oy) + t * (dx, dy) to segment b-c, or null if it misses. */
function rayHitsSegment(ox: number, oy: number, dx: number, dy: number, b: TrackSample, c: TrackSample): number | null {
  const ex = c.x - b.x;
  const ey = c.y - b.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-9) return null;
  const wx = b.x - ox;
  const wy = b.y - oy;
  const t = (wx * ey - wy * ex) / denom;
  const u = (wx * dy - wy * dx) / denom;
  return u >= 0 && u <= 1 ? t : null;
}

function windowMin(values: number[], radius: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = -radius; j <= radius; j++) m = Math.min(m, values[(((i + j) % n) + n) % n]);
    out[i] = m;
  }
  return out;
}

function smoothClosed(values: number[], radius: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -radius; j <= radius; j++) sum += values[(((i + j) % n) + n) % n];
    out[i] = sum / (2 * radius + 1);
  }
  return out;
}

function windowMaxAbs(values: number[], radius: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = -radius; j <= radius; j++) m = Math.max(m, Math.abs(values[(((i + j) % n) + n) % n]));
    out[i] = m;
  }
  return out;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]];
}

function mix(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
