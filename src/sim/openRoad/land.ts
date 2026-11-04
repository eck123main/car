import { type Biome, type OpenRoadMap, type Rgb, rgb } from './biomes';
import { hash2, Noise2D, smoothstep } from './noise';
import { type ClimbZone, EndlessRoad, ROAD_HALF, SHOULDER } from './road';

/** Metres of driving in each landscape on the long way, and over how many it fades to the next. */
export const LEG_LENGTH = 9000;
export const LEG_BLEND = 2200;
/** Finest grid the land is drawn with (m): physics uses this one's heights. */
export const FINE_CELL = 6.25;
/** Land next to the road sits this far under its edge, so it never shows through (m). */
const DECK = 0.28;
/** Width of the land levelled beside the shoulder (m). */
export const LEVEL_WIDTH = 4;
/** How quickly banks steepen away from the road (m). */
const BANK_EASE = 22;

/** The zigzag on a climb stops this share of the hill's width short of the top, and starts this far out. */
const CLIMB_TOP = 0.1;
const CLIMB_FOOT = 0.8;
/** Hills only start this far past the start line, so a drive begins in the open (m). */
const HILLS_FROM = 1000;
/** Near a hill the sea stands back this far, so the road climbs over a headland (m). */
const HEADLAND = 800;

/** Land further from the road than this isn't blended between the legs of a zigzag (m). */
const BLEND_LEGS = 260;

/** One hill across the road's way. */
interface Ridge {
  /** Where its crest is (x), how far either side it reaches, how high it is. */
  cx: number;
  w: number;
  a: number;
  climb: boolean;
}

/** Colours worked out once per biome. */
interface Palette {
  grass: Rgb;
  grass2: Rgb;
  grass3: Rgb;
  rock: Rgb;
  sand: Rgb;
  snow: Rgb;
  verge: Rgb;
  strata: Rgb[] | null;
}

function paletteOf(b: Biome): Palette {
  const c = b.colors;
  return {
    grass: rgb(c.grass),
    grass2: rgb(c.grass2),
    grass3: rgb(c.grass3),
    rock: rgb(c.rock),
    sand: rgb(c.sand),
    snow: rgb(c.snow),
    verge: rgb(c.verge),
    strata: c.strata ? c.strata.map(rgb) : null,
  };
}

function mixInto(out: Rgb, a: Rgb, t: number): void {
  out[0] += (a[0] - out[0]) * t;
  out[1] += (a[1] - out[1]) * t;
  out[2] += (a[2] - out[2]) * t;
}

/** Which landscapes are in charge at this x: a, fading to b by t. */
export interface BiomeMix {
  a: Biome;
  b: Biome;
  t: number;
}

/**
 * The whole world from a seed: an endless road and the land round it. Mountains and rocks stand
 * back from the road (it runs up a valley), and the ground always banks down to the road's edge,
 * so nothing has to be stored: any point's height can be asked for at any time.
 */
export class Land {
  readonly road: EndlessRoad;
  /** The last height query's nearest road sample, distance to the road's centre (m) and road height. */
  roadIndex = 0;
  roadDistance = 0;
  roadZ = 0;

  private readonly n1: Noise2D;
  private readonly n2: Noise2D;
  private readonly n3: Noise2D;
  private readonly palettes = new Map<string, Palette>();
  private readonly mixOut: BiomeMix;
  private readonly colorB: Rgb = [0, 0, 0];
  private readonly ridges = new Map<string, Ridge | null>();

  constructor(
    readonly seed: number,
    readonly map: OpenRoadMap,
  ) {
    this.n1 = new Noise2D(seed);
    this.n2 = new Noise2D(seed + 1);
    this.n3 = new Noise2D(seed + 2);
    for (const b of map.biomes) this.palettes.set(b.id, paletteOf(b));
    this.mixOut = { a: map.biomes[0], b: map.biomes[0], t: 0 };
    this.road = new EndlessRoad(seed, {
      biomeAt: (x) => {
        const m = this.mix(x);
        return m.t < 0.5 ? m.a : m.b;
      },
      floor: (x, y) => this.floor(x, y),
      nextClimb: (x, y) => this.nextClimb(x, y),
    });
  }

