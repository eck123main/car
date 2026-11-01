import { describe, expect, it } from 'vitest';
import { HeadMotion, type Feel } from './feel';

const CRUISE: Feel = { longG: 0, latG: 0, speed: 60, surface: 'asphalt', upset: 0 };

/** Run the head for a while and return the last pose (no randomness). */
function settle(feel: Feel, seconds = 1.5, head = new HeadMotion(() => 0.5)) {
  let pose = head.step(feel, 1 / 60);
  for (let t = 0; t < seconds; t += 1 / 60) pose = head.step(feel, 1 / 60);
  return pose;
}

describe('Driver head movement (3D view)', () => {
  it('braking throws the head forward and down, accelerating pushes it back', () => {
    const braking = settle({ ...CRUISE, longG: -4 });
    expect(braking.x).toBeGreaterThan(0.03);
    expect(braking.pitch).toBeLessThan(0);
    expect(settle({ ...CRUISE, longG: 1.5 }).x).toBeLessThan(0);
  });

  it('in a right turn the head is pushed left and tilts left, and never goes far', () => {
    const right = settle({ ...CRUISE, latG: 4 });
    expect(right.z).toBeLessThan(-0.03);
    expect(right.roll).toBeGreaterThan(0);
    const huge = settle({ ...CRUISE, latG: 40, longG: -40 });
    expect(Math.abs(huge.z)).toBeLessThanOrEqual(0.051);
    expect(Math.abs(huge.x)).toBeLessThanOrEqual(0.051);
  });

  it('kerbs and gravel shake it; smooth tarmac barely does', () => {
    expect(settle({ ...CRUISE, surface: 'kerb' }).shake).toBeGreaterThan(0.005);
    expect(settle({ ...CRUISE, surface: 'gravel' }).shake).toBeGreaterThan(0.01);
    expect(settle(CRUISE).shake).toBeLessThan(0.002);
    expect(settle({ ...CRUISE, speed: 0, surface: 'gravel' }).shake).toBe(0);
  });

  it('a hit jolts it, then it calms down', () => {
    const head = new HeadMotion(() => 0.9);
    settle(CRUISE, 0.5, head);
    const hit = head.step({ ...CRUISE, upset: 0.8 }, 1 / 60);
    expect(hit.shake).toBeGreaterThan(0.03);
    expect(settle({ ...CRUISE, upset: 0.8 }, 1.5, head).shake).toBeLessThan(0.002);
  });
});
