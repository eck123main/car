import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAR_MODELS, carFor, cleanCars, shownCarModel } from './cars';

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

  it('every car has a top-down picture (rerun /car-sprites.html after adding one)', () => {
    const sprites = JSON.parse(readFileSync(new URL('../../public/models/top/sprites.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    for (const c of CAR_MODELS) expect(sprites[c.id], c.id).toBeDefined();
  });

  it('pick the same car for a racer in 2D and 3D', () => {
    // Bots: a real car of their class, always the same one for the same bot.
    for (const cls of ['gt3', 'lmh'] as const) {
      const id = shownCarModel(cls, 'bot-3', false, undefined)!;
      expect(CAR_MODELS.find((c) => c.id === id)?.carClass).toBe(cls);
      expect(shownCarModel(cls, 'bot-3', false, undefined)).toBe(id);
    }
    // Players: only the car they picked, and only in its class.
    expect(shownCarModel('gt3', 'p1', false, undefined)).toBeUndefined();
    expect(shownCarModel('gt3', 'p1', true, 'car-amg')).toBe('car-amg');
    expect(shownCarModel('lmh', 'p1', false, 'car-amg')).toBeUndefined();
    expect(shownCarModel('f1', 'bot-1', false, undefined)).toBeUndefined();
  });
});
