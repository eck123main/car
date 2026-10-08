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
  private readonly brakeBoards: BrakeBoard[];
  private readonly drsDetect = new Path2D();
  private readonly drsStart = new Path2D();
  private readonly drsLabels: { x: number; y: number; angle: number }[] = [];

  constructor(readonly track: Track) {
    const ss = track.samples;
    const n = ss.length;
    for (let i0 = 0; i0 < n; i0 += CHUNK) {
      // One sample of overlap with the next chunk so there are no seams.
      const part: TrackSample[] = [];
      for (let i = i0; i <= Math.min(i0 + CHUNK, n); i++) part.push(ss[i % n]);
      this.chunks.push(buildChunk(part));
    }

    this.brakeBoards = findBrakeBoards(track);
    for (const zone of track.drsZones) {
      const across = (path: Path2D, at: number) => {
        const t = ss[Math.floor(at / 2) % ss.length];
        path.moveTo(t.x - t.nx * t.halfWidth, t.y - t.ny * t.halfWidth);
        path.lineTo(t.x + t.nx * t.halfWidth, t.y + t.ny * t.halfWidth);
        return t;
      };
      across(this.drsDetect, zone.detect);
      const t = across(this.drsStart, zone.start);
      const lx = t.x + t.tx * 8;
      const ly = t.y + t.ty * 8;
      this.drsLabels.push({ x: lx, y: ly, angle: Math.atan2(t.ty, t.tx) + Math.PI / 2 });
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

    // Fills are merged into one path per layer so chunk edges leave no anti-aliasing seams.
    ctx.fillStyle = COLORS.grass;
    ctx.fill(merge(visible, 'runoff'));
    ctx.fillStyle = COLORS.gravel;
    ctx.fill(merge(visible, 'gravel'));

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
    ctx.fill(merge(visible, 'asphalt'));
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

    this.drawBrakeBoards(ctx, view);
    this.drawDrs(ctx);
  }

  private drawDrs(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.setLineDash([1, 1]);
    ctx.stroke(this.drsDetect);
    ctx.setLineDash([]);
    ctx.lineWidth = 0.8;
    ctx.stroke(this.drsStart);
    ctx.font = 'bold 3px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const l of this.drsLabels) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.angle);
      ctx.fillText('DRS', 0, 0);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
  }

  private drawBrakeBoards(ctx: CanvasRenderingContext2D, view?: ViewBounds): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 1.6px system-ui, sans-serif';
    for (const b of this.brakeBoards) {
      if (view && (b.x < view.minX - 5 || b.x > view.maxX + 5 || b.y < view.minY - 5 || b.y > view.maxY + 5)) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(b.x - 1.6, b.y - 1.1, 3.2, 2.2);
      ctx.fillStyle = '#111111';
      ctx.fillText(b.label, b.x, b.y + 0.1);
    }
    ctx.textBaseline = 'alphabetic';
  }

  static readonly backgroundColor = COLORS.outside;
}

interface BrakeBoard {
  x: number;
  y: number;
  label: string;
}

/** Boards 100 m and 50 m before each slow corner that follows a fast stretch, on both sides. */
function findBrakeBoards(track: Track): BrakeBoard[] {
  const ss = track.samples;
  const n = ss.length;
  const tight = (i: number) => Math.abs(ss[((i % n) + n) % n].curvature) >= 1 / 80;
  const fast = (i: number) => Math.abs(ss[((i % n) + n) % n].curvature) < 1 / 150;
  const boards: BrakeBoard[] = [];
  for (let i = 0; i < n; i++) {
    if (!tight(i) || tight(i - 1)) continue;
    // Needs a fast approach (samples are 2 m apart).
    let approach = true;
    for (let j = 8; j <= 30; j++) if (!fast(i - j)) approach = false;
    if (!approach) continue;
    for (const dist of [100, 50]) {
      const s = ss[(((i - dist / 2) % n) + n) % n];
      for (const side of [1, -1]) {
        const off = (s.halfWidth + KERB_WIDTH + 2.5) * side;
        boards.push({ x: s.x + s.nx * off, y: s.y + s.ny * off, label: String(dist) });
      }
    }
  }
  return boards;
}

function merge(chunks: Chunk[], layer: 'runoff' | 'gravel' | 'asphalt'): Path2D {
  const path = new Path2D();
  for (const c of chunks) path.addPath(c[layer]);
  return path;
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
