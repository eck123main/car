import { describe, expect, it } from 'vitest';
import { IDLE_INPUT } from '../sim/world';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { PracticeDriver } from './game';

describe('Practice reset', () => {
  it('waits 5 s, then puts the car back on track', () => {
    const d = new PracticeDriver(new Track(TRACKS.test), 'Me');
    const me = d.world().racer(d.meId)!;
    me.car.impact(30, 2.6, 0);
    expect(me.car.retired).toBe(true);
    d.step(1 / 120, { ...IDLE_INPUT, reset: true });
    expect(d.recoverAt()).not.toBeNull();
    for (let t = 0; t < 4.8; t += 1 / 120) d.step(1 / 120, IDLE_INPUT);
    expect(me.car.retired).toBe(true);
    for (let t = 0; t < 0.4; t += 1 / 120) d.step(1 / 120, IDLE_INPUT);
    expect(me.car.retired).toBe(false);
    expect(d.recoverAt()).toBeNull();
  });
});
