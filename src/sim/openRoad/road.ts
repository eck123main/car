import { mulberry } from './noise';
import type { Biome } from './biomes';

/** Distance between road samples (m). */
export const ROAD_SPACING = 4;
/** Half the width of the tarmac and the width of the shoulder either side (m). */
export const ROAD_HALF = 7;
export const SHOULDER = 1.5;

/** The road never points further than this from +x, so it can't cross itself and x always grows. */
export const MAX_HEADING = 1.12;
/** Metres of road made behind the start, for the mirrors. */
const ROAD_BEHIND = 6000;
/** Clear straight road round the start line (m). */
const START_CLEAR: [number, number] = [-300, 500];
/** Curves ease in and out over this distance at least (m). */
const MIN_EASE = 90;
/** The road looks this far ahead for hills to climb (m). */
const LOOK_AHEAD = 240;
/** Steepest change of slope, per metre: crests and dips stay gentle at 300 km/h. */
export const MAX_VERTICAL_CURVE = 0.00055;
/** Coarse step of the nearest-point search (samples). */
const COARSE = 16;
/** A point is looked for this far along the road at most (m). */
const SEARCH_RANGE = 3200;

export interface RoadWorld {
  /** The landscape in charge at this x. */
  biomeAt(x: number): Biome;
  /** How high the valley floor is here, and so roughly where the road wants to be. */
  floor(x: number, y: number): number;
}

/**
 * An endless road, made as it's needed from a seed. Corners ease in and out, the height follows
 * the valley floor but with limited slope and vertical curve, so it always stays calm.
 */
export class EndlessRoad {
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly z: number[] = [];
  readonly tx: number[] = [];
  readonly ty: number[] = [];
  /** Curvature (1/m, + = to the right). */
  readonly kappa: number[] = [];
  /** Rise per metre along the road. */
  readonly grade: number[] = [];
  /** Change of grade per metre (+ = a dip). */
  readonly vcurv: number[] = [];
  /** Samples whose height is known; only those count as road so far. */
  count = 0;
  /** Index of the sample where the drive starts. */
  readonly startIndex: number;

  private readonly rand: () => number;
  private heading = 0;
  private curv = 0;
  private target = 0;
  private ease = 1 / (MIN_EASE * 400);
  private left = 0;
  private gradeNow = 0;
  private curveNow = 0;

  constructor(
    seed: number,
    private readonly world: RoadWorld,
  ) {
    this.rand = mulberry(seed ^ 0x51ed27);
    this.x.push(-ROAD_BEHIND);
    this.y.push(0);
    this.tx.push(1);
    this.ty.push(0);
    this.kappa.push(0);
    this.ensure(1000);
    let i = 0;
    while (this.x[i] < 0) i++;
    this.startIndex = i;
  }

  /** Make the road at least as far as this x. */
  ensure(x: number): void {
    const look = Math.ceil(LOOK_AHEAD / ROAD_SPACING) + 1;
    while (this.count === 0 || this.x[this.count - 1] < x) {
      while (this.x.length < this.count + look) this.planNext();
      this.heightNext(look - 1);
    }
  }

  /** One more sample of the road's path. */
  private planNext(): void {
    const i = this.x.length - 1;
    const px = this.x[i];
    const py = this.y[i];
    if (px > START_CLEAR[0] && px < START_CLEAR[1]) {
      this.target = 0;
      this.left = 0;
    } else {
      this.left -= ROAD_SPACING;
      if (this.left <= 0) this.nextSection(px, py);
    }
    // Start unwinding in time not to pass the heading limit.
    const stop = (this.curv * this.curv) / (2 * this.ease);
    if (this.target !== 0 && this.curv !== 0 && Math.sign(this.curv) === Math.sign(this.target) && Math.sign(this.curv) * this.heading + stop >= MAX_HEADING) {
      this.target = 0;
      this.left = Math.max(this.left, 60);
    }
    const dk = this.ease * ROAD_SPACING;
    this.curv += Math.max(-dk, Math.min(dk, this.target - this.curv));
    this.heading += this.curv * ROAD_SPACING;
    const cx = Math.cos(this.heading);
    const cy = Math.sin(this.heading);
    this.x.push(px + cx * ROAD_SPACING);
    this.y.push(py + cy * ROAD_SPACING);
    this.tx.push(cx);
    this.ty.push(cy);
    this.kappa.push(this.curv);
  }

