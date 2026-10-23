import { describe, expect, it } from 'vitest';
import { TRACKS } from '../tracks';

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
});
