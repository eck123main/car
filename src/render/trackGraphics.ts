import { KERB_WIDTH, type Track, type TrackSample } from '../track/track';

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

/** Pre-built Path2D shapes for a track, drawn in world metres. */
export class TrackGraphics {
  private readonly runoff = new Path2D();
  private readonly gravel = new Path2D();
  private readonly kerbRed = new Path2D();
  private readonly kerbWhite = new Path2D();
  private readonly asphalt = new Path2D();
  private readonly edgeLines = new Path2D();
  private readonly walls = new Path2D();
  private readonly startLine: Path2D[] = [new Path2D(), new Path2D()];

  constructor(readonly track: Track) {
    const ss = track.samples;
    const n = ss.length;
    const loop = (path: Path2D, f: (s: TrackSample) => [number, number]) => {
      ss.forEach((s, i) => {
        const [x, y] = f(s);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
    };

    loop(this.runoff, (s) => edge(s, 'R', s.wallR));
    loop(this.runoff, (s) => edge(s, 'L', s.wallL));
    loop(this.asphalt, (s) => edge(s, 'R', s.halfWidth));
    loop(this.asphalt, (s) => edge(s, 'L', s.halfWidth));
    loop(this.edgeLines, (s) => edge(s, 'R', s.halfWidth - 0.4));
    loop(this.edgeLines, (s) => edge(s, 'L', s.halfWidth - 0.4));
    loop(this.walls, (s) => edge(s, 'R', s.wallR));
    loop(this.walls, (s) => edge(s, 'L', s.wallL));

    for (let i = 0; i < n; i++) {
      const a = ss[i];
      const b = ss[(i + 1) % n];
      for (const side of ['R', 'L'] as Side[]) {
        const wa = side === 'R' ? a.wallR : a.wallL;
        const wb = side === 'R' ? b.wallR : b.wallL;
        if ((side === 'R' ? a.surfR : a.surfL) === 'gravel') {
          quad(this.gravel, edge(a, side, a.halfWidth), edge(b, side, b.halfWidth), edge(b, side, wb), edge(a, side, wa));
        }
        if (side === 'R' ? a.kerbR : a.kerbL) {
          quad(
            i % 2 === 0 ? this.kerbRed : this.kerbWhite,
            edge(a, side, a.halfWidth - 0.2),
            edge(b, side, b.halfWidth - 0.2),
            edge(b, side, b.halfWidth + KERB_WIDTH),
            edge(a, side, a.halfWidth + KERB_WIDTH),
          );
        }
      }
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

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.grass;
    ctx.fill(this.runoff, 'evenodd');
    fillAndSeal(ctx, this.gravel, COLORS.gravel);
    fillAndSeal(ctx, this.kerbRed, COLORS.kerbRed);
    fillAndSeal(ctx, this.kerbWhite, COLORS.kerbWhite);
    ctx.fillStyle = COLORS.asphalt;
    ctx.fill(this.asphalt, 'evenodd');

    ctx.lineWidth = 0.25;
    ctx.strokeStyle = COLORS.edgeLine;
    ctx.stroke(this.edgeLines);

    ctx.fillStyle = '#ffffff';
    ctx.fill(this.startLine[0]);
    ctx.fillStyle = '#111111';
    ctx.fill(this.startLine[1]);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = COLORS.wallEdge;
    ctx.stroke(this.walls);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = COLORS.wall;
    ctx.stroke(this.walls);
  }

  static readonly backgroundColor = COLORS.outside;
}

function quad(path: Path2D, a: [number, number], b: [number, number], c: [number, number], d: [number, number]): void {
  path.moveTo(a[0], a[1]);
  path.lineTo(b[0], b[1]);
  path.lineTo(c[0], c[1]);
  path.lineTo(d[0], d[1]);
  path.closePath();
}

/** Fill, then stroke thinly in the same colour to hide anti-aliasing seams between quads. */
function fillAndSeal(ctx: CanvasRenderingContext2D, path: Path2D, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.15;
  ctx.fill(path);
  ctx.stroke(path);
}