  /** The landscape(s) at this x. The object returned is reused: don't keep it. */
  mix(x: number): BiomeMix {
    const list = this.map.biomes;
    const out = this.mixOut;
    if (list.length === 1) return out;
    const leg = Math.floor(x / LEG_LENGTH);
    const into = x - leg * LEG_LENGTH;
    const n = list.length;
    out.a = list[((leg % n) + n) % n];
    out.b = list[(((leg + 1) % n) + n) % n];
    out.t = smoothstep(LEG_LENGTH - LEG_BLEND, LEG_LENGTH, into);
    return out;
  }

  /** The hill of one cell of a biome's list, if it has one. */
  private ridgeOf(b: Biome, c: number): Ridge | null {
    const key = `${b.id}:${c}`;
    const known = this.ridges.get(key);
    if (known !== undefined) return known;
    const r = b.land.ridges;
    const roll = (n: number) => hash2(c, n * 53 + 7, this.seed);
    const between = ([lo, hi]: [number, number], t: number) => lo + (hi - lo) * t;
    // The first hill past the start is always a climb, so every drive soon meets one.
    const climb = c === 1 || roll(1) < r.climbs;
    const shape = climb ? r.climb : r.hill;
    const w = between(shape.width, roll(2));
    const cx = (c + 0.3 + 0.4 * roll(3)) * r.every;
    const ridge = cx - w < HILLS_FROM && cx + w > -HILLS_FROM ? null : { cx, w, a: between(shape.height, roll(4)), climb };
    this.ridges.set(key, ridge);
    return ridge;
  }

  /** How the crest of a hill wanders with y, so a hill isn't a ruled line across the map. */
  private ridgeShift(w: number, x: number, y: number): number {
    return this.n3.at(y / 1700 + 9.7, x / 6000) * w * 0.18;
  }

  /** How much the hills lift the land of a biome here (m). */
  private ridgeLift(b: Biome, x: number, y: number): number {
    const c = Math.floor(x / b.land.ridges.every);
    let sum = 0;
    for (let k = c - 1; k <= c + 1; k++) {
      const r = this.ridgeOf(b, k);
      if (!r) continue;
      const u = (x + this.ridgeShift(r.w, x, y) - r.cx) / r.w;
      if (Math.abs(u) >= 1) continue;
      const v = 1 - u * u;
      sum += r.a * v * v * (0.8 + 0.2 * this.n2.at(y / 1300, k * 3.1));
    }
    return sum;
  }

  /** How close a point is to a hill of this biome (1 on it, 0 well clear). */
  private nearRidge(b: Biome, x: number): number {
    const c = Math.floor(x / b.land.ridges.every);
    let most = 0;
    for (let k = c - 1; k <= c + 1; k++) {
      const r = this.ridgeOf(b, k);
      if (r) most = Math.max(most, 1 - smoothstep(1, 1.3, Math.abs(x - r.cx) / r.w));
    }
    return most;
  }

  /** How far the hills lift the land at a point (m). */
  hill(x: number, y: number): number {
    const m = this.mix(x);
    const { b, t } = m;
    const h = this.ridgeLift(m.a, x, y);
    return t > 0 ? h + (this.ridgeLift(b, x, y) - h) * t : h;
  }

  /** The next stretch at or past x that the road has to zigzag on: up to a crest or down from one. */
  nextClimb(x: number, y: number): ClimbZone | null {
    const m = this.mix(x);
    const b = m.t < 0.5 ? m.a : m.b;
    const c = Math.floor(x / b.land.ridges.every);
    for (let k = c - 1; k <= c + 2; k++) {
      const r = this.ridgeOf(b, k);
      if (!r || !r.climb) continue;
      const cx = r.cx - this.ridgeShift(r.w, x, y);
      if (x < cx - r.w * CLIMB_TOP) return { from: cx - r.w * CLIMB_FOOT, to: cx - r.w * CLIMB_TOP };
      if (x < cx + r.w * CLIMB_FOOT) return { from: cx + r.w * CLIMB_TOP, to: cx + r.w * CLIMB_FOOT };
    }
    return null;
  }

