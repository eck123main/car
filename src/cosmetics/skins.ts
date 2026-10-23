import type { Livery } from '../render/livery';
import { MEDAL_TRACK_COUNT, MEDALS, medalFor, medalTimes, type Medal } from '../sim/medals';

/**
 * Car skins: a paint scheme that replaces the team livery on your car. Bought in the garage with
 * coins, or unlocked by time trial medals. The lobby colour stays your identity on the minimap
 * and name tags, so a skin never makes two players hard to tell apart there.
 *
 * Shop prices are checked by the database too (`supabase/economy.sql`, table `skin_shop`); a
 * test keeps the two lists the same.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'medal';

export interface SkinDef {
  id: string;
  name: string;
  rarity: Rarity;
  /** Null for the team livery (the lobby colour's own scheme). */
  livery: Livery | null;
  /** Coins, for skins sold in the shop. */
  price?: number;
  /** Medal skins: this many tracks with this medal or better. */
  unlock?: { medal: Medal; count: number };
}

/** The default: no skin, your lobby colour's team livery. */
export const TEAM_SKIN = 'team';

export const RARITY_NAMES: Record<Rarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', medal: 'Medal' };
export const RARITY_COLORS: Record<Rarity, string> = { common: '#b9bcc6', rare: '#4da3ff', epic: '#c86bff', medal: '#ffc83d' };

