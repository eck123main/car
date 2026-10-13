import type { Track, TrackSample } from '../track/track';
import type { ViewBounds } from './camera';

/**
 * Static scenery around a track: grandstands with a crowd along the main straight and at the
 * big braking zones, the pit garages, tyre walls, tree clumps and patches of rougher grass.
 * Everything is built once per track and nothing moves; only what is on screen gets drawn.
 * It is placed clear of every part of the track (walls and pit lane included), so it never
 * covers anything a driver needs to see.
 */

const COLORS = {
  patch: '#22421f',
  treeShadow: '#142b13',
  tree: '#2b5427',
  treeLight: '#37682f',
  standFrame: '#4f555c',
  standRoof: '#c9ced3',
  building: '#8d939a',
  buildingRoof: '#b5bac0',
  garageDoor: '#3b3f45',
  tyres: '#1a1a1a',
  tyreRim: '#4a4a4a',
};
/** Seat colours, one per stand. */
const SEATS = ['#2f5fa8', '#a83232', '#6d6f73', '#2f8a5a', '#c48a1c'];
/** Shirt colours in the crowd. */
const CROWD = ['#e8e8e8', '#d22b2b', '#ff8a00', '#1f5fd1', '#f2d22e', '#1b1b1b', '#27a35a'];

/** Grandstand depth (m), and the space between the wall and its front (m). */
const STAND_DEPTH = 11;
const STAND_GAP = 6;
const ROW_SPACING = 1.7;
/** Corner grandstands: at most this many, this far apart along the lap (m). */
const MAX_CORNER_STANDS = 4;
const CORNER_STAND_SPACING = 400;
/** Trees: one candidate spot per this many metres, kept this far (m) from any wall; scenery goes about SCENERY_REACH (m) out from the track. */
const TREE_STEP = 9;
const TREE_CLEARANCE = 9;
const SCENERY_REACH = 260;
/** Scenery is bucketed into square cells this big (m) so only visible cells are drawn. */
const CELL = 160;

interface Layers {
  patches: Path2D;
  treeShadow: Path2D;
  trees: Path2D;
  treeLight: Path2D;
  tyres: Path2D;
  buildings: Path2D;
  buildingRoofs: Path2D;
  garageDoors: Path2D;
  standFrames: Path2D;
  standRoofs: Path2D;
  seats: Path2D[];
  crowd: Path2D[];
}

interface Cell {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  layers: Layers;
}

function newLayers(): Layers {
  return {
    patches: new Path2D(),
    treeShadow: new Path2D(),
    trees: new Path2D(),
    treeLight: new Path2D(),
    tyres: new Path2D(),
    buildings: new Path2D(),
    buildingRoofs: new Path2D(),
    garageDoors: new Path2D(),
    standFrames: new Path2D(),
    standRoofs: new Path2D(),
    seats: SEATS.map(() => new Path2D()),
    crowd: CROWD.map(() => new Path2D()),
  };
}

export class Scenery {
  private readonly cells = new Map<string, Cell>();
  private readonly clear: Clearance;
  private readonly seed: number;
  /** Points covered by buildings and stands, which trees keep clear of. */
  private readonly occupied: [number, number][] = [];

  constructor(readonly track: Track) {
    this.clear = new Clearance(track);
    this.seed = hashString(track.name);
    // Buildings first: patches and trees keep out of their way.
    this.addPitBuilding();
    this.addMainStands();
    this.addCornerStands();
    this.addPatches();
    this.addTrees();
  }

