import { describe, expect, it } from 'vitest';
import { sprayRate } from './rain3d';

describe('Rain spray', () => {
  it('none on a dry track or crawling; a cloud at speed in the wet', () => {
    expect(sprayRate(80, 0)).toBe(0);
    expect(sprayRate(5, 1)).toBe(0);
    expect(sprayRate(70, 1)).toBeGreaterThan(sprayRate(30, 1));
    expect(sprayRate(70, 1)).toBeGreaterThan(sprayRate(70, 0.4));
  });
});
