import { describe, expect, it } from 'vitest';
import { dentAt } from './carModel';

const NONE = { frontWing: 0, rearWing: 0, left: 0, right: 0 };

describe('Damage on the 3D body', () => {
  it('an undamaged car keeps its shape', () => {
    expect(dentAt(-0.5, 0.3, 0.7, NONE)).toEqual([0, 0, 0]);
    expect(dentAt(2.5, 0.3, 0, NONE)).toEqual([0, 0, 0]);
  });

  it('a damaged side caves in on that side only', () => {
    const d = { ...NONE, right: 0.8 };
    const [, , right] = dentAt(-0.5, 0.3, 0.7, d);
    expect(right).toBeLessThan(-0.05);
    expect(dentAt(-0.5, 0.3, -0.7, d)).toEqual([0, 0, 0]);
    // The middle of the car (cockpit) doesn't move sideways.
    expect(dentAt(-0.5, 0.3, 0.1, d)[2]).toBeCloseTo(0);
  });

  it('front wing damage crumples the nose back, more at the tip', () => {
    const d = { ...NONE, frontWing: 0.8 };
    expect(dentAt(2.6, 0.2, 0, d)[0]).toBeLessThan(-0.1);
    expect(dentAt(1.0, 0.2, 0, d)[0]).toBe(0);
  });
});
