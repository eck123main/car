import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { elevation } from './landmarks';

describe('circuit landmarks', () => {
  it('every landmark in the track files survived parsing, with lap shares between 0 and 1', () => {
    let count = 0;
    for (const [id, def] of Object.entries(TRACKS)) {
      for (const l of def.scenery?.landmarks ?? []) {
        count++;
        for (const k of ['at', 'from', 'to'] as const) {
          if (l[k] !== undefined) expect(l[k], `${id} ${l.type}.${k}`).toBeGreaterThanOrEqual(0);
          if (l[k] !== undefined) expect(l[k], `${id} ${l.type}.${k}`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(count).toBeGreaterThan(10);
  });

  it("Suzuka's later stretch goes over a bridge, the earlier one stays on the ground", () => {
    const track = new Track(TRACKS.suzuka);
    const e = elevation(track)!;
    expect(e).not.toBeNull();
    const n = track.samples.length;
    // The crossing is at ~40% (under) and ~81% (over) of the lap.
    expect(e.heights[Math.floor(0.808 * n)]).toBeGreaterThan(7);
    expect(e.heights[Math.floor(0.399 * n)]).toBe(0);
    expect(e.deck[Math.floor(0.808 * n)]).toBe(1);
    // Back on the ground well before and after.
    expect(e.heights[Math.floor(0.7 * n)]).toBe(0);
    expect(e.heights[Math.floor(0.9 * n)]).toBe(0);
  });

  it('tracks without a crossover stay flat', () => {
    expect(elevation(new Track(TRACKS.silverstone))).toBeNull();
    expect(elevation(new Track(TRACKS.monaco))).toBeNull();
  });
});
