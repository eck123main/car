import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAILY_REWARDS, SPIN_PRIZES } from '../net/wallet';
import { MEDAL_TRACK_COUNT, medalTimes } from '../sim/medals';
import { REAL_TRACK_IDS } from '../tracks';
import { medalCounts, SKINS, skinUnlocked, TEAM_SKIN } from './skins';

const SQL = readFileSync(new URL('../../supabase/economy.sql', import.meta.url), 'utf8');

describe('Skins', () => {
  it('have unique ids, and the shop prices match the database', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    const shop = Object.fromEntries([...SQL.matchAll(/\('([a-z-]+)', (\d+)\)/g)].map((m) => [m[1], Number(m[2])]));
    expect(shop).toEqual(Object.fromEntries(SKINS.filter((s) => s.price !== undefined).map((s) => [s.id, s.price])));
    // The database lets any medal-... id be equipped (medals are checked by the game).
    for (const s of SKINS.filter((s) => s.unlock)) expect(s.id).toMatch(/^medal-[a-z]+$/);
  });

  it('daily rewards and spin prizes match the database', () => {
    expect(SQL).toContain(`array[${DAILY_REWARDS.join(', ')}]`);
    expect(SQL).toContain(`array[${SPIN_PRIZES.map((p) => `'${p.prize}'`).join(', ')}]`);
    expect(SQL).toContain(`array[${SPIN_PRIZES.map((p) => p.weight).join(', ')}]`);
    expect(SPIN_PRIZES.reduce((a, p) => a + p.weight, 0)).toBe(100);
  });

  it('count a medal towards every lower one, and unlock medal skins from the counts', () => {
    const [a, b, c] = REAL_TRACK_IDS.filter((id) => medalTimes(id));
    const bests = { [a]: medalTimes(a)!.author, [b]: medalTimes(b)!.silver, [c]: medalTimes(c)!.bronze + 1 };
    expect(medalCounts(bests, REAL_TRACK_IDS)).toEqual({ author: 1, gold: 1, silver: 2, bronze: 2 });
    const gold = SKINS.find((s) => s.id === 'medal-gold')!;
    expect(skinUnlocked(gold, [], { author: 0, gold: 19, silver: 30, bronze: 30 })).toBe(false);
    expect(skinUnlocked(gold, [], { author: 0, gold: 20, silver: 20, bronze: 20 })).toBe(true);
    expect(SKINS.find((s) => s.id === 'medal-perfect')!.unlock!.count).toBe(MEDAL_TRACK_COUNT);
  });

  it('need buying from the shop, except the team livery', () => {
    const neon = SKINS.find((s) => s.id === 'neon')!;
    const none = { author: 0, gold: 0, silver: 0, bronze: 0 };
    expect(skinUnlocked(neon, [], none)).toBe(false);
    expect(skinUnlocked(neon, ['neon'], none)).toBe(true);
    expect(skinUnlocked(SKINS.find((s) => s.id === TEAM_SKIN)!, [], none)).toBe(true);
  });
});
