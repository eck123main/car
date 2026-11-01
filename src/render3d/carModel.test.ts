import { describe, expect, it } from 'vitest';
import { armJoints, dentAt, wheelAngle } from './carModel';

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

describe('Steering wheel and the driver\'s arms', () => {
  it('the wheel follows the corner radius: big in a hairpin, small in a fast corner', () => {
    // Hairpin: 8 m radius at 15 m/s.
    const hairpin = wheelAngle(1, 15, 15 / 8);
    expect(hairpin).toBeGreaterThan(1.6);
    // Fast sweeper: 150 m radius at 70 m/s, partial input.
    const fast = wheelAngle(0.4, 70, 70 / 150);
    expect(fast).toBeGreaterThan(0.05);
    expect(fast).toBeLessThan(0.4);
    // Left is the mirror of right; straight ahead is straight.
    expect(wheelAngle(-1, 15, -15 / 8)).toBeCloseTo(-hairpin);
    expect(wheelAngle(0, 80, 0)).toBe(0);
  });

  it('stopped, the wheel shows the input and never passes full lock', () => {
    expect(wheelAngle(1, 0, 0)).toBeGreaterThan(1);
    expect(wheelAngle(1, 3, 10)).toBeLessThanOrEqual(2.3);
  });

  it('arms keep their length and stay inside the cockpit at any lock', () => {
    for (const angle of [-2.3, -1.2, 0, 0.6, 1.5, 2.3]) {
      for (const side of [-1, 1]) {
        const { shoulder, elbow, wrist } = armJoints(angle, side);
        expect(shoulder.distanceTo(elbow)).toBeCloseTo(0.29, 3);
        expect(elbow.distanceTo(wrist)).toBeCloseTo(0.28, 3);
        // Cockpit sides are at |z| 0.28 inside; the tub floor is at 0.28 high.
        expect(Math.abs(elbow.z)).toBeLessThan(0.28);
        expect(elbow.y).toBeGreaterThan(0.3);
      }
    }
  });

  it('in a hairpin the arms cross, as real drivers\' do', () => {
    // Right turn at full lock: the left hand goes over the top to the right.
    expect(armJoints(2, -1).wrist.z).toBeGreaterThan(0);
    expect(armJoints(0, -1).wrist.z).toBeLessThan(0);
  });
});
