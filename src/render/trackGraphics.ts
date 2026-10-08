import { KERB_WIDTH, type Track, type TrackSample } from '../track/track';
import type { ViewBounds } from './camera';

/** Kerb band runs from just inside the track edge to KERB_WIDTH outside it. */
const KERB_LINE_WIDTH = KERB_WIDTH + 0.2;
const KERB_CENTRE = KERB_WIDTH / 2 - 0.1;

const COLORS = {
  outside: '#1e3a1b',
  grass: '#3b7533',
  gravel: '#c8b37e',
  asphalt: '#46474c',
  edgeLine: '#e8e8e8',
  kerbRed: '#d22b2b',
  kerbWhite: '#f2f2f2',
  wall: '#c9ced3',
  wallEdge: '#5b6168',
};

type Side = 'R' | 'L';

function edge(s: TrackSample, side: Side, offset: number): [number, number] {
  const sign = side === 'R' ? 1 : -1;
  return [s.x + s.nx * offset * sign, s.y + s.ny * offset * sign];
}

/** Samples per drawing chunk. Only chunks on screen get drawn. */
const CHUNK = 40;

interface Chunk {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  runoff: Path2D;
  gravel: Path2D;
  asphalt: Path2D;
  edgeLines: Path2D;
  walls: Path2D;
  /** Kerb polylines with their lap distance, so the stripes line up across chunks. */
  kerbs: { path: Path2D; s: number }[];
}

/** Pre-built Path2D shapes for a track, drawn in world metres. */
export class TrackGraphics {
  private readonly chunks: Chunk[] = [];
  private readonly startLine: Path2D[] = [new Path2D(), new Path2D()];

  constructor(readonly track: Track) {
    const ss = track.samples;
    const n = ss.length;
    for (let i0 = 0; i0 < n; i0 += CHUNK) {
      // One sample of overlap with the next chunk so there are no seams.
      const part: TrackSample[] = [];
      for (let i = i0; i <= Math.min(i0 + CHUNK, n); i++) part.push(ss[i % n]);
      this.chunks.push(buildChunk(part));
    }

    // Chequered start/finish line across the track at s = 0.
    const s0 = ss[0];
    const squares = 14;
    const size = (s0.halfWidth * 2) / squares;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < squares; col++) {
        const off = -s0.halfWidth + col * size;
        const along = (row - 1) * size;
        const p = (o: number, l: number): [number, number] => [
          s0.x + s0.nx * o + s0.tx * l,
          s0.y + s0.ny * o + s0.ty * l,
        ];
        quad(this.startLine[(row + col) % 2], p(off, along), p(off + size, along), p(off + size, along + size), p(off, along + size));
      }
    }
  }

  /** Draw the track. Pass the visible area to skip everything off screen. */
  draw(ctx: CanvasRenderingContext2D, view?: ViewBounds): void {
    const visible = view
      ? this.chunks.filter((c) => c.maxX >= view.minX && c.minX <= view.maxX && c.maxY >= view.minY && c.minY <= view.maxY)
      : this.chunks;

    ctx.fillStyle = COLORS.grass;
    for (const c of visible) ctx.fill(c.runoff);
    ctx.fillStyle = COLORS.gravel;
    for (const c of visible) ctx.fill(c.gravel);

    ctx.lineCap = 'butt';
    ctx.lineWidth = KERB_LINE_WIDTH;
    ctx.strokeStyle = COLORS.kerbRed;
    for (const c of visible) for (const k of c.kerbs) ctx.stroke(k.path);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = COLORS.kerbWhite;
    for (const c of visible) {
      for (const k of c.kerbs) {
        ctx.lineDashOffset = k.s % 4;
        ctx.stroke(k.path);
      }
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    ctx.fillStyle = COLORS.asphalt;
    for (const c of visible) ctx.fill(c.asphalt);
    ctx.lineWidth = 0.25;
    ctx.strokeStyle = COLORS.edgeLine;
    for (const c of visible) ctx.stroke(c.edgeLines);

    ctx.fillStyle = '#ffffff';
    ctx.fill(this.startLine[0]);
    ctx.fillStyle = '#111111';
    ctx.fill(this.startLine[1]);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = COLORS.wallEdge;
    for (const c of visible) ctx.stroke(c.walls);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = COLORS.wall;
    for (const c of visible) ctx.stroke(c.walls);
  }

  static readonly backgroundColor = COLORS.outside;
}

function buildChunk(part: TrackSample[]): Chunk {
  const runoff = new Path2D();
  const gravel = new Path2D();
  const asphalt = new Path2D();
  const edgeLines = new Path2D();
  const walls = new Path2D();
  const kerbs: Chunk['kerbs'] = [];

  strip(runoff, part, (t) => edge(t, 'R', t.wallR), (t) => edge(t, 'L', t.wallL));
  strip(asphalt, part, (t) => edge(t, 'R', t.halfWidth), (t) => edge(t, 'L', t.halfWidth));
  for (const side of ['R', 'L'] as Side[]) {
    const wall = (t: TrackSample) => (side === 'R' ? t.wallR : t.wallL);
    polyline(edgeLines, part, (t) => edge(t, side, t.halfWidth - 0.4));
    polyline(walls, part, (t) => edge(t, side, wall(t)));
    for (const run of runs(part, (t) => (side === 'R' ? t.surfR : t.surfL) === 'gravel')) {
      strip(gravel, run, (t) => edge(t, side, t.halfWidth), (t) => edge(t, side, wall(t)));
    }
    for (const run of runs(part, (t) => (side === 'R' ? t.kerbR : t.kerbL))) {
      const path = new Path2D();
      polyline(path, run, (t) => edge(t, side, t.halfWidth + KERB_CENTRE));
      kerbs.push({ path, s: run[0].s });
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of part) {
    for (const [x, y] of [edge(t, 'R', t.wallR + 1), edge(t, 'L', t.wallL + 1)]) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, runoff, gravel, asphalt, edgeLines, walls, kerbs };
}

type Pt = [number, number];

function polyline(path: Path2D, pts: TrackSample[], f: (t: TrackSample) => Pt): void {
  pts.forEach((t, i) => {
    const [x, y] = f(t);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
}

/** Closed band between two offset curves: forwards along a, back along b. */
function strip(path: Path2D, pts: TrackSample[], a: (t: TrackSample) => Pt, b: (t: TrackSample) => Pt): void {
  polyline(path, pts, a);
  for (let i = pts.length - 1; i >= 0; i--) {
    const [x, y] = b(pts[i]);
    path.lineTo(x, y);
  }
  path.closePath();
}

function quad(path: Path2D, a: [number, number], b: [number, number], c: [number, number], d: [number, number]): void {
  path.moveTo(a[0], a[1]);
  path.lineTo(b[0], b[1]);
  path.lineTo(c[0], c[1]);
  path.lineTo(d[0], d[1]);
  path.closePath();
}

/**
 * Split a list of samples into runs where pred holds. Each run includes the
 * next sample too, so consecutive runs leave no gaps.
 */
function runs(ss: TrackSample[], pred: (s: TrackSample) => boolean): TrackSample[][] {
  const out: TrackSample[][] = [];
  let cur: TrackSample[] | null = null;
  for (let i = 0; i < ss.length; i++) {
    if (pred(ss[i])) {
      (cur ??= []).push(ss[i]);
    } else if (cur) {
      cur.push(ss[i]);
      out.push(cur);
      cur = null;
    }
  }
  if (cur && cur.length > 1) out.push(cur);
  return out;
}
