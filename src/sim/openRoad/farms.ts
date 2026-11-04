import { type Biome, type BuildingKind, type FarmAnimal, type Rgb, rgb } from './biomes';
import type { Land } from './land';
import { hash2 } from './noise';

/** One possible farm per square this big (m). */
const CELL = 900;
/** Farms stand back from the road: in the distance, never crowding it (m). */
const NEAR_ROAD = 130;
const FAR_ROAD = 1800;
/** No farm on ground steeper than this. */
const MAX_SLOPE = 0.2;
/** Half the size of a field (m). */
const FIELD_HALF: [number, number] = [85, 140];
/** Fields are kept this far from the road's edge (m). */
const FIELD_ROAD_GAP = 26;
/** The yard: no trees this close to a farm's centre (m). */
const YARD = 55;
/** Nothing of a farm is further from its centre than this (m). */
const REACH = 440;
/** A length of field fence (m). */
export const FENCE_BAY = 12;

/** What each building is as a solid circle (m). */
const RADIUS: Record<BuildingKind, number> = {
  barn: 11,
  smallBarn: 7,
  silo: 3.5,
  house: 7,
  windmill: 5,
  chalet: 8,
  cabin: 5.5,
  shed: 4,
  ranch: 9,
  windpump: 2,
  villa: 8,
};

export interface FarmField {
  /** Its centre on the farm's own axes (m). */
  x: number;
  y: number;
  /** Half its size along and across those axes (m). */
  hl: number;
  hw: number;
  color: Rgb;
}

export interface FarmBuilding {
  kind: BuildingKind;
  x: number;
  y: number;
  yaw: number;
  scale: number;
  radius: number;
  wall: string;
}

/** Little things only drawn up close. */
export interface FarmDetail {
  kind: 'fence' | 'bale' | FarmAnimal;
  x: number;
  y: number;
  yaw: number;
  size: number;
}

export interface Farm {
  x: number;
  y: number;
  /** Which way its fields line up. */
  cos: number;
  sin: number;
  yaw: number;
  biome: Biome;
  fields: FarmField[];
  buildings: FarmBuilding[];
  details: FarmDetail[];
}

const colorCache = new Map<string, Rgb>();
function colorOf(hex: string): Rgb {
  let c = colorCache.get(hex);
  if (!c) {
    c = rgb(hex);
    colorCache.set(hex, c);
  }
  return c;
}

/**
 * Farmland out in the distance, a function of the seed like the rest of the world: crops in the
 * ground's colours, buildings and fences on top. The land's colours, the plants (no trees in a
 * field) and the physics (buildings are solid) all ask here, so they always agree.
 */
export class Farms {
  private readonly cells = new Map<number, Farm | null>();

  constructor(private readonly land: Land) {}

  /** The farm in a cell of the grid, if there is one. */
  private at(ix: number, iy: number): Farm | null {
    const key = ix * 200003 + iy;
    const known = this.cells.get(key);
    if (known !== undefined) return known;
    // Asking the land's height moves what it remembers about the road: put that back.
    const { land } = this;
    const { roadIndex, roadDistance, roadZ } = land;
    const farm = this.make(ix, iy);
    land.roadIndex = roadIndex;
    land.roadDistance = roadDistance;
    land.roadZ = roadZ;
    this.cells.set(key, farm);
    return farm;
  }