  draw(ctx: CanvasRenderingContext2D, view?: ViewBounds): void {
    const cells = [...this.cells.values()].filter(
      (c) => !view || (c.maxX >= view.minX && c.minX <= view.maxX && c.maxY >= view.minY && c.minY <= view.maxY),
    );
    const fill = (pick: (l: Layers) => Path2D, color: string) => {
      ctx.fillStyle = color;
      for (const c of cells) ctx.fill(pick(c.layers));
    };
    fill((l) => l.patches, COLORS.patch);
    fill((l) => l.treeShadow, COLORS.treeShadow);
    fill((l) => l.trees, COLORS.tree);
    fill((l) => l.treeLight, COLORS.treeLight);

    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = COLORS.tyres;
    for (const c of cells) ctx.stroke(c.layers.tyres);
    ctx.setLineDash([0.6, 0.7]);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = COLORS.tyreRim;
    for (const c of cells) ctx.stroke(c.layers.tyres);
    ctx.setLineDash([]);

    fill((l) => l.buildings, COLORS.building);
    fill((l) => l.buildingRoofs, COLORS.buildingRoof);
    fill((l) => l.garageDoors, COLORS.garageDoor);
    fill((l) => l.standFrames, COLORS.standFrame);
    SEATS.forEach((color, i) => fill((l) => l.seats[i], color));
    CROWD.forEach((color, i) => fill((l) => l.crowd[i], color));
    fill((l) => l.standRoofs, COLORS.standRoof);
  }

