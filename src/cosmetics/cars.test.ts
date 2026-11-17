import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAR_MODELS, carFor, cleanCars } from './cars';

const SQL = readFileSync(new URL('../../supabase/economy.sql', import.meta.url), 'utf8');
const MODELS = JSON.parse(readFileSync(new URL('../../public/models/models.json', import.meta.url), 'utf8')) as Record<string, { id: string; name: string }[]>;

describe('Real cars', () => {
  it('match the database shop (id, class, price)', () => {
    const shop = [...SQL.matchAll(/\('(car-[a-z0-9-]+)', '([a-z0-9]+)', (\d+)\)/g)].map((m) => [m[1], m[2], Number(m[3])]);
    expect(shop).toEqual(CAR_MODELS.map((c) => [c.id, c.carClass, c.price]));
  });

  it('match the model files, class by class', () => {
    for (const cls of ['gt3', 'lmh'] as const) {
      expect(MODELS[cls].map((m) => m.id).sort()).toEqual(CAR_MODELS.filter((c) => c.carClass === cls).map((c) => c.id).sort());
    }
    expect(new Set(CAR_MODELS.map((c) => c.id)).size).toBe(CAR_MODELS.length);
  });

  it('take only known cars from the network, one per class', () => {
    expect(cleanCars('car-porsche')).toBeUndefined();
    expect(cleanCars(['nope', 3, 'car-porsche', 'car-amg', 'car-499p'])).toEqual(['car-porsche', 'car-499p']);
    expect(cleanCars([])).toBeUndefined();
    expect(carFor(['car-porsche', 'car-499p'], 'lmh')).toBe('car-499p');
    expect(carFor(['car-porsche'], 'f1')).toBeUndefined();
  });
});