  /** Choose what the road does next: straight on, or a corner towards the lower ground. */
  private nextSection(x: number, y: number): void {
    const r = this.world.biomeAt(x).road;
    const between = ([a, b]: [number, number]) => a + (b - a) * this.rand();
    const wasCorner = this.target !== 0;
    if (wasCorner && this.rand() > r.esses) {
      this.target = 0;
      this.left = between(r.straight);
      return;
    }
    const radius = between(r.radius);
    const angle = (between(r.angle) * Math.PI) / 180;
    let dir: number;
    if (wasCorner) dir = -Math.sign(this.target);
    else {
      // Towards the lower ground, mostly, as roads do.
      const look = 700;
      const low = (d: number) => this.world.floor(x + Math.cos(this.heading + d * angle) * look, y + Math.sin(this.heading + d * angle) * look);
      const prefer = low(1) < low(-1) ? 1 : -1;
      dir = this.rand() < 0.72 ? prefer : -prefer;
    }
    // Never past the limit: turn back towards the middle when near it.
    if (Math.abs(this.heading + dir * angle) > MAX_HEADING) dir = -Math.sign(this.heading);
    this.target = dir / radius;
    const ease = Math.max(MIN_EASE, radius * 0.3);
    this.ease = 1 / (radius * ease);
    this.left = angle * radius + ease * 0.5;
  }

  /** Work out the height of the next sample, looking ahead up the planned road. */
  private heightNext(look: number): void {
    const i = this.count;
    const biome = this.world.biomeAt(this.x[i]);
    const targetAt = (k: number) => Math.max(3, this.world.floor(this.x[k], this.y[k]));
    const target = (targetAt(i + Math.floor(look / 3)) + targetAt(i + Math.floor((2 * look) / 3)) * 2 + targetAt(i + look) * 2) / 5;
    if (i === 0) {
      this.z.push(target);
      this.grade.push(0);
      this.vcurv.push(0);
      this.count = 1;
      return;
    }
    const want = Math.max(-biome.road.grade, Math.min(biome.road.grade, (target - this.z[i - 1]) / (LOOK_AHEAD * 0.65)));
    // The change of slope itself eases in, so nothing kicks at speed.
    const wantCurve = Math.max(-MAX_VERTICAL_CURVE, Math.min(MAX_VERTICAL_CURVE, (want - this.gradeNow) / 90));
    const stepC = MAX_VERTICAL_CURVE * (ROAD_SPACING / 40);
    this.curveNow += Math.max(-stepC, Math.min(stepC, wantCurve - this.curveNow));
    this.gradeNow += this.curveNow * ROAD_SPACING;
    this.z.push(this.z[i - 1] + this.gradeNow * ROAD_SPACING);
    this.grade.push(this.gradeNow);
    this.vcurv.push(this.curveNow);
    this.count = i + 1;
  }

  /** The sample nearest a point. With a hint (where it was last), only looks close to that. */
  nearest(x: number, y: number, hint: number | null = null): number {
    if (hint !== null && hint >= 0 && hint < this.count) {
      // A step at a time, downhill to the nearest sample.
      this.ensure(x + 200);
      let i = hint;
      let best = this.dist2(i, x, y);
      for (let moved = 0; moved < 400; moved++) {
        const up = i + 1 < this.count ? this.dist2(i + 1, x, y) : Infinity;
        const down = i > 0 ? this.dist2(i - 1, x, y) : Infinity;
        if (up < best && up <= down) {
          i++;
          best = up;
        } else if (down < best) {
          i--;
          best = down;
        } else return i;
      }
      return i;
    }
    this.ensure(x + SEARCH_RANGE);
    // x always grows along the road, so start level with the point and work out both ways.
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.x[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    let bestI = lo;
    let best = this.dist2(lo, x, y);
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let i = lo + dir * COARSE; i >= 0 && i < this.count; i += dir * COARSE) {
        const dx = Math.abs(this.x[i] - x);
        // Only as near as its x allows: past that, nothing further along can beat the best.
        if (dx * dx > best + 8192) break;
        const d = this.dist2(i, x, y);
        if (d < best) {
          best = d;
          bestI = i;
        }
      }
    }
    // Close in on it.
    const from = Math.max(0, bestI - COARSE);
    const to = Math.min(this.count - 1, bestI + COARSE);
    for (let i = from; i <= to; i++) {
      const d = this.dist2(i, x, y);
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    return bestI;
  }

  private dist2(i: number, x: number, y: number): number {
    const dx = this.x[i] - x;
    const dy = this.y[i] - y;
    return dx * dx + dy * dy;
  }

  /** Signed distance to the right of the road at sample i (m). */
  lateral(i: number, x: number, y: number): number {
    return -(x - this.x[i]) * this.ty[i] + (y - this.y[i]) * this.tx[i];
  }

  /** Distance along the road past sample i (m). */
  along(i: number, x: number, y: number): number {
    return (x - this.x[i]) * this.tx[i] + (y - this.y[i]) * this.ty[i];
  }
}
