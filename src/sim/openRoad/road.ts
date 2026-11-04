import { mulberry } from './noise';
import type { Biome } from './biomes';

/** Distance between road samples (m). */
export const ROAD_SPACING = 4;
/** Half the width of the tarmac and the width of the shoulder either side (m). */
export const ROAD_HALF = 7;
export const SHOULDER = 1.5;

/**
 * The road never points further than this from +x, so it can't cross itself and x always grows.
 * Hairpins stay legal: they swing from one side through straight ahead to the other.
 */
export const MAX_HEADING = 1.42;
/** Ordinary corners stop here; only the zigzags up a climb go all the way to MAX_HEADING. */
const CORNER_HEADING = 1.2;
/** Metres of road made behind the start, for the mirrors. */
const ROAD_BEHIND = 6000;
/** Clear straight road round the start line (m). */
const START_CLEAR: [number, number] = [-300, 500];
/** Curves ease in and out over this distance at least (m). */
const MIN_EASE = 45;
/** Hairpins ease in quicker: there's so little of them. */
const HAIRPIN_EASE = 26;
/** Most hairpins in one climb or descent, however big the hill. */
const MAX_HAIRPINS = 9;
/** A zigzag ends when the land ahead is less steep than this share of what started it. */
const ZIG_END = 0.6;
/** How far ahead the road reads the slope of the land (m). */
const SLOPE_LOOK = 240;
/** Legs of a zigzag aren't all the same: the road points anywhere from this to MAX_HEADING. */
const ZIG_HEADING_MIN = 1.1;
/** Straights aren't ruled lines: they drift this gently, if at all (radius, m). */
const DRIFT_RADIUS: [number, number] = [2200, 7000];
/** A corner carries on the same way (a double apex or a tightening bend) this often. */
const SAME_WAY = 0.28;
/** The road looks this far ahead for hills to climb (m). */
const LOOK_AHEAD = 240;
/** Steepest change of slope, per metre: crests and dips you can feel, still driveable at 300 km/h. */
export const MAX_VERTICAL_CURVE = 0.0008;
/** Coarse step of the nearest-point search (samples). */
const COARSE = 8;
/** A point is looked for this far along the road at most (m). */
const SEARCH_RANGE = 3200;
/** With a hint: further off the road than this, the car may be nearer another stretch of it (m). */
const HINT_TRUSTED = 26;

/** Tighter than this radius a bend gets a fence on the outside and warning signs (m). */
export const TIGHT_RADIUS = 110;
/** A fence, once it starts, runs at least this many samples. */
const FENCE_HOLD = 30;
/** Fences look at corners this far ahead (samples), so they start before them. */
const FENCE_LEAD = 12;
/** Land this far under the road, a little way off it, gets a fence (m). */
const DROP_FENCE = 7;
/** How far from the road's centre a fence stands (m). */
export const FENCE_OFFSET = ROAD_HALF + SHOULDER + 2.2;
/** Fence bits per sample. */
export const FENCE_LEFT = 1;
export const FENCE_RIGHT = 2;

/** Samples after a zigzag that still count as beside it. */
const AFTER_ZIG = 60;

export interface RoadWorld {
  /** The landscape in charge at this x. */
  biomeAt(x: number): Biome;
  /** How high the valley floor is here, and so roughly where the road wants to be. */
  floor(x: number, y: number): number;
  /** How twisty the road wants to be along here (0-1). */
  twist(x: number): number;
  /** How far a hill lifts the land here (m). */
  hill(x: number, y: number): number;
}

