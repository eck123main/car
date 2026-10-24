import ratios from '../tracks/elevation-ratios.json';
import groundRatios from '../tracks/ground-ratios.json';
import type { KeyValue } from './leaderboard';

/**
 * One-time rescaling of lap times kept in this browser when a physics change moved lap times
 * (the elevation update): the local leaderboard, its ghosts and personal best ghosts. The
 * global board gets the same from supabase/elevation_adjust.sql. Each change is applied once,
 * remembered under its name.
 */

export const ELEVATION_ADJUSTMENT = 'elevation-2026-10';

/**
 * Every adjustment so far, oldest first (each on top of the ones before): the elevation update,
 * then the smoother hills and evened-out heights of the 3D ground fix (supabase/ground_adjust.sql).
 */
export const ADJUSTMENTS: { name: string; factors: Record<string, number> }[] = [
  { name: ELEVATION_ADJUSTMENT, factors: ratios },
  { name: 'ground-2026-10', factors: groundRatios },
];

/** Apply every adjustment this browser hasn't had yet, in order. */
export function adjustAllStoredTimes(kv: KeyValue, keys: string[]): void {
  for (const a of ADJUSTMENTS) adjustStoredTimes(kv, keys, a.factors, a.name);
}

interface Lap {
  time: number;
  sectors?: number[];
}
interface StoredGhost {
  time: number;
  dt: number;
}

export function adjustStoredTimes(kv: KeyValue, keys: string[], factors: Record<string, number> = ratios, name = ELEVATION_ADJUSTMENT): void {
  const done = `f1td.adjusted.${name}`;
  if (kv.getItem(done)) return;
  const scale = (key: string, track: string, fix: (value: unknown, r: number) => unknown) => {
    const r = factors[track];
    if (r === undefined || r === 1) return;
    try {
      const raw = kv.getItem(key);
      if (raw !== null) kv.setItem(key, JSON.stringify(fix(JSON.parse(raw), r)));
    } catch {
      // Unreadable: left as it was.
    }
  };
  const lap = (l: Lap, r: number): Lap => ({ ...l, time: round(l.time * r), ...(Array.isArray(l.sectors) ? { sectors: l.sectors.map((s) => round(s * r)) } : {}) });
  // A ghost replays in the adjusted time: its sample interval stretches with it.
  const ghost = (g: StoredGhost, r: number): StoredGhost => ({ ...g, time: round(g.time * r), dt: g.dt * r });
  for (const key of keys) {
    let m = key.match(/^f1td\.tt\.([a-z0-9-]+)$/);
    if (m) {
      scale(key, m[1], (v, r) => (Array.isArray(v) ? (v as Lap[]).map((l) => lap(l, r)) : v));
      continue;
    }
    m = key.match(/^f1td\.tt\.ghost\.([a-z0-9-]+)\./) ?? key.match(/^f1td\.tt\.pb\.(?:.+\.)?([a-z0-9-]+)$/);
    if (m) scale(key, m[1], (v, r) => ghost(v as StoredGhost, r));
  }
  kv.setItem(done, '1');
}

function round(t: number): number {
  return Math.round(t * 1000) / 1000;
}