  /** The layers of the cell holding a point, growing that cell's bounds to cover `pad` around it. */
  private at(x: number, y: number, pad: number): Layers {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const key = `${cx},${cy}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, layers: newLayers() };
      this.cells.set(key, cell);
    }
    cell.minX = Math.min(cell.minX, x - pad);
    cell.minY = Math.min(cell.minY, y - pad);
    cell.maxX = Math.max(cell.maxX, x + pad);
    cell.maxY = Math.max(cell.maxY, y + pad);
    return cell.layers;
  }

  private rand(...k: number[]): number {
    let h = this.seed;
    for (const v of k) h = Math.imul(h ^ Math.floor(v * 1000), 2654435761) ^ (h >>> 13);
    return ((h >>> 0) % 100000) / 100000;
  }

  /** Large, soft patches of slightly lighter grass, so the land around the track isn't flat. */
  private addPatches(): void {
    const b = this.clear.bounds;
    const step = 110;
    for (let x = b.minX; x < b.maxX; x += step) {
      for (let y = b.minY; y < b.maxY; y += step) {
        if (this.rand(x, y, 1) < 0.55) continue;
        const px = x + this.rand(x, y, 2) * step;
        const py = y + this.rand(x, y, 3) * step;
        const r = 30 + this.rand(x, y, 4) * 45;
        if (!this.clear.near(px, py) || this.clear.distance(px, py, r + 5) < r + 5) continue;
        if (this.occupied.some(([ox, oy]) => Math.hypot(ox - px, oy - py) < r + 4)) continue;
        blob(this.at(px, py, r * 1.3).patches, px, py, r, (k) => this.rand(px, py, k));
      }
    }
  }

  /** Clumps of trees: dense in some places, none in others. */
  private addTrees(): void {
    const b = this.clear.bounds;
    for (let x = b.minX; x < b.maxX; x += TREE_STEP) {
      for (let y = b.minY; y < b.maxY; y += TREE_STEP) {
        // Low-frequency "woodland" value, so trees form clumps and lines rather than an even spread.
        const wood = smoothNoise(x / 140, y / 140, this.seed);
        if (wood < 0.58 || this.rand(x, y, 5) > (wood - 0.58) * 3) continue;
        const px = x + (this.rand(x, y, 6) - 0.5) * TREE_STEP;
        const py = y + (this.rand(x, y, 7) - 0.5) * TREE_STEP;
        const r = 2.6 + this.rand(x, y, 8) * 2.8;
        if (!this.clear.near(px, py) || this.clear.distance(px, py, TREE_CLEARANCE + r) < TREE_CLEARANCE + r) continue;
        if (this.occupied.some(([ox, oy]) => Math.abs(ox - px) < r + 6 && Math.abs(oy - py) < r + 6)) continue;
        const l = this.at(px, py, r + 2);
        circle(l.treeShadow, px + 0.9, py + 0.9, r);
        circle(l.trees, px, py, r);
        circle(l.treeLight, px - r * 0.3, py - r * 0.3, r * 0.45);
      }
    }
  }

  /** Garages behind the pit lane, the length of the pit wall. */
  private addPitBuilding(): void {
    const pit = this.track.pit;
    if (!pit) return;
    const side = pit.side;
    const run = this.samplesBetween(pit.wallStart, pit.wallEnd);
    if (run.length < 4) return;
    const wall = Math.max(...run.map((t) => wallOn(t, side)));
    const near = wall + 2;
    const depth = 12;
    const ok = run.every((t) => this.clear.isClear(...offset(t, side, near + depth), 1.5));
    if (!ok) return;
    const pts = (o: number) => run.map((t) => offset(t, side, o));
    this.band((l) => l.buildings, pts(near), pts(near + depth));
    this.band((l) => l.buildingRoofs, pts(near + depth * 0.45), pts(near + depth));
    // A garage door for every few metres of building, facing the pit lane.
    for (let i = 0; i + 3 < run.length; i += 4) {
      const a = offset(run[i], side, near);
      const b = offset(run[i + 3], side, near);
      const c = offset(run[i + 3], side, near + 2.5);
      const d = offset(run[i], side, near + 2.5);
      quad(this.at(a[0], a[1], 8).garageDoors, a, b, c, d);
    }
  }

  /** The main grandstand opposite the pits, along the start/finish straight. */
  private addMainStands(): void {
    const L = this.track.length;
    const side = this.track.pit ? (-this.track.pit.side as 1 | -1) : -1;
    this.placeStand(L - 45, 90, side, 0);
    // A second, shorter stand on the pit side, past the garages.
    if (this.track.pit) this.placeStand(this.track.pit.wallEnd + 30, 70, this.track.pit.side, 1);
  }

  /** Stands on the outside of the heaviest braking zones (slow corners after a fast run). */
  private addCornerStands(): void {
    const ss = this.track.samples;
    const n = ss.length;
    const tight = (i: number) => Math.abs(ss[((i % n) + n) % n].curvature) >= 1 / 90;
    const fast = (i: number) => Math.abs(ss[((i % n) + n) % n].curvature) < 1 / 150;
    const placed: number[] = [];
    let colour = 2;
    for (let i = 0; i < n && placed.length < MAX_CORNER_STANDS; i++) {
      if (!tight(i) || tight(i - 1)) continue;
      let approach = true;
      for (let j = 6; j <= 30; j++) if (!fast(i - j)) approach = false;
      if (!approach) continue;
      const s = ss[i].s;
      if (placed.some((p) => Math.min(Math.abs(p - s), this.track.length - Math.abs(p - s)) < CORNER_STAND_SPACING)) continue;
      if (this.track.pit && this.track.inRange(s, this.track.pit.entry - 60, this.track.pit.exit + 60)) continue;
      // Outside of the corner: curvature > 0 turns right, so the outside is on the left.
      const outside = ss[(i + 8) % n].curvature > 0 ? -1 : 1;
      // Tyre wall where a car that misses its braking point ends up.
      this.addTyreWall(s - 10, s + 50, outside);
      // The stand faces the braking zone, from just before the turn-in.
      if (this.placeStand(s - 70, 60, outside, colour, 40)) {
        placed.push(s);
        colour++;
      }
    }
  }

  /** A stand starting near `from`: tries spots further along and back (up to `search` m) until one fits. */
  private placeStand(from: number, length: number, side: 1 | -1, colour: number, search = 120): boolean {
    for (let k = 0; k * 15 <= search; k++) {
      if (this.addStand(from + k * 15, length, side, colour)) return true;
      if (k > 0 && this.addStand(from - k * 15, length, side, colour)) return true;
    }
    return false;
  }

  private addTyreWall(from: number, to: number, side: 1 | -1): void {
    const run = this.samplesBetween(from, to);
    if (run.length < 3) return;
    const pts = run.map((t) => offset(t, side, wallOn(t, side) + 1));
    if (!pts.every(([x, y]) => this.clear.isClear(x, y, 0.2))) return;
    const [x0, y0] = pts[Math.floor(pts.length / 2)];
    const path = this.at(x0, y0, 80).tyres;
    pts.forEach(([x, y], k) => (k === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  }

  /**
   * A grandstand alongside the track from lap distance `from`, `length` metres long, rows of
   * seats with a crowd and a roof over the back rows. Skipped if it wouldn't fit.
   */
  private addStand(from: number, length: number, side: 1 | -1, colour: number): boolean {
    const run = this.samplesBetween(from, from + length);
    if (run.length < 6) return false;
    const near = Math.max(...run.map((t) => wallOn(t, side))) + STAND_GAP;
    const far = near + STAND_DEPTH;
    // Only where the track runs fairly straight: a stand bent round a tight corner looks odd.
    const turn = Math.abs(Math.atan2(run[0].tx * run.at(-1)!.ty - run[0].ty * run.at(-1)!.tx, run[0].tx * run.at(-1)!.tx + run[0].ty * run.at(-1)!.ty));
    if (turn > 0.6) return false;
    for (const t of run) {
      for (const o of [near, (near + far) / 2, far]) if (!this.clear.isClear(...offset(t, side, o), 2)) return false;
    }
    const pts = (o: number) => run.map((t) => offset(t, side, o));
    const seat = colour % SEATS.length;
    this.band((l) => l.standFrames, pts(near - 0.6), pts(far));
    this.band((l) => l.seats[seat], pts(near), pts(far - 0.4));
    // Rows of spectators, about a metre apart, with some empty seats.
    const rows = Math.floor((STAND_DEPTH - 3.5) / ROW_SPACING);
    for (let r = 0; r < rows; r++) {
      const o = near + 0.9 + r * ROW_SPACING;
      for (let k = 0; k + 1 < run.length; k++) {
        for (const f of [0.25, 0.75]) {
          if (this.rand(run[k].s, o, f) < 0.22) continue;
          const [ax, ay] = offset(run[k], side, o);
          const [bx, by] = offset(run[k + 1], side, o);
          const x = ax + (bx - ax) * f;
          const y = ay + (by - ay) * f;
          const shirt = Math.floor(this.rand(x, y, 9) * CROWD.length);
          circle(this.at(x, y, 1).crowd[shirt], x, y, 0.38);
        }
      }
    }
    this.band((l) => l.standRoofs, pts(far - 3.2), pts(far));
    return true;
  }

  /** A closed band between two polylines, stored in the cell of its middle. */
  private band(pick: (l: Layers) => Path2D, a: [number, number][], b: [number, number][]): void {
    const all = [...a, ...b];
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + 2;
    for (const p of all) this.occupied.push(p);
    const path = pick(this.at(cx, cy, pad));
    a.forEach(([x, y], k) => (k === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    for (let k = b.length - 1; k >= 0; k--) path.lineTo(b[k][0], b[k][1]);
    path.closePath();
  }

  /** Samples from lap distance `from` to `to` (wrapping past the line). */
  private samplesBetween(from: number, to: number): TrackSample[] {
    const ss = this.track.samples;
    const n = ss.length;
    const L = this.track.length;
    const start = Math.floor((((from % L) + L) % L) / 2);
    const count = Math.round(this.track.forwardDistance(((from % L) + L) % L, ((to % L) + L) % L) / 2);
    const out: TrackSample[] = [];
    for (let k = 0; k <= count; k++) out.push(ss[(start + k) % n]);
    return out;
  }
}

function wallOn(t: TrackSample, side: 1 | -1): number {
  return side > 0 ? t.wallR : t.wallL;
}

function offset(t: TrackSample, side: 1 | -1, o: number): [number, number] {
  return [t.x + t.nx * o * side, t.y + t.ny * o * side];
}

/**
 * How far a point is from the track (from the walls or the pit lane, of any part of the
 * lap). Samples are bucketed so each lookup only checks the ones nearby.
 */
class Clearance {
  private readonly bins = new Map<string, number[]>();
  private readonly reach: number;
  private readonly nearBins = new Set<string>();
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number };
  private static readonly BIN = 40;

  constructor(private readonly track: Track) {
    let reach = 0;
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    track.samples.forEach((t, i) => {
      reach = Math.max(reach, t.wallR, t.wallL);
      const key = `${Math.floor(t.x / Clearance.BIN)},${Math.floor(t.y / Clearance.BIN)}`;
      (this.bins.get(key) ?? this.bins.set(key, []).get(key)!).push(i);
      b.minX = Math.min(b.minX, t.x);
      b.minY = Math.min(b.minY, t.y);
      b.maxX = Math.max(b.maxX, t.x);
      b.maxY = Math.max(b.maxY, t.y);
    });
    this.reach = reach;
    const span = Math.ceil(SCENERY_REACH / Clearance.BIN);
    for (const key of this.bins.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) this.nearBins.add(`${kx + i},${ky + j}`);
    }
    this.bounds = { minX: b.minX - SCENERY_REACH, minY: b.minY - SCENERY_REACH, maxX: b.maxX + SCENERY_REACH, maxY: b.maxY + SCENERY_REACH };
  }

  /**
   * Distance (m) from a point to the edge of the track area (the walls), negative inside it.
   * Only looks `limit` metres out: anything further away returns `limit`.
   */
  distance(x: number, y: number, limit = 30): number {
    const span = Math.ceil((limit + this.reach) / Clearance.BIN);
    const bx = Math.floor(x / Clearance.BIN);
    const by = Math.floor(y / Clearance.BIN);
    const ss = this.track.samples;
    let best = limit;
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        const list = this.bins.get(`${bx + i},${by + j}`);
        if (!list) continue;
        for (const k of list) {
          const t = ss[k];
          const dx = x - t.x;
          const dy = y - t.y;
          const along = dx * t.tx + dy * t.ty;
          const across = dx * t.nx + dy * t.ny;
          // Beside this sample: distance past the wall on that side; otherwise from its end.
          const wall = across >= 0 ? t.wallR : t.wallL;
          const d = Math.abs(along) <= 1.2 ? Math.abs(across) - wall : Math.hypot(Math.abs(along) - 1.2, Math.max(0, Math.abs(across) - wall));
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  /** Roughly within SCENERY_REACH of the track (to the nearest bin). */
  near(x: number, y: number): boolean {
    return this.nearBins.has(`${Math.floor(x / Clearance.BIN)},${Math.floor(y / Clearance.BIN)}`);
  }

  /** At least `margin` metres outside the walls of every part of the track. */
  isClear(x: number, y: number, margin: number): boolean {
    return this.distance(x, y) >= margin;
  }
}

function circle(path: Path2D, x: number, y: number, r: number): void {
  path.moveTo(x + r, y);
  path.arc(x, y, r, 0, Math.PI * 2);
}

/** A lumpy round patch. */
function blob(path: Path2D, x: number, y: number, r: number, rand: (k: number) => number): void {
  const n = 12;
  for (let k = 0; k <= n; k++) {
    const a = (k % n) * ((Math.PI * 2) / n);
    const rr = r * (0.75 + 0.35 * rand(20 + (k % n)));
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (k === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
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

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Smooth value noise in 0..1 (bilinear between hashed grid points). */
function smoothNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const h = (i: number, j: number) => {
    let v = Math.imul(i * 374761393 + j * 668265263, 1274126177) ^ seed;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx;
  const bottom = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}
