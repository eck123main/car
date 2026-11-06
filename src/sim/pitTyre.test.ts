import { describe, expect, it } from 'vitest';
import { ALL_COMPOUNDS, DRY_COMPOUNDS, pitTyre } from './tyres';

describe('pitTyre', () => {
  it('fits the chosen tyres when they differ from the ones on the car', () => {
    expect(pitTyre('medium', 'soft')).toBe('soft');
    expect(pitTyre('soft', 'wet')).toBe('wet');
  });

  it('always changes compound, and keeps dry tyres dry', () => {
    for (const c of ALL_COMPOUNDS) {
      const fitted = pitTyre(c, c);
      expect(fitted).not.toBe(c);
      expect(DRY_COMPOUNDS.includes(fitted)).toBe(DRY_COMPOUNDS.includes(c));
    }
  });
});