  private make(ix: number, iy: number): Farm | null {
    const { land } = this;
    const seed = land.seed + 901;
    const roll = (n: number) => hash2(ix + n * 761, iy - n * 433, seed);
    const x = (ix + 0.25 + 0.5 * roll(1)) * CELL;
    const y = (iy + 0.25 + 0.5 * roll(2)) * CELL;
    // Behind the start there's nothing to see, and the road there is only for the mirrors.
    if (x < -2000) return null;
    const m = land.mix(x);
    const biome = roll(3) < m.t ? m.b : m.a;
    const def = biome.land.farms;
    if (!def || roll(4) > def.chance) return null;
    const h = land.height(x, y);
    const d = land.roadDistance;
    if (d < NEAR_ROAD || d > FAR_ROAD || h < 8 || h > biome.colors.snowLine - 30 || h > biome.flora.treeLine) return null;
    const grad = { gx: 0, gy: 0 };
    land.gradient(x, y, grad, 30);
    if (Math.hypot(grad.gx, grad.gy) > MAX_SLOPE) return null;

    const yaw = roll(5) * Math.PI;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const place = (lx: number, ly: number): [number, number] => [x + lx * cos - ly * sin, y + lx * sin + ly * cos];
    const farm: Farm = { x, y, cos, sin, yaw, biome, fields: [], buildings: [], details: [] };

    // Buildings round the yard: the main one, then some of the rest.
    for (let n = 0; n < def.buildings.length; n++) {
      if (n > 0 && roll(10 + n) > 0.65) continue;
      const kind = def.buildings[n];
      const angle = (n / def.buildings.length) * Math.PI * 2 + roll(30) * 6;
      const r = n === 0 ? 0 : 26 + roll(20 + n) * 12;
      const [bx, by] = place(Math.cos(angle) * r, Math.sin(angle) * r);
      const scale = 0.9 + roll(40 + n) * 0.3;
      const wall = def.walls[Math.floor(roll(60 + n) * def.walls.length)];
      farm.buildings.push({ kind, x: bx, y: by, yaw: yaw + Math.floor(roll(50 + n) * 4) * (Math.PI / 2), scale, radius: RADIUS[kind] * scale, wall });
    }

    // A patchwork of fields, or a fenced paddock where nothing grows.
    const slots: [number, number][] = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ];
    for (let n = 0; n < slots.length; n++) {
      if (roll(70 + n) > 0.72) continue;
      const hl = FIELD_HALF[0] + roll(80 + n) * (FIELD_HALF[1] - FIELD_HALF[0]);
      const hw = FIELD_HALF[0] + roll(90 + n) * (FIELD_HALF[1] - FIELD_HALF[0]);
      const lx = slots[n][0] * (FIELD_HALF[1] + 12);
      const ly = slots[n][1] * (FIELD_HALF[1] + 12);
      const [fx, fy] = place(lx, ly);
      const fh = land.height(fx, fy);
      if (land.roadDistance < Math.hypot(hl, hw) + FIELD_ROAD_GAP || fh < 6 || Math.abs(fh - h) > 45) continue;
      const crop = def.fields.length > 0 ? def.fields[Math.floor(roll(100 + n) * def.fields.length)] : null;
      const field: FarmField = { x: lx, y: ly, hl, hw, color: crop ? colorOf(crop) : [0, 0, 0] };
      if (crop) farm.fields.push(field);
      this.addDetails(farm, field, !crop, roll, place, 200 + n * 20);
    }
    return farm;
  }

  /** The fence round a field, and what's in it. */
  private addDetails(farm: Farm, f: FarmField, paddock: boolean, roll: (n: number) => number, place: (lx: number, ly: number) => [number, number], base: number): void {
    const def = farm.biome.land.farms!;
    // Paddocks are smaller than fields.
    const hl = paddock ? f.hl * 0.45 : f.hl;
    const hw = paddock ? f.hw * 0.45 : f.hw;
    const side = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.round(len / FENCE_BAY));
      const yaw = farm.yaw + Math.atan2(y1 - y0, x1 - x0);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const [x, y] = place(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        farm.details.push({ kind: 'fence', x, y, yaw, size: len / n / FENCE_BAY });
      }
    };
    side(f.x - hl, f.y - hw, f.x + hl, f.y - hw);
    side(f.x + hl, f.y - hw, f.x + hl, f.y + hw);
    side(f.x + hl, f.y + hw, f.x - hl, f.y + hw);
    side(f.x - hl, f.y + hw, f.x - hl, f.y - hw);
    const inField = (n: number): [number, number] => place(f.x + (roll(base + n) * 2 - 1) * hl * 0.85, f.y + (roll(base + n + 7) * 2 - 1) * hw * 0.85);
    if (def.animals && (paddock || roll(base - 1) < 0.5)) {
      const count = 5 + Math.floor(roll(base - 2) * 7);
      for (let n = 0; n < count; n++) {
        const [x, y] = inField(n * 2);
        farm.details.push({ kind: def.animals, x, y, yaw: roll(base + 40 + n) * 6.28, size: 0.9 + roll(base + 60 + n) * 0.25 });
      }
    } else if (def.bales && !paddock) {
      const count = 6 + Math.floor(roll(base - 3) * 8);
      for (let n = 0; n < count; n++) {
        const [x, y] = inField(n * 2 + 1);
        farm.details.push({ kind: 'bale', x, y, yaw: roll(base + 80 + n) * 6.28, size: 1 });
      }
    }
  }

  /** The farms that might reach a point: the cell's own and the three on its nearest sides. */
  private nearby(x: number, y: number, visit: (farm: Farm) => boolean): boolean {
    const fx = x / CELL;
    const fy = y / CELL;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const ox = fx - ix < 0.5 ? -1 : 1;
    const oy = fy - iy < 0.5 ? -1 : 1;
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        const farm = this.at(ix + a * ox, iy + b * oy);
        if (farm && Math.abs(farm.x - x) < REACH && Math.abs(farm.y - y) < REACH && visit(farm)) return true;
      }
    }
    return false;
  }

  /** The crop growing at a point, if any. */
  fieldColor(x: number, y: number): Rgb | null {
    let found: Rgb | null = null;
    this.nearby(x, y, (farm) => {
      const dx = x - farm.x;
      const dy = y - farm.y;
      const lx = dx * farm.cos + dy * farm.sin;
      const ly = -dx * farm.sin + dy * farm.cos;
      for (const f of farm.fields) {
        if (Math.abs(lx - f.x) < f.hl && Math.abs(ly - f.y) < f.hw) {
          found = f.color;
          return true;
        }
      }
      return false;
    });
    return found;
  }

  /** Is this point kept clear of trees: a field or a yard? */
  clears(x: number, y: number): boolean {
    return this.nearby(x, y, (farm) => {
      const dx = x - farm.x;
      const dy = y - farm.y;
      if (dx * dx + dy * dy < YARD * YARD) return true;
      const lx = dx * farm.cos + dy * farm.sin;
      const ly = -dx * farm.sin + dy * farm.cos;
      return farm.fields.some((f) => Math.abs(lx - f.x) < f.hl + 4 && Math.abs(ly - f.y) < f.hw + 4);
    });
  }

  /** Every farm with any part in this square. */
  private farmsIn(x0: number, y0: number, size: number, visit: (farm: Farm) => void): void {
    const i0 = Math.floor((x0 - REACH) / CELL);
    const i1 = Math.floor((x0 + size + REACH) / CELL);
    const j0 = Math.floor((y0 - REACH) / CELL);
    const j1 = Math.floor((y0 + size + REACH) / CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const farm = this.at(i, j);
        if (farm) visit(farm);
      }
    }
  }

  buildingsIn(x0: number, y0: number, size: number, visit: (b: FarmBuilding) => void): void {
    this.farmsIn(x0, y0, size, (farm) => {
      for (const b of farm.buildings) {
        if (b.x >= x0 && b.x < x0 + size && b.y >= y0 && b.y < y0 + size) visit(b);
      }
    });
  }

  detailsIn(x0: number, y0: number, size: number, visit: (d: FarmDetail, farm: Farm) => void): void {
    this.farmsIn(x0, y0, size, (farm) => {
      for (const d of farm.details) {
        if (d.x >= x0 && d.x < x0 + size && d.y >= y0 && d.y < y0 + size) visit(d, farm);
      }
    });
  }
}