/**
 * An endless road, made as it's needed from a seed. Corners ease in and out, the height follows
 * the valley floor but with limited slope and vertical curve. Hills too steep to drive straight
 * up are climbed in zigzags with hairpins at the ends.
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
  /** Which sides have a fence (FENCE_LEFT, FENCE_RIGHT). */
  readonly fence: number[] = [];
  /** 1 where the road is part of a zigzag, with other legs close by. */
  readonly zigzag: number[] = [];
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
  /** The heading the corner in progress ends on; null on a straight. */
  private toHeading: number | null = null;
  /** Which way it set off turning: a small overshoot must not read as more to turn the other way. */
  private turnWay = 1;
  /** A zigzag in progress: the next hairpin's way and how many so far. */
  private zigging = false;
  private zigDir = 1;
  private zigCount = 0;
  private zigLegNext = false;
  /** Samples still counted as part of the zigzag just finished. */
  private afterZig = 0;
  private readonly fenceHold = [0, 0];
  private lastWasCorner = false;
  private lastDir = 1;
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
    this.zigzag.push(0);
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
      this.toHeading = null;
      this.zigging = false;
      // (A gentle drift's slow ease mustn't carry a bend onto the start straight.)
      this.ease = Math.max(this.ease, 1 / (200 * MIN_EASE));
    } else if (this.toHeading !== null) {
      // Start unwinding in time to end on the corner's heading.
      const stop = Math.sign(this.curv) === this.turnWay ? (this.curv * this.curv) / (2 * this.ease) : 0;
      if (this.turnWay * (this.toHeading - this.heading) <= stop) this.target = 0;
      if (this.target === 0 && this.curv === 0) {
        this.toHeading = null;
        this.nextSection(px, py);
      }
    } else {
      // A long straight that has been drifting mustn't drift past the heading limit.
      if (this.target !== 0 && Math.sign(this.target) === Math.sign(this.heading) && Math.abs(this.heading) > 0.9) this.target = 0;
      this.left -= ROAD_SPACING;
      if (this.left <= 0) this.nextSection(px, py);
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
    this.zigzag.push(this.zigging || this.afterZig > 0 ? 1 : 0);
    if (!this.zigging && this.afterZig > 0) this.afterZig--;
    if (this.zigging) this.afterZig = AFTER_ZIG;
  }

  /** Turn until the road points this way. */
  private turnTo(heading: number, radius: number, ease: number): void {
    const way = Math.sign(heading - this.heading);
    if (way === 0) {
      this.left = 0;
      return;
    }
    this.toHeading = heading;
    this.turnWay = way;
    this.target = way / radius;
    this.ease = 1 / (radius * ease);
  }

  /** How steep the land is on the road's general way (+x) from a point, up or down. */
  private steepness(x: number, y: number): number {
    return Math.abs(this.world.floor(x + SLOPE_LOOK / 2, y) - this.world.floor(x - SLOPE_LOOK / 2, y)) / SLOPE_LOOK;
  }

  /** Choose what the road does next: straight on, a corner, or a zigzag up the hill ahead. */
  private nextSection(x: number, y: number): void {
    const r = this.world.biomeAt(x).road;
    if (this.zigging) {
      this.nextOfZigzag(x, y);
      return;
    }
    // Straighten up for the start line, so the drive begins looking down the road.
    if (x < START_CLEAR[0] && x > START_CLEAR[0] - 1200) {
      this.target = 0;
      if (Math.abs(this.heading) > 0.01) this.turnTo(0, 500, MIN_EASE * 2);
      else this.left = 80;
      return;
    }
    // Too steep to drive straight up: the land makes the road zigzag. Only past the start's calm.
    if (x > START_CLEAR[1] && this.steepness(x, y) > r.zigFrom) {
      this.zigging = true;
      // Coast roads swing away from the sea first.
      this.zigDir = this.world.biomeAt(x).land.sea ? -1 : this.rand() < 0.5 ? 1 : -1;
      this.zigCount = 0;
      this.zigLegNext = false;
      this.nextOfZigzag(x, y);
      return;
    }
    // Open or twisty, wherever this stretch of country falls: skew each range to that end.
    const twist = this.world.twist(x);
    const toLow = (range: [number, number]) => range[0] + (range[1] - range[0]) * Math.pow(this.rand(), 0.6 + 3.4 * twist);
    const toHigh = (range: [number, number]) => range[1] - (range[1] - range[0]) * Math.pow(this.rand(), 0.8 + 2.4 * twist);
    const wasCorner = this.lastWasCorner;
    if (wasCorner && this.rand() > r.esses * (0.35 + 0.65 * twist)) {
      this.lastWasCorner = false;
      this.left = this.clearStraight(x, y, toLow(r.straight));
      this.drift();
      return;
    }
    const radius = toLow(r.radius);
    const angle = (toHigh(r.angle) * Math.PI) / 180;
    let dir: number;
    if (wasCorner) dir = this.rand() < SAME_WAY ? this.lastDir : -this.lastDir;
    else {
      // Towards the lower ground, mostly, as roads do.
      const look = 700;
      const low = (d: number) => this.world.floor(x + Math.cos(this.heading + d * angle) * look, y + Math.sin(this.heading + d * angle) * look);
      const prefer = low(1) < low(-1) ? 1 : -1;
      dir = this.rand() < 0.72 ? prefer : -prefer;
    }
    // Never past the limit: turn back towards the middle when near it.
    if (Math.abs(this.heading + dir * angle) > CORNER_HEADING) dir = -Math.sign(this.heading) || 1;
    const heading = Math.max(-CORNER_HEADING, Math.min(CORNER_HEADING, this.heading + dir * angle));
    this.lastDir = dir;
    this.lastWasCorner = true;
    this.turnTo(heading, radius, Math.max(MIN_EASE, radius * 0.3));
  }

  /** A straight only runs until the land ahead makes the road do something about it. */
  private clearStraight(x: number, y: number, length: number): number {
    const r = this.world.biomeAt(x).road;
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    for (let d = 80; d < length; d += 80) {
      if (this.steepness(x + c * d, y + s * d) > r.zigFrom) return d;
    }
    return length;
  }

  /** Most straights aren't quite: a slow drift one way, back towards the middle if it has wandered. */
  private drift(): void {
    if (this.rand() < 0.3) {
      this.target = 0;
      return;
    }
    const radius = DRIFT_RADIUS[0] + (DRIFT_RADIUS[1] - DRIFT_RADIUS[0]) * this.rand();
    const way = Math.abs(this.heading) > 0.5 ? -Math.sign(this.heading) : this.rand() < 0.5 ? 1 : -1;
    this.target = way / radius;
    this.ease = 1 / (radius * MIN_EASE * 2);
  }

  /**
   * Hairpin, leg, hairpin, leg... for as long as the land stays steep. Each is its own: the radius,
   * the length of the leg and how far round it swings. One hairpin alone is a big turn up a hillside.
   */
  private nextOfZigzag(x: number, y: number): void {
    const r = this.world.biomeAt(x).road;
    const between = ([a, b]: [number, number]) => a + (b - a) * this.rand();
    if (this.zigLegNext) {
      this.zigLegNext = false;
      this.target = 0;
      this.left = between(r.leg);
      return;
    }
    if (this.zigCount >= MAX_HAIRPINS || (this.zigCount > 0 && this.steepness(x, y) < r.zigFrom * ZIG_END)) {
      this.zigging = false;
      this.lastWasCorner = true;
      this.lastDir = -Math.sign(this.heading) || 1;
      this.turnTo(0, between(r.hairpin) * 2, MIN_EASE);
      return;
    }
    this.turnTo(this.zigDir * (ZIG_HEADING_MIN + (MAX_HEADING - ZIG_HEADING_MIN) * this.rand()), between(r.hairpin), HAIRPIN_EASE);
    this.zigDir = -this.zigDir;
    this.zigCount++;
    this.zigLegNext = true;
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
      this.fence.push(0);
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
    this.fence.push(this.fenceHere(i, biome.road.fence.hillFrom));
    this.count = i + 1;
  }

  /** Fences where it matters: over hills, round the outside of tight bends, and along drops. */
  private fenceHere(i: number, hillFrom: number): number {
    const x = this.x[i];
    const y = this.y[i];
    const over = this.world.hill(x, y) > hillFrom;
    const k = this.kappa[Math.min(this.kappa.length - 1, i + FENCE_LEAD)];
    const tight = Math.abs(k) > 1 / TIGHT_RADIUS || Math.abs(this.kappa[i]) > 1 / TIGHT_RADIUS;
    const way = Math.sign(k) || Math.sign(this.kappa[i]);
    let bits = 0;
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      // A bend to the right (+) has its outside on the left.
      let wanted = over || (tight && way === -side);
      if (!wanted && i % 4 === 0) {
        const fx = x - this.ty[i] * 34 * side;
        const fy = y + this.tx[i] * 34 * side;
        wanted = this.z[i] - this.world.floor(fx, fy) > DROP_FENCE;
      }
      if (wanted) this.fenceHold[s] = FENCE_HOLD;
      if (this.fenceHold[s] > 0) {
        this.fenceHold[s]--;
        bits |= s === 0 ? FENCE_LEFT : FENCE_RIGHT;
      }
    }
    return bits;
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
        } else break;
      }
      // Well off the road, another leg of a zigzag may be nearer than this one.
      if (best <= HINT_TRUSTED * HINT_TRUSTED) return i;
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

  /**
   * In a zigzag: the nearest sample of a different stretch of road than sample i, which is d metres
   * from this point. -1 if there's none worth knowing about.
   */
  otherStretch(i: number, x: number, y: number, d: number): number {
    if (!this.zigzag[i]) return -1;
    const gap = Math.ceil((1.6 * d + 20) / ROAD_SPACING);
    const reach = 2.5 * d + 10;
    let best = reach * reach;
    let found = -1;
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let k = i + dir * gap; k >= 0 && k < this.count; k += dir * 2) {
        if (Math.abs(this.x[k] - x) > reach) break;
        const q = this.dist2(k, x, y);
        if (q < best) {
          best = q;
          found = k;
        }
      }
    }
    return found;
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
