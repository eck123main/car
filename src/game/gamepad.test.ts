import { afterEach, describe, expect, it, vi } from 'vitest';
import { padDrive, stickToSteer, triggerValue } from './gamepad';

function pad(axes: number[], buttons: Record<number, number>): Gamepad {
  const list = Array.from({ length: 17 }, (_, i) => ({ value: buttons[i] ?? 0, pressed: (buttons[i] ?? 0) > 0.5, touched: false }));
  return { connected: true, axes, buttons: list, id: 'Xbox', index: 0, mapping: 'standard', timestamp: 0 } as unknown as Gamepad;
}

describe('controller driving', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores a resting stick and trigger', () => {
    expect(stickToSteer(0.08)).toBe(0);
    expect(stickToSteer(-0.1)).toBe(0);
    expect(triggerValue(0.02)).toBe(0);
  });

  it('steers finely near the centre and fully at the stop', () => {
    expect(stickToSteer(1)).toBe(1);
    expect(stickToSteer(-1)).toBe(-1);
    const half = stickToSteer(0.56);
    expect(half).toBeGreaterThan(0.25);
    expect(half).toBeLessThan(0.45);
    expect(stickToSteer(0.3)).toBeLessThan(0.1);
  });

  it('reads triggers as throttle and brake, the stick as steering', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [pad([-1, 0], { 7: 1, 6: 0.5 }), null] });
    const d = padDrive();
    expect(d.throttle).toBe(1);
    expect(d.brake).toBeCloseTo(0.48, 1);
    expect(d.steer).toBe(-1);
  });

  it('is all zero with no controller, or no gamepad support', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [null, null] });
    expect(padDrive()).toEqual({ throttle: 0, brake: 0, steer: 0 });
    vi.stubGlobal('navigator', {});
    expect(padDrive()).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });
});
