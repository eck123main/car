import { describe, expect, it } from 'vitest';
import { REAL_TRACK_IDS, TRACKS } from '../tracks';
import { medalFor, medalTimes, medalTimesFrom, nextMedal } from './medals';

describe('Medals', () => {
  it.each(REAL_TRACK_IDS)('%s has medal times, author hardest', (id) => {
    const m = medalTimes(id)!;
    expect(m).not.toBeNull();
    expect(m.author).toBeLessThan(m.gold);
    expect(m.gold).toBeLessThan(m.silver);
    expect(m.silver).toBeLessThan(m.bronze);
    // Laps are kept to roughly 30-60 s; author must be a real lap, not a typo.
    expect(m.author).toBeGreaterThan(25);
    expect(m.bronze).toBeLessThan(80);
    expect(TRACKS[id]).toBeDefined();
  });

  it('has none for the test circuit', () => {
    expect(medalTimes('test')).toBeNull();
  });

  it('gives the best medal a time beats (equal counts)', () => {
    const m = medalTimesFrom(40);
    expect(m).toEqual({ author: 40, gold: 41.6, silver: 44, bronze: 48 });
    expect(medalFor(null, m)).toBeNull();
    expect(medalFor(48.01, m)).toBeNull();
    expect(medalFor(48, m)).toBe('bronze');
    expect(medalFor(41, m)).toBe('gold');
    expect(medalFor(39.5, m)).toBe('author');
    expect(nextMedal(null, m)).toBe('bronze');
    expect(nextMedal(41, m)).toBe('author');
    expect(nextMedal(39.5, m)).toBeNull();
  });
});
