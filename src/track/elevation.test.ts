import { describe, expect, it } from 'vitest';
import { Car, type CarWorld } from '../physics/car';
import { F1_CAR } from '../physics/carParams';
import { REAL_TRACK_IDS, TRACKS } from '../tracks';
import { SURFACES } from './types';
import { Track } from './track';

describe('elevation', () => {
  it("Suzuka's later stretch goes over a bridge, the earlier one stays on the ground", () => {
    const track = new Track(TRACKS.suzuka);
    const n = track.samples.length;
    const over = track.samples[Math.floor(0.808 * n)];
    const under = track.samples[Math.floor(0.399 * n)];
    expect(over.z - over.ground).toBeGreaterThan(4);
    expect(over.z - under.z).toBeGreaterThan(7);
    expect(over.deck).toBe(true);
    expect(under.z).toBe(under.ground);
    expect(under.deck).toBe(false);
  });

  it('real circuits have real heights: Spa is hilly, Monza nearly flat, nothing too steep', () => {
    const range = (id: string) => {
      const zs = new Track(TRACKS[id]).samples.map((s) => s.ground);
      return Math.max(...zs) - Math.min(...zs);
    };
    // Real gradients at half size: half the real height (Spa ~100 m, Monza ~15 m).
    expect(range('spa')).toBeGreaterThan(40);
    expect(range('monza')).toBeLessThan(12);
    for (const id of REAL_TRACK_IDS) {
      const track = new Track(TRACKS[id]);
      for (const s of track.samples) expect(Math.abs(s.grade), `${id} at ${s.s} m`).toBeLessThan(0.22);
    }
  });

  /** A straight road with a constant slope (and dip or crest). */
  const world = (grade: number, vcurv = 0): CarWorld => ({
    surfaceAt: () => SURFACES.asphalt,
    wallContact: () => null,
    slope: () => ({ grade, vcurv, tx: 1, ty: 0 }),
  });

  it('a car climbs slower than it accelerates on the flat, and runs faster downhill', () => {
    const speedAfter = (w: CarWorld) => {
      const car = new Car(F1_CAR, 'red');
      car.place(0, 0, 0);
      for (let t = 0; t < 4; t += 1 / 120) car.step({ throttle: 1, brake: 0, steer: 0 }, 1 / 120, w);
      return car.speed;
    };
    const flat = speedAfter(world(0));
    expect(speedAfter(world(0.1))).toBeLessThan(flat - 1);
    expect(speedAfter(world(-0.1))).toBeGreaterThan(flat + 1);
  });

  it('a parked car on a slope stays put', () => {
    const car = new Car(F1_CAR, 'red');
    car.place(0, 0, 0);
    for (let t = 0; t < 3; t += 1 / 120) car.step({ throttle: 0, brake: 0, steer: 0 }, 1 / 120, world(0.12));
    expect(Math.abs(car.x)).toBeLessThan(0.5);
  });

  it('over a crest the car has less grip than in a dip', () => {
    const lateralGrip = (vcurv: number) => {
      const car = new Car(F1_CAR, 'red');
      car.place(0, 0, 0);
      car.vx = 50;
      // Full lock: the turn rate it settles at is limited by grip.
      for (let t = 0; t < 0.5; t += 1 / 120) car.step({ throttle: 0.4, brake: 0, steer: 1 }, 1 / 120, world(0, vcurv));
      return Math.abs(car.yawRate);
    };
    expect(lateralGrip(-0.004)).toBeLessThan(lateralGrip(0));
    expect(lateralGrip(0.004)).toBeGreaterThan(lateralGrip(0));
  });
});