  private floorOf(b: Biome, x: number, y: number): number {
    const l = b.land;
    let h = l.base + l.hills.amp * this.n1.fbm(x / l.hills.scale, y / l.hills.scale, 3) + l.roll.amp * this.n2.fbm(x / l.roll.scale, y / l.roll.scale, 2);
    if (l.lakes) h -= l.lakes.depth * smoothstep(l.lakes.threshold, l.lakes.threshold + 0.14, this.n3.fbm(x / l.lakes.scale + 40, y / l.lakes.scale, 2));
    return h + this.ridgeLift(b, x, y);
  }

  /** The valley floor: the ground the road follows. */
  floor(x: number, y: number): number {
    const m = this.mix(x);
    const { b, t } = m;
    const h = this.floorOf(m.a, x, y);
    return t > 0 ? h + (this.floorOf(b, x, y) - h) * t : h;
  }

  /** How a biome's land stands up from the floor here, without the road's banks. */
  private shapeOf(b: Biome, x: number, y: number, d: number, side: number, cell: number): number {
    const l = b.land;
    let h = this.floorOf(b, x, y);
    if (l.mountains) {
      const m = l.mountains;
      const reach = m.near + (m.far - m.near) * (0.5 + 0.5 * this.n2.at(x / 3800 + side * 7.3, y / 3800));
      const mask = smoothstep(reach, reach + m.rise, d);
      if (mask > 0) {
        const octaves = cell > 60 ? 4 : cell > 15 ? 6 : 7;
        const ridges = this.n1.ridged(x / m.scale + 13.7, y / m.scale - 4.1, octaves);
        h += mask * m.amp * Math.pow(ridges, 1.6);
      }
    }
    if (l.mesas) {
      const m = l.mesas;
      const mask = smoothstep(m.near, m.near + 260, d);
      if (mask > 0) {
        const v = this.n3.fbm(x / m.scale, y / m.scale, cell > 40 ? 3 : 5);
        const edge = this.n2.fbm(x / 240, y / 240, 2) * 0.05;
        const step1 = smoothstep(0.09, 0.14, v + edge);
        const step2 = smoothstep(0.26, 0.3, v + edge);
        h += mask * m.height * (step1 * 0.6 + step2 * 0.6 + 0.12 * step1 * this.n2.fbm(x / 170, y / 170, 2));
      }
    }
    if (l.sea && side > 0) {
      const s = l.sea;
      const off = s.near + (s.far - s.near) * (0.5 + 0.5 * this.n3.at(x / 1500, 3.1)) + HEADLAND * this.nearRidge(b, x);
      // An even slope down to the sea, so the water shows from the road over the falling ground.
      const out = Math.max(0, Math.min(1, (d - off) / s.width));
      h += (-14 - h) * out;
    }
    if (l.bumps > 0 && cell < 30) h += l.bumps * this.n2.fbm(x / 34, y / 34, 2);
    return h;
  }

  /**
   * Height of the land at a point (m), as seen on a grid this coarse. Sets roadIndex, roadDistance
   * and roadZ. Coarser grids keep the ground further below the road: a big grid cell next
   * to it would otherwise rise through the tarmac.
   */
  height(x: number, y: number, cell = FINE_CELL): number {
    const road = this.road;
    const i = road.nearest(x, y);
    const lat = road.lateral(i, x, y);
    const along = road.along(i, x, y);
    const d = Math.abs(along) > 4 ? Math.hypot(lat, along) : Math.abs(lat);
    const side = lat >= 0 ? 1 : -1;
    const roadZ = road.z[i] + road.grade[i] * Math.max(-4, Math.min(4, along));
    this.roadIndex = i;
    this.roadDistance = d;
    this.roadZ = roadZ;
    const m = this.mix(x);
    const { a, b, t } = m;
    const bank = t > 0 ? a.land.bank + (b.land.bank - a.land.bank) * t : a.land.bank;
    let h = this.shapeOf(a, x, y, d, side, cell);
    if (t > 0) h += (this.shapeOf(b, x, y, d, side, cell) - h) * t;
    // The ground banks down (or up) to the road's edge: cuttings and embankments.
    const start = ROAD_HALF + SHOULDER + LEVEL_WIDTH + (cell > FINE_CELL ? cell * 0.75 : 0);
    const e = d - start;
    const deck = roadZ - (cell > FINE_CELL ? DECK + Math.min(2.5, cell * 0.04) : DECK);
    if (e <= 0) return deck;
    const reach = (bank * e * e) / (e + BANK_EASE);
    const own = Math.max(deck - reach, Math.min(deck + reach, h));
    if (d > BLEND_LEGS) return own;
    // Between the legs of a zigzag each pulls the land to its own height: meet in the middle, not in a step.
    const k = road.otherStretch(i, x, y, d);
    if (k < 0) return own;
    const d2 = Math.hypot(road.x[k] - x, road.y[k] - y);
    const e2 = Math.max(0, d2 - start);
    const deck2 = road.z[k] - (roadZ - deck);
    const reach2 = (bank * e2 * e2) / (e2 + BANK_EASE);
    const other = Math.max(deck2 - reach2, Math.min(deck2 + reach2, h));
    const near4 = d * d * d * d;
    const far4 = d2 * d2 * d2 * d2;
    return own + ((other - own) * near4) / (near4 + far4);
  }

