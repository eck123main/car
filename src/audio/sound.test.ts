import { describe, expect, it } from 'vitest';
import { engineRpm, GEAR_SPEEDS_KMH } from './sound';

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
