import { SURFACES, type Surface, type SurfaceType, type TrackDef } from './types';

/** Width of the kerb band just outside the track edge (m). */
export const KERB_WIDTH = 1.2;
/** Distance between centreline samples (m). */
const SAMPLE_SPACING = 2;
const GRID_CELL = 16;

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
  private readonly grid = new Map<number, number[]>();

  constructor(def: TrackDef) {
    this.name = def.name;
    const pts = resampleClosed(splineClosed(def.points), SAMPLE_SPACING);
    this.length = pts.length * SAMPLE_SPACING;
    this.samples = buildSamples(pts, def.width / 2);
    this.buildGrid();
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
    if (off <= sample.halfWidth + KERB_WIDTH && (right ? sample.kerbR : sample.kerbL)) return SURFACES.kerb;
    if (off <= (right ? sample.wallR : sample.wallL)) return SURFACES[right ? sample.surfR : sample.surfL];
    return SURFACES.wall;
  }

  wallContact(x: number, y: number): WallContact | null {
    const hit = this.query(x, y);
    if (!hit) return null;
    const { d, sample, nx, ny } = hit;
    if (d > sample.wallR) return { nx: -nx, ny: -ny, depth: d - sample.wallR };
    if (-d > sample.wallL) return { nx, ny, depth: -d - sample.wallL };
    return null;
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
    });
  }
  return samples;
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