  /** How steep the ground is at a point, and which way it rises. */
  gradient(x: number, y: number, out: { gx: number; gy: number }, step = 2): void {
    out.gx = (this.height(x + step, y) - this.height(x - step, y)) / (2 * step);
    out.gy = (this.height(x, y + step) - this.height(x, y - step)) / (2 * step);
  }

  /** The height a car's wheels are at: the road on the road, the land beside it. */
  driveHeight(x: number, y: number, hint: number | null): number {
    const road = this.road;
    const i = road.nearest(x, y, hint);
    const d = Math.abs(road.lateral(i, x, y));
    const along = Math.max(-4, Math.min(4, road.along(i, x, y)));
    const z = road.z[i] + road.grade[i] * along;
    const edge = ROAD_HALF + SHOULDER;
    if (d <= edge) return z;
    const h = this.height(x, y);
    return z + (h - z) * smoothstep(edge, edge + LEVEL_WIDTH, d);
  }

  private colorOf(b: Biome, h: number, slope: number, x: number, y: number, d: number, cell: number, out: Rgb): void {
    const p = this.palettes.get(b.id)!;
    const c = b.colors;
    const patch = this.n3.fbm(x / 210, y / 210, 2);
    out[0] = p.grass[0];
    out[1] = p.grass[1];
    out[2] = p.grass[2];
    mixInto(out, p.grass2, smoothstep(-0.2, 0.2, patch));
    mixInto(out, p.grass3, smoothstep(0.05, 0.3, this.n2.fbm(x / 95 + 9, y / 95, 2)));
    if (c.strata && h > b.land.base + 12) {
      const band = (h + patch * 14) / (c.strataHeight ?? 30);
      const n = p.strata!.length;
      const s = p.strata![((Math.floor(band) % n) + n) % n];
      mixInto(out, s, smoothstep(b.land.base + 12, b.land.base + 30, h));
    }
    mixInto(out, p.sand, 1 - smoothstep(1.5, 6, h));
    mixInto(out, p.rock, smoothstep(c.rockFrom, c.rockFrom + 0.3, slope + patch * 0.12));
    if (h > c.snowLine - 150) {
      const snow = smoothstep(c.snowLine, c.snowLine + 110, h + patch * 90) * (1 - smoothstep(0.85, 1.3, slope));
      mixInto(out, p.snow, snow);
    }
    if (cell < 30) mixInto(out, p.verge, 1 - smoothstep(ROAD_HALF + SHOULDER + 2, ROAD_HALF + SHOULDER + 13, d));
  }

  /** The ground's colour at a point (linear RGB in out). `height` must have just been asked for this point. */
  color(h: number, slope: number, x: number, y: number, cell: number, out: Rgb): void {
    const d = this.roadDistance;
    const m = this.mix(x);
    const { b, t } = m;
    this.colorOf(m.a, h, slope, x, y, d, cell, out);
    if (t > 0) {
      this.colorOf(b, h, slope, x, y, d, cell, this.colorB);
      mixInto(out, this.colorB, t);
    }
  }

  /** How much woodland there is here (0-1), for scattering plants. */
  woods(b: Biome, x: number, y: number): number {
    const f = b.flora;
    const n = this.n1.fbm(x / f.woods + 77, y / f.woods - 31, 3);
    const line = 0.4 - f.cover * 0.8;
    return smoothstep(line - 0.06, line + 0.06, n);
  }
}
