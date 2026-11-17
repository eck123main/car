import type { CarClassId } from '../sim/carClass';
import type { Rarity } from './skins';

/**
 * Real cars for the GT3 and Hypercar classes: loaded 3D bodies (`public/models/`, credits in
 * `public/models/CREDITS.md`), looks only. Bought in the garage with coins; without one you drive
 * the built-in car. Bots show a random one, so a race shows them off.
 *
 * Prices are checked by the database too (`supabase/economy.sql`, table `car_shop`); a test keeps
 * the two lists the same. Ids match the `id` of each entry in `public/models/models.json`.
 */
export interface CarModelDef {
  id: string;
  name: string;
  carClass: CarClassId;
  rarity: Rarity;
  price: number;
}

export const CAR_MODELS: CarModelDef[] = [
  { id: 'car-bmw-m4', name: 'BMW M4 GT3', carClass: 'gt3', rarity: 'common', price: 600 },
  { id: 'car-mustang', name: 'Ford Mustang GT3', carClass: 'gt3', rarity: 'common', price: 800 },
  { id: 'car-amg', name: 'Mercedes-AMG GT3 Evo', carClass: 'gt3', rarity: 'rare', price: 1000 },
  { id: 'car-huracan', name: 'Lamborghini Huracán GT3 Evo2', carClass: 'gt3', rarity: 'rare', price: 1200 },
  { id: 'car-mclaren', name: 'McLaren 720S GT3', carClass: 'gt3', rarity: 'rare', price: 1200 },
  { id: 'car-porsche', name: 'Porsche 911 GT3 R', carClass: 'gt3', rarity: 'epic', price: 1500 },
  { id: 'car-ferrari-296', name: 'Ferrari 296 GT3', carClass: 'gt3', rarity: 'epic', price: 1500 },
  { id: 'car-cadillac', name: 'Cadillac V-Series.R', carClass: 'lmh', rarity: 'epic', price: 1500 },
  { id: 'car-499p', name: 'Ferrari 499P', carClass: 'lmh', rarity: 'epic', price: 2000 },
];

const BY_ID = new Map(CAR_MODELS.map((c) => [c.id, c]));

export function carModelDef(id: string | null | undefined): CarModelDef | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** A player's cars as sent over the network: known ids only, at most one per class. */
export function cleanCars(cars: unknown): string[] | undefined {
  if (!Array.isArray(cars)) return undefined;
  const out = new Map<CarClassId, string>();
  for (const id of cars.slice(0, 8)) {
    const def = typeof id === 'string' ? BY_ID.get(id) : undefined;
    if (def && !out.has(def.carClass)) out.set(def.carClass, def.id);
  }
  return out.size ? [...out.values()] : undefined;
}

/** The car a player drives in this class, if they picked one. */
export function carFor(cars: readonly string[] | undefined, carClass: CarClassId | undefined): string | undefined {
  return cars?.find((id) => BY_ID.get(id)?.carClass === carClass);
}
