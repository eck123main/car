import { describe, expect, it } from 'vitest';
import { packInput, unpackInput } from './snapshot';

describe('packed inputs', () => {
  it('carry the traction control setting to the host', () => {
    for (const tc of [0, 1, 2]) {
      const input = { throttle: 1, brake: 0, steer: -0.5, drs: true, ers: false, limiter: true, nextTyre: 'soft' as const, tc };
      const back = unpackInput(packInput(3, input))?.input;
      expect(back?.tc).toBe(tc);
      expect(back?.drs).toBe(true);
      expect(back?.limiter).toBe(true);
      expect(back?.steer).toBe(-0.5);
    }
  });

  it('read a missing setting as high', () => {
    const input = { throttle: 0, brake: 0, steer: 0, drs: false, ers: false, limiter: false, nextTyre: 'medium' as const };
    expect(unpackInput(packInput(1, input))?.input.tc).toBe(2);
  });
});
