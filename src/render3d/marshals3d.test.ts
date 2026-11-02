import { describe, expect, it } from 'vitest';
import { flagSwing, postCount } from './marshals3d';
import { lightStrength, tailOn } from './carLights3d';

describe('Marshal posts', () => {
  it('scale with the lap, within limits', () => {
    expect(postCount(500)).toBe(6);
    expect(postCount(2800)).toBe(10);
    expect(postCount(20000)).toBe(14);
  });

  it('wave out of step with each other', () => {
    expect(flagSwing(1, 0)).not.toBeCloseTo(flagSwing(1, 1));
    expect(Math.abs(flagSwing(1.3, 2))).toBeLessThanOrEqual(0.9);
  });
});

describe('Car lights', () => {
  it('a dry day shows nothing', () => {
    expect(lightStrength('day', 0)).toEqual({ beam: 0, tail: 0, streak: 0 });
  });

  it('night has beams and tail lights, dusk weaker', () => {
    const night = lightStrength('night', 0);
    const dusk = lightStrength('dusk', 0);
    expect(night.beam).toBe(1);
    expect(dusk.beam).toBeGreaterThan(0);
    expect(dusk.beam).toBeLessThan(1);
  });

  it('rain on a day race brings the tail light and its reflection, no beams', () => {
    const s = lightStrength('day', 0.8);
    expect(s.beam).toBe(0);
    expect(s.tail).toBe(1);
    expect(s.streak).toBeGreaterThan(0);
  });

  it('the rain light blinks only in the wet', () => {
    const states = new Set([0, 0.1, 0.2, 0.3].map((t) => tailOn(t, 0.8)));
    expect(states.size).toBe(2);
    expect([0, 0.1, 0.2, 0.3].every((t) => tailOn(t, 0))).toBe(true);
  });
});
