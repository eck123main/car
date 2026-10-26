import { describe, expect, it } from 'vitest';
import type { CrewAction } from '../render/pitStops';
import { crewPose, legHeights } from './crew3d';

describe('Pit crew poses', () => {
  it('keeps every crew member on the ground, never in it', () => {
    const actions: CrewAction[] = ['walk', 'idle', 'gun', 'carry', 'hold', 'jack', 'cheer'];
    for (const action of actions) {
      for (const busy of [false, true]) {
        for (let t = 0; t < 2; t += 0.05) {
          const pose = crewPose(action, busy, t, 3);
          const lowest = Math.min(...([0, 1] as const).flatMap((s) => [legHeights(pose, s).knee, legHeights(pose, s).sole]));
          // Something touches the ground (a foot, or a knee when kneeling), nothing goes under it.
          expect(lowest + pose.bob, `${action} at ${t.toFixed(2)}`).toBeGreaterThan(-0.06);
          if (pose.bob === 0) expect(lowest, `${action} at ${t.toFixed(2)}`).toBeLessThan(0.08);
        }
      }
    }
  });

  it('kneels to use the wheel gun, knee on the ground', () => {
    const pose = crewPose('gun', true, 0.5, 0);
    expect(pose.gun).toBe(true);
    // The knee's centre: the leg is 0.17 m thick, so it rests on the ground.
    expect(legHeights(pose, 1).knee).toBeLessThan(0.12);
  });
});
