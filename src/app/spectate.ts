import type { SessionSnap } from '../net/protocol';
import type { RaceWorld } from '../sim/world';

/**
 * Whether this player is watching others instead of driving: they joined after the
 * weekend started (no car), they're waiting for their qualifying run or have done it,
 * or they've finished the race. Practice has no session: always driving.
 */
export function isSpectating(session: SessionSnap | null, world: RaceWorld, meId: string): boolean {
  if (!session) return false;
  if (!world.racer(meId)) return true;
  if (session.phase === 'qualifying') {
    const q = session.quali.find(([id]) => id === meId)?.[1];
    return q?.status === 'waiting' || q?.status === 'done';
  }
  if (session.phase === 'race' || session.phase === 'finished') {
    return session.standings.find((s) => s.id === meId)?.status === 'finished';
  }
  return false;
}

/** The drivers to watch, in running order: the cars out on track (or everyone, if none are). */
export function watchable(session: SessionSnap, world: RaceWorld, meId: string): string[] {
  const order = session.standings.map((s) => s.id).filter((id) => id !== meId && world.racer(id));
  for (const r of world.racers) if (r.id !== meId && !order.includes(r.id)) order.push(r.id);
  const onTrack = order.filter((id) => !world.racer(id)!.frozen);
  return onTrack.length > 0 ? onTrack : order;
}

/** The next (dir 1) or previous (dir -1) driver to watch after `current`. */
export function cycle(list: string[], current: string | null, dir: 1 | -1): string | null {
  if (list.length === 0) return null;
  const i = current === null ? -1 : list.indexOf(current);
  if (i < 0) return list[0];
  return list[(i + dir + list.length) % list.length];
}
