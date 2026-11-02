import { describe, expect, it } from 'vitest';
import { dustOf, rollsLockup, tyreWork } from './tyreFx3d';
import { particleFade } from './particles3d';

const base = { speed: 40, throttle: 0, slip: 0, locking: false, wet: 0 };

describe('Tyre smoke and rubber', () => {
  it('a clean car at speed does nothing', () => {
    expect(tyreWork(base)).toEqual({ front: 0, rear: 0, markFront: 0, markRear: 0 });
  });

  it('a lockup smokes and marks the fronts only', () => {
    const w = tyreWork({ ...base, locking: true });
    expect(w.front).toBeGreaterThan(0);
    expect(w.markFront).toBeGreaterThan(0);
    expect(w.rear).toBe(0);
  });

  it('wheelspin is the rears, off the line, and stops as the car gets going', () => {
    const launch = tyreWork({ ...base, speed: 3, throttle: 1 });
    expect(launch.rear).toBeGreaterThan(20);
    expect(launch.front).toBe(0);
    expect(tyreWork({ ...base, speed: 25, throttle: 1 }).rear).toBe(0);
  });

  it('a slide works both axles, either way round', () => {
    for (const slip of [0.3, -0.3]) {
      const w = tyreWork({ ...base, slip });
      expect(w.front).toBeGreaterThan(0);
      expect(w.rear).toBeGreaterThan(0);
    }
  });

  it('a wet road hardly smokes and takes no rubber', () => {
    const dry = tyreWork({ ...base, locking: true });
    const wet = tyreWork({ ...base, locking: true, wet: 1 });
    expect(wet.front).toBeLessThan(dry.front * 0.3);
    expect(wet.markFront).toBe(0);
  });

  it('only fast stops can lock up, and not always', () => {
    expect(rollsLockup(20, 0)).toBe(false);
    expect(rollsLockup(60, 0.1)).toBe(true);
    expect(rollsLockup(60, 0.9)).toBe(false);
  });
});

describe('Dust', () => {
  it('comes from off the road only, with stones from gravel', () => {
    expect(dustOf('asphalt', 40)).toBeNull();
    expect(dustOf('kerb', 40)).toBeNull();
    expect(dustOf('gravel', 40)!.stones).toBeGreaterThan(0);
    expect(dustOf('grass', 40)!.stones).toBe(0);
  });

  it('stays down when the car is crawling', () => {
    expect(dustOf('gravel', 2)).toBeNull();
    expect(dustOf('gravel', 50)!.rate).toBeGreaterThan(dustOf('gravel', 10)!.rate);
  });
});

describe('Particle fade', () => {
  it('starts and ends invisible', () => {
    expect(particleFade(0)).toBe(0);
    expect(particleFade(1)).toBe(0);
    expect(particleFade(0.3)).toBeGreaterThan(0.3);
  });
});
