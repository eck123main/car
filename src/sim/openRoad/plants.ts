import type { Biome, PlantDef, PlantKind } from './biomes';
import type { Land } from './land';
import { hash2 } from './noise';
import { ROAD_HALF, SHOULDER } from './road';

/** Tile the plants near the car are drawn in, and the physics asks for (m). */
export const PLANT_TILE = 320;
/** A tree on a slope steeper than this falls over. */
const MAX_SLOPE = 1.05;

/**
 * What a car hits, as a share of the plant's size: the trunk (the branches are overhead) or the
 * whole rock. Anything not listed is soft: shrubs, grass, flowers.
 */
const SOLID_RADIUS: Partial<Record<PlantKind, number>> = {
  pine: 0.03,
  snowPine: 0.03,
  broadleaf: 0.04,
  birch: 0.022,
  poplar: 0.03,
  cactus: 0.075,
  palm: 0.035,
  rock: 0.7,
  boulder: 0.8,
};
/** A thin trunk is still something to hit (m). */
const MIN_RADIUS = 0.3;
/** The largest radius any plant has (m): boulders of up to size 5. */
export const MAX_PLANT_RADIUS = 4;

/** Hash a few different numbers out of one cell. */
export const pickFrom = (ix: number, iy: number, seed: number, n: number): number => hash2(ix + n * 991, iy - n * 613, seed);

export function pickPlant(list: PlantDef[], r: number): PlantDef {
  let total = 0;
  for (const p of list) total += p.weight;
  let at = r * total;
  for (const p of list) {
    at -= p.weight;
    if (at <= 0) return p;
  }
  return list[list.length - 1];
}

export function biomeAtPoint(land: Land, x: number, r: number): Biome {
  const m = land.mix(x);
  return r < m.t ? m.b : m.a;
}

/** One plant: gx, gy is its grid cell, for picking its looks. */
export type PlantVisitor = (plant: PlantDef, x: number, y: number, h: number, size: number, gx: number, gy: number) => void;

/**
 * Every tree and rock in a square. The one list of what stands where: drawing and the physics both
 * come here, so a car hits exactly what is on the screen. Nothing smaller than minSize is visited.
 */
export function plantsIn(land: Land, x0: number, y0: number, size: number, minSize: number, visit: PlantVisitor): void {
  const seed = land.seed;
  const m0 = land.mix(x0);
  const spacing = Math.min(m0.a.flora.spacing, m0.b.flora.spacing);
  const edge = ROAD_HALF + SHOULDER;
  const grad = { gx: 0, gy: 0 };
  const i0 = Math.ceil(x0 / spacing);
  const i1 = Math.ceil((x0 + size) / spacing);
  const j0 = Math.ceil(y0 / spacing);
  const j1 = Math.ceil((y0 + size) / spacing);
  for (let gy = j0; gy < j1; gy++) {
    for (let gx = i0; gx < i1; gx++) {
      const x = (gx + hash2(gx, gy, seed)) * spacing;
      const y = (gy + pickFrom(gx, gy, seed, 1)) * spacing;
      const biome = biomeAtPoint(land, x, pickFrom(gx, gy, seed, 2));
      const f = biome.flora;
      // Thin out where this biome is sparser than the tile's spacing.
      const keep = (spacing * spacing) / (f.spacing * f.spacing);
      if (pickFrom(gx, gy, seed, 3) > keep) continue;
      const woods = land.woods(biome, x, y);
      // A few loners in the clearings.
      if (pickFrom(gx, gy, seed, 4) > woods * 0.92 + 0.05) continue;
      const plant = pickPlant(f.plants, pickFrom(gx, gy, seed, 5));
      const plantSize = plant.size[0] + (plant.size[1] - plant.size[0]) * pickFrom(gx, gy, seed, 6);
      if (plantSize < minSize) continue;
      const h = land.height(x, y);
      const d = land.roadDistance - edge;
      if (d < f.clear || h < 2 || h > f.treeLine) continue;
      land.gradient(x, y, grad, 3);
      if (Math.hypot(grad.gx, grad.gy) > MAX_SLOPE) continue;
      visit(plant, x, y, h, plantSize, gx, gy);
    }
  }
}

/** Something a car can hit. */
export interface SolidPlant {
  x: number;
  y: number;
  radius: number;
  kind: PlantKind;
}

/** Tiles kept: more than a car can touch at once. */
const KEEP_TILES = 12;

/** The solid plants near a point, worked out a tile at a time and kept for a little while. */
export class SolidPlants {
  private readonly tiles = new Map<string, SolidPlant[]>();

  constructor(private readonly land: Land) {}

  /** The solid plants in one tile (ix, iy in units of PLANT_TILE). */
  tile(ix: number, iy: number): SolidPlant[] {
    const key = `${ix}:${iy}`;
    const known = this.tiles.get(key);
    if (known) return known;
    const list: SolidPlant[] = [];
    plantsIn(this.land, ix * PLANT_TILE, iy * PLANT_TILE, PLANT_TILE, 0, (plant, x, y, _h, size) => {
      const share = SOLID_RADIUS[plant.kind];
      if (share !== undefined) list.push({ x, y, radius: Math.max(MIN_RADIUS, share * size), kind: plant.kind });
    });
    if (this.tiles.size >= KEEP_TILES) this.tiles.delete(this.tiles.keys().next().value as string);
    this.tiles.set(key, list);
    return list;
  }

  /** Calls visit for every solid plant in the tiles within reach of a point. */
  near(x: number, y: number, reach: number, visit: (p: SolidPlant) => void): void {
    const ix0 = Math.floor((x - reach) / PLANT_TILE);
    const ix1 = Math.floor((x + reach) / PLANT_TILE);
    const iy0 = Math.floor((y - reach) / PLANT_TILE);
    const iy1 = Math.floor((y + reach) / PLANT_TILE);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        for (const p of this.tile(ix, iy)) visit(p);
      }
    }
  }
}
