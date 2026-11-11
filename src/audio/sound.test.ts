import { describe, expect, it } from 'vitest';
import { engineMix, engineRpm, GEAR_SPEEDS_KMH, gearboxRpm } from './sound';

describe('Engine sound revs', () => {
  it('climb through each gear and drop at every upshift', () => {
    for (let g = 1; g < GEAR_SPEEDS_KMH.length; g++) {
      const shift = GEAR_SPEEDS_KMH[g];
      expect(engineRpm(shift - 1, 1)).toBeGreaterThan(engineRpm(shift - 20, 1));
      expect(engineRpm(shift + 1, 1)).toBeLessThan(engineRpm(shift - 1, 1) - 2000);
    }
  });

  it('rev up with the throttle standing still', () => {
    expect(engineRpm(0, 1)).toBeGreaterThan(engineRpm(0, 0) + 5000);
  });
});

describe('Recorded engine loops', () => {
  it('crossfade between the loops either side of the revs', () => {
    expect(engineMix([6000, 9000, 12000], 4000)).toEqual([1, 0, 0]);
    expect(engineMix([6000, 9000, 12000], 13000)).toEqual([0, 0, 1]);
    const mid = engineMix([6000, 9000, 12000], 7500);
    expect(mid[0]).toBeCloseTo(mid[1]);
    expect(mid[2]).toBe(0);
    expect(engineMix([9000], 5000)).toEqual([1]);
  });
});

describe('a car with its own gearbox', () => {
  it('follows the gearbox, and the clutch lets it rev pulling away', () => {
    expect(gearboxRpm(0.9, 1)).toBeCloseTo(7200);
    expect(gearboxRpm(0.5, 0)).toBeCloseTo(4000);
    expect(gearboxRpm(0, 1)).toBeGreaterThan(gearboxRpm(0, 0) + 3000);
    expect(gearboxRpm(1.2, 1)).toBe(8000);
  });
});
