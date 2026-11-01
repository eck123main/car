import { describe, expect, it } from 'vitest';
import { sparkRate } from './sparks3d';

describe('Floor sparks', () => {
  it('none at normal speed on flat road; a few at top speed; a shower in a compression', () => {
    expect(sparkRate(55, 1)).toBe(0);
    expect(sparkRate(20, 1.6)).toBe(0);
    const top = sparkRate(88, 1);
    expect(top).toBeGreaterThan(5);
    expect(top).toBeLessThan(30);
    expect(sparkRate(70, 1.6)).toBeGreaterThan(80);
  });
});
