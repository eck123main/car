import { describe, expect, it } from 'vitest';
import { TRACKS } from '../tracks';
import { Track } from './track';

describe.each(Object.entries(TRACKS))('Track %s', (_id, def) => {
  const track = new Track(def);

  it('has walls that never reach into another part of the track', () => {
    let bad = 0;
    for (const s of track.samples) {
      for (const [sign, wall] of [
        [1, s.wallR],
        [-1, s.wallL],
      ] as const) {
        const q = track.query(s.x + s.nx * sign * (wall - 0.3), s.y + s.ny * sign * (wall - 0.3));
        let ds = q ? Math.abs(q.s - s.s) : Infinity;
        ds = Math.min(ds, track.length - ds);
        if (ds > 30) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('has a pit lane on the start/finish straight', () => {
    expect(track.pit).not.toBeNull();
    expect(track.inRange(0, track.pit!.entry, track.pit!.exit)).toBe(true);
  });

  it('has DRS zones', () => {
    expect(track.drsZones.length).toBeGreaterThan(0);
  });
});
