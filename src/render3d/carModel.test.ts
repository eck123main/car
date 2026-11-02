import { describe, expect, it } from 'vitest';
import { armJoints, brakeHeat, dentAt, discGlow, ledColors, shiftLights, SHIFT_LEDS, wheelAngle } from './carModel';
import { slipAngle } from './feel';

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

describe('Brake discs', () => {
  const run = (heat: number, brake: number, speed: number, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) heat = brakeHeat(heat, brake, speed, 1 / 60);
    return heat;
  };

  it('glow after a big stop from top speed, then cool off in a few seconds', () => {
    const hot = run(0, 1, 85, 1.2);
    expect(discGlow(hot)).toBeGreaterThan(0.6);
    expect(discGlow(run(hot, 0, 60, 2))).toBeGreaterThan(0);
    expect(discGlow(run(hot, 0, 60, 5))).toBe(0);
  });

  it('stay dark with light braking or at low speed', () => {
    expect(discGlow(run(0, 0.3, 30, 10))).toBeLessThan(0.15);
    expect(discGlow(run(0, 1, 5, 10))).toBe(0);
  });
});

describe('Catching a slide', () => {
  it('steers the way the car is really going, against the spin', () => {
    // Nose turning left, car still travelling to its right: right lock.
    expect(wheelAngle(0, 40, -2, 0.5, 1)).toBeGreaterThan(0.8);
    expect(wheelAngle(0, 40, 2, -0.5, 1)).toBeLessThan(-0.8);
  });

  it('leaves normal driving and crawling alone', () => {
    expect(wheelAngle(0.5, 40, 0.5, 0.02, 0)).toBe(wheelAngle(0.5, 40, 0.5));
    expect(wheelAngle(0.5, 4, 0.5, 0.5, 1)).toBe(wheelAngle(0.5, 4, 0.5));
  });

  it('reads the slide from the velocity and the nose', () => {
    expect(slipAngle(10, 0, 0)).toBeCloseTo(0);
    // Heading along +x, moving towards +y: to the car's right.
    expect(slipAngle(10, 2, 0)).toBeGreaterThan(0);
    // Reversing straight back is not a slide.
    expect(slipAngle(-10, 0, 0)).toBeCloseTo(0);
  });
});

describe('Flags on the shift lights', () => {
  it('a flag takes over every light and flashes', () => {
    expect(ledColors(3, 'yellow', false, true).every((c) => c === '#ffd400')).toBe(true);
    expect(ledColors(3, 'yellow', false, false).every((c) => c === null)).toBe(true);
  });

  it('DRS ready flashes the ends blue and leaves the revs in the middle', () => {
    const on = ledColors(8, null, true, true);
    expect(on[0]).toBe('#2f8fff');
    expect(on[SHIFT_LEDS - 1]).toBe('#2f8fff');
    expect(on[5]).toBe(ledColors(8, null, false, true)[5]);
  });
});

describe('Shift lights', () => {
  it('fill up through each gear and flash at the shift point', () => {
    expect(shiftLights(9000)).toBe(0);
    const mid = shiftLights(10500);
    expect(mid).toBeGreaterThan(3);
    expect(mid).toBeLessThan(SHIFT_LEDS);
    expect(shiftLights(11600)).toBe(SHIFT_LEDS);
    expect(shiftLights(12000)).toBe(SHIFT_LEDS + 1);
  });
});
