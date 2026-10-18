import MEDAL_TABLE from '../tracks/medals.json';

/**
 * Time trial medals, like Trackmania's: beat a track's medal time to earn that medal. Author is
 * the hardest. Only signed-in players earn them (their best lap is kept under their account,
 * so medals follow them to any device); guests see the times but earn nothing.
 */
export type Medal = 'author' | 'gold' | 'silver' | 'bronze';

/** Best first. */
export const MEDALS: Medal[] = ['author', 'gold', 'silver', 'bronze'];

export type MedalTimes = Record<Medal, number>;

export const MEDAL_NAMES: Record<Medal, string> = { author: 'Author', gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
export const MEDAL_COLORS: Record<Medal, string> = { author: '#1fd38a', gold: '#ffc83d', silver: '#c9d1d9', bronze: '#d08a4f' };

/**
 * Gold, silver and bronze are this much slower than author. Top players' laps on the same track
 * are within ~4% of each other, a decent player is ~10% off, and a clean lap at the Hard bot's
 * pace is ~20-25% off (see scripts/medal-times.ts).
 */
export const MEDAL_FACTORS: Record<Medal, number> = { author: 1, gold: 1.04, silver: 1.1, bronze: 1.2 };

/** All four medal times from an author time (author rounded down, the rest up, to 0.01 s). */
export function medalTimesFrom(author: number): MedalTimes {
  const a = Math.floor(author * 100) / 100;
  const at = (m: Medal) => (m === 'author' ? a : Math.ceil(a * MEDAL_FACTORS[m] * 100 - 1e-6) / 100);
  return { author: at('author'), gold: at('gold'), silver: at('silver'), bronze: at('bronze') };
}

const TABLE = MEDAL_TABLE as Record<string, MedalTimes>;

/** A track's medal times, or null if it has none (the test circuit, editor tracks). */
export function medalTimes(trackId: string): MedalTimes | null {
  return TABLE[trackId] ?? null;
}

/** The best medal a lap time earns (equal to the medal time counts), or null. */
export function medalFor(time: number | null | undefined, times: MedalTimes): Medal | null {
  if (time == null) return null;
  return MEDALS.find((m) => time <= times[m]) ?? null;
}

/** The next medal to go for, or null once author is won. */
export function nextMedal(time: number | null | undefined, times: MedalTimes): Medal | null {
  const have = medalFor(time, times);
  const i = have === null ? MEDALS.length : MEDALS.indexOf(have);
  return i > 0 ? MEDALS[i - 1] : null;
}

/** Is medal a better than medal b (null = none)? */
export function betterMedal(a: Medal | null, b: Medal | null): boolean {
  if (a === null) return false;
  return b === null || MEDALS.indexOf(a) < MEDALS.indexOf(b);
}