export const SKINS: SkinDef[] = [
  { id: TEAM_SKIN, name: 'Team livery', rarity: 'common', livery: null },
  // Shop: common.
  { id: 'midnight', name: 'Midnight', rarity: 'common', price: 300, livery: { body: '#15171c', stripe: '#3b3f4a', nose: '#3b3f4a', wings: '#0a0a0a', endplates: '#3b3f4a', helmet: '#e8e8e8' } },
  { id: 'arctic', name: 'Arctic', rarity: 'common', price: 300, livery: { body: '#f2f6fa', pods: '#9fd8ff', nose: '#9fd8ff', wings: '#2a3a4a', endplates: '#f2f6fa', helmet: '#2a7fd4' } },
  { id: 'lime', name: 'Lime Rush', rarity: 'common', price: 300, livery: { body: '#a6e22e', stripe: '#1a1a1a', nose: '#1a1a1a', wings: '#1a1a1a', endplates: '#a6e22e', helmet: '#ffffff' } },
  { id: 'heritage', name: 'Heritage Green', rarity: 'common', price: 300, livery: { body: '#0f4d2c', stripe: '#ffd400', nose: '#ffd400', wings: '#0a2a18', endplates: '#0f4d2c', helmet: '#ffd400' } },
  // Shop: rare.
  { id: 'sunset', name: 'Sunset', rarity: 'rare', price: 750, livery: { body: '#5b2a86', front: '#ff7a1a', flash: '#ffd23f', nose: '#ff7a1a', wings: '#2b1240', endplates: '#ff7a1a', helmet: '#ffd23f' } },
  { id: 'retro', name: 'Retro Blue', rarity: 'rare', price: 750, livery: { body: '#8ecae6', stripe: '#ff8c1a', pods: '#8ecae6', nose: '#ff8c1a', wings: '#1d3557', endplates: '#ff8c1a', helmet: '#ffffff' } },
  { id: 'neon', name: 'Neon Night', rarity: 'rare', price: 750, livery: { body: '#0d0d14', flash: '#ff2bd6', stripe: '#00f0ff', nose: '#00f0ff', wings: '#0d0d14', endplates: '#ff2bd6', helmet: '#00f0ff' } },
  { id: 'chequered', name: 'Chequered Flag', rarity: 'rare', price: 750, livery: { body: '#f2f2f2', checks: '#111111', nose: '#111111', wings: '#111111', endplates: '#f2f2f2', helmet: '#e10600' } },
  // Shop: epic.
  { id: 'chrome', name: 'Chrome', rarity: 'epic', price: 1500, livery: { body: '#b8c0c8', front: '#dfe5ea', stripe: '#6f7a85', nose: '#6f7a85', wings: '#2a2f35', endplates: '#dfe5ea', helmet: '#111111', shine: true } },
  { id: 'carbon', name: 'Carbon Fibre', rarity: 'epic', price: 1500, livery: { body: '#1c1c1c', checks: '#262626', stripe: '#e10600', nose: '#e10600', wings: '#0e0e0e', endplates: '#e10600', helmet: '#e8e8e8', shine: true } },
  { id: 'inferno', name: 'Inferno', rarity: 'epic', price: 1500, livery: { body: '#c40000', front: '#ff7b00', flash: '#ffe14d', nose: '#ffe14d', wings: '#3a0000', endplates: '#ff7b00', helmet: '#ffe14d', shine: true } },
  // Medal skins, painted like the medals. Perfectionist: author on every track.
  { id: 'medal-bronze', name: 'Bronze', rarity: 'medal', unlock: { medal: 'bronze', count: 10 }, livery: { body: '#a4652f', stripe: '#e0a46b', nose: '#e0a46b', wings: '#4a2a12', endplates: '#d08a4f', helmet: '#e0a46b', shine: true } },
  { id: 'medal-silver', name: 'Silver', rarity: 'medal', unlock: { medal: 'silver', count: 15 }, livery: { body: '#aeb6bf', front: '#e3e8ed', stripe: '#ffffff', nose: '#ffffff', wings: '#3b4047', endplates: '#c9d1d9', helmet: '#ffffff', shine: true } },
  { id: 'medal-gold', name: 'Gold', rarity: 'medal', unlock: { medal: 'gold', count: 20 }, livery: { body: '#d9a21b', flash: '#fff1b0', stripe: '#8a5d00', nose: '#fff1b0', wings: '#3a2a00', endplates: '#ffc83d', helmet: '#fff1b0', shine: true } },
  { id: 'medal-author', name: 'Author', rarity: 'medal', unlock: { medal: 'author', count: 5 }, livery: { body: '#0e8f5c', flash: '#7dffc6', stripe: '#1fd38a', nose: '#7dffc6', wings: '#05301f', endplates: '#1fd38a', helmet: '#ffffff', shine: true } },
  { id: 'medal-perfect', name: 'Perfectionist', rarity: 'medal', unlock: { medal: 'author', count: MEDAL_TRACK_COUNT }, livery: { body: '#0b0b0b', front: '#1fd38a', checks: '#151515', flash: '#ffc83d', nose: '#ffc83d', wings: '#0b0b0b', endplates: '#1fd38a', helmet: '#ffc83d', shine: true } },
];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function skinDef(id: string | undefined): SkinDef | undefined {
  return id === undefined ? undefined : BY_ID.get(id);
}

export function isSkinId(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id);
}

/** The livery a skin paints, or null for the team livery (and unknown ids). */
export function skinLivery(id: string | undefined): Livery | null {
  return skinDef(id)?.livery ?? null;
}

/** How many tracks have each medal or better (an author medal also counts as gold, silver, bronze). */
export type MedalCounts = Record<Medal, number>;

export function medalCounts(bests: Record<string, number>, tracks: string[]): MedalCounts {
  const counts: MedalCounts = { author: 0, gold: 0, silver: 0, bronze: 0 };
  for (const t of tracks) {
    const times = medalTimes(t);
    const got = times ? medalFor(bests[t], times) : null;
    if (!got) continue;
    for (const m of MEDALS.slice(MEDALS.indexOf(got))) counts[m]++;
  }
  return counts;
}

/** Can this skin be equipped? Shop skins must be owned; medal skins need the medals. */
export function skinUnlocked(skin: SkinDef, owned: readonly string[], counts: MedalCounts): boolean {
  if (skin.unlock) return counts[skin.unlock.medal] >= skin.unlock.count;
  if (skin.price !== undefined) return owned.includes(skin.id);
  return true;
}
