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
/** Most hairpins in one climb or descent, however wide the hill. */
const MAX_HAIRPINS = 7;
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

/** Samples after a zigzag that still count as beside it. */
const AFTER_ZIG = 60;

/** A stretch of a hill the road zigzags up or down, by x. */
export interface ClimbZone {
  from: number;
  to: number;
}

export interface RoadWorld {
  /** The landscape in charge at this x. */
  biomeAt(x: number): Biome;
  /** How high the valley floor is here, and so roughly where the road wants to be. */
  floor(x: number, y: number): number;
  /** The next stretch at or past this x that's too steep to drive straight up. */
  nextClimb(x: number, y: number): ClimbZone | null;
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
  /** The zigzag in progress: where it ends, the next hairpin's way, the first's way and how many so far. */
  private zigTo: number | null = null;
  private zigDir = 1;
  private zigFirst = 1;
  private zigCount = 0;
  private zigLegNext = false;
  /** Samples still counted as part of the zigzag just finished. */
  private afterZig = 0;
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
      this.zigTo = null;
    } else if (this.toHeading !== null) {
      // Start unwinding in time to end on the corner's heading.
      const way = Math.sign(this.toHeading - this.heading) || Math.sign(this.target);
      const stop = Math.sign(this.curv) === way ? (this.curv * this.curv) / (2 * this.ease) : 0;
      if (way * (this.toHeading - this.heading) <= stop) this.target = 0;
      if (this.target === 0 && this.curv === 0) {
        this.toHeading = null;
        this.nextSection(px, py);
      }
    } else {
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
    this.zigzag.push(this.zigTo !== null || this.afterZig > 0 ? 1 : 0);
    if (this.zigTo === null && this.afterZig > 0) this.afterZig--;
    if (this.zigTo !== null) this.afterZig = AFTER_ZIG;
  }

  /** Turn until the road points this way. */
  private turnTo(heading: number, radius: number, ease: number): void {
    const way = Math.sign(heading - this.heading);
    if (way === 0) {
      this.left = 0;
      return;
    }
    this.toHeading = heading;
    this.target = way / radius;
    this.ease = 1 / (radius * ease);
  }

  /** Choose what the road does next: straight on, a corner, or a zigzag up the hill ahead. */
  private nextSection(x: number, y: number): void {
    const biome = this.world.biomeAt(x);
    const r = biome.road;
    const between = ([a, b]: [number, number]) => a + (b - a) * this.rand();
    if (this.zigTo !== null) {
      this.nextOfZigzag(x, between, r.hairpin, r.leg);
      return;
    }
    // Straighten up for the start line, so the drive begins looking down the road.
    if (x < START_CLEAR[0] && x > START_CLEAR[0] - 1200) {
      this.target = 0;
      if (Math.abs(this.heading) > 0.01) this.turnTo(0, 500, MIN_EASE * 2);
      else this.left = 80;
      return;
    }
    const climb = this.world.nextClimb(x, y);
    if (climb && x >= climb.from - 30) {
      this.zigTo = climb.to;
      // Coast roads swing away from the sea first, so their legs stay over land.
      this.zigFirst = biome.land.sea ? -1 : this.rand() < 0.5 ? 1 : -1;
      this.zigDir = this.zigFirst;
      this.zigCount = 0;
      this.zigLegNext = false;
      this.nextOfZigzag(x, between, r.hairpin, r.leg);
      return;
    }
    const wasCorner = this.lastWasCorner;
    if (wasCorner && this.rand() > r.esses) {
      this.lastWasCorner = false;
      this.target = 0;
      this.left = between(r.straight);
      // Don't drive past the start of the climb.
      if (climb) this.left = Math.min(this.left, Math.max(40, climb.from - x));
      return;
    }
    const radius = between(r.radius);
    const angle = (between(r.angle) * Math.PI) / 180;
    let dir: number;
    if (wasCorner) dir = -this.lastDir;
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

  /** Hairpin, leg, hairpin, leg... until past the end of the hill, on an even count so the road comes back. */
  private nextOfZigzag(x: number, between: (r: [number, number]) => number, hairpin: [number, number], leg: [number, number]): void {
    if (this.zigLegNext) {
      this.zigLegNext = false;
      this.target = 0;
      this.left = between(leg);
      return;
    }
    const done = x >= (this.zigTo as number) || this.zigCount >= MAX_HAIRPINS;
    if (done && this.zigDir === this.zigFirst && this.zigCount > 0) {
      this.zigTo = null;
      this.lastWasCorner = true;
      this.lastDir = -this.zigFirst;
      this.turnTo(0, between(hairpin) * 2, MIN_EASE);
      return;
    }
    this.turnTo(this.zigDir * MAX_HEADING, between(hairpin), HAIRPIN_EASE);
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
