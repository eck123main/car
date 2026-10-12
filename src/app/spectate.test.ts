import { describe, expect, it } from 'vitest';
import { sessionSnap } from '../net/snapshot';
import { botInput } from '../sim/bot';
import { DEFAULT_SETTINGS, Session } from '../sim/session';
import { IDLE_INPUT, type PlayerInput } from '../sim/world';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { cycle, isSpectating, watchable } from './spectate';

const DT = 1 / 120;
const track = new Track(TRACKS.test);
const players = ['me', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), color: 'red' }));

function run(session: Session, seconds: number, drivers: string[]): void {
  for (let t = 0; t < seconds; t += DT) {
    const waiting = session.phase === 'grid' || session.phase === 'lights';
    const inputs = new Map<string, PlayerInput>();
    for (const r of session.world.racers) {
      inputs.set(r.id, drivers.includes(r.id) && !waiting ? botInput(track, r) : { ...IDLE_INPUT, ready: true });
    }
    session.step(DT, inputs);
  }
}

describe('Spectating', () => {
  it('in qualifying: while waiting to go out and once done, not while out on track', () => {
    const session = new Session(track, { ...DEFAULT_SETTINGS, trackId: 'test', qualifying: true, releaseGap: 10 }, players);
    const watching = () => isSpectating(sessionSnap(session), session.world, 'me');
    // Everyone is waiting at first; "me" goes out first.
    expect(watching()).toBe(true);
    run(session, 4, ['me', 'b', 'c']);
    expect(session.quali.get('me')!.status).not.toBe('waiting');
    expect(watching()).toBe(false);
    // "b" is still waiting, so "b" is spectating meanwhile.
    expect(isSpectating(sessionSnap(session), session.world, 'c')).toBe(true);
    // Once "me" has set a time, back to watching.
    for (let t = 0; t < 200 && session.quali.get('me')!.status !== 'done'; t += 1) run(session, 1, ['me', 'b', 'c']);
    expect(session.quali.get('me')!.status).toBe('done');
    expect(watching()).toBe(true);
    // Only the cars still out on track are in the list.
    const list = watchable(sessionSnap(session), session.world, 'me');
    expect(list).not.toContain('me');
    expect(list.length).toBeGreaterThan(0);
    for (const id of list) expect(session.world.racer(id)!.frozen).toBe(false);
  }, 60_000);

  it('in a race: only once finished', () => {
    const session = new Session(track, { ...DEFAULT_SETTINGS, trackId: 'test', qualifying: false, laps: 1, mandatoryStop: false }, players);
    run(session, 15, ['me', 'b', 'c']);
    expect(session.phase).toBe('race');
    expect(isSpectating(sessionSnap(session), session.world, 'me')).toBe(false);
    for (let t = 0; t < 200 && !session.standings().some((s) => s.id === 'me' && s.status === 'finished'); t += 1) run(session, 1, ['me', 'b', 'c']);
    expect(isSpectating(sessionSnap(session), session.world, 'me')).toBe(true);
  }, 60_000);

  it('someone without a car (joined late) always spectates; practice never does', () => {
    const session = new Session(track, { ...DEFAULT_SETTINGS, trackId: 'test', qualifying: false }, players);
    expect(isSpectating(sessionSnap(session), session.world, 'late')).toBe(true);
    expect(watchable(sessionSnap(session), session.world, 'late')).toHaveLength(3);
    expect(isSpectating(null, session.world, 'me')).toBe(false);
  });

  it('left/right cycles through the drivers and wraps round', () => {
    const list = ['a', 'b', 'c'];
    expect(cycle(list, null, 1)).toBe('a');
    expect(cycle(list, 'a', 1)).toBe('b');
    expect(cycle(list, 'c', 1)).toBe('a');
    expect(cycle(list, 'a', -1)).toBe('c');
    expect(cycle(list, 'gone', 1)).toBe('a');
    expect(cycle([], 'a', 1)).toBeNull();
  });
});
