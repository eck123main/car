import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { botInput, type BotOptions } from './bot';
import { DEFAULT_SETTINGS, Session, type RaceSettings, type SessionEvent, type SessionPhase } from './session';
import { penaltyTime, type PlayerInput } from './world';

const DT = 1 / 120;
const track = new Track(TRACKS.test);
const PLAYERS = [
  { id: 'a', name: 'A', color: 'red' },
  { id: 'b', name: 'B', color: 'blue' },
  { id: 'c', name: 'C', color: 'green' },
];

/** Run a session with bots until `until` phase (or timeout). */
function run(
  settings: Partial<RaceSettings>,
  bots: Record<string, BotOptions>,
  until: SessionPhase,
  maxSeconds = 900,
  onStep?: (s: Session) => void,
) {
  const session = new Session(track, { ...DEFAULT_SETTINGS, trackId: 'test', ...settings }, PLAYERS);
  const events: SessionEvent[] = [];
  for (let t = 0; t < maxSeconds && session.phase !== until; t += DT) {
    const inputs = new Map<string, PlayerInput>();
    for (const r of session.world.racers) {
      const opts = bots[r.id] ?? {};
      // Bots wait for lights out unless told not to (to test jump starts).
      const waiting = session.phase === 'grid' || session.phase === 'lights';
      // Everyone starts on mediums; nextTyre is what they fit at their stop.
      const nextTyre = waiting ? 'medium' : opts.nextTyre;
      inputs.set(r.id, botInput(track, r, { ...opts, nextTyre, hold: waiting ? (opts.hold ?? true) : false }));
    }
    events.push(...session.step(DT, inputs));
    onStep?.(session);
  }
  return { session, events };
}

describe('Session', () => {
  it('releases qualifiers one at a time and builds the grid from lap times', () => {
    const releases: Record<string, number> = {};
    // b drives fastest, c slowest.
    const { session } = run({}, { a: { grip: 20 }, b: { grip: 26 }, c: { grip: 14 } }, 'grid', 900, (s) => {
      for (const r of s.world.racers) if (!r.frozen && releases[r.id] === undefined) releases[r.id] = s.world.time;
    });
    expect(releases.b - releases.a).toBeCloseTo(DEFAULT_SETTINGS.releaseGap, 1);
    expect(releases.c - releases.b).toBeCloseTo(DEFAULT_SETTINGS.releaseGap, 1);
    for (const id of ['a', 'b', 'c']) expect(session.quali.get(id)!.time).not.toBeNull();
    expect(session.gridOrder).toEqual(['b', 'a', 'c']);
    // Pole is closest to the line.
    const poleS = session.world.racer('b')!.car;
    const lastS = session.world.racer('c')!.car;
    const q1 = track.query(poleS.x, poleS.y)!;
    const q3 = track.query(lastS.x, lastS.y)!;
    expect(q1.s).toBeGreaterThan(q3.s);
  });

  it('shows five lights then starts the race; moving early is a jump start', () => {
    const lightsSeen = new Set<number>();
    const { session, events } = run(
      { qualifying: false },
      { a: { hold: false } },
      'race',
      30,
      (s) => lightsSeen.add(s.lights),
    );
    expect(session.phase).toBe('race');
    expect([...lightsSeen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const penalties = events.filter((e) => e.kind === 'penalty');
    expect(penalties.map((e) => e.racerId)).toEqual(['a']);
  });

  it('runs a race to the finish with a mandatory stop penalty for non-stoppers', () => {
    const { session, events } = run(
      { qualifying: false, laps: 4 },
      // Separate lines so the bots don't run into each other.
      { a: { pitOnLap: 1, nextTyre: 'hard', offset: -3.5 }, b: { offset: 0 }, c: { pitOnLap: 2, nextTyre: 'medium', offset: 3.5 } },
      'finished',
      900,
      // The test bots aren't racers and crash into each other; collisions have their own tests.
      (s) => (s.world.options.collisions = false),
    );
    expect(session.phase).toBe('finished');
    const standings = session.standings();
    expect(standings.every((s) => s.status === 'finished')).toBe(true);
    expect(standings.every((s) => s.laps >= 4)).toBe(true);
    // b never stopped; c stopped but kept mediums: both break the two-compound rule.
    const reasons = events.flatMap((e) => (e.kind === 'penalty' ? [`${e.racerId}:${e.penalty.reason}`] : []));
    expect(reasons).toContain('b:No pit stop / one compound');
    expect(reasons).toContain('c:No pit stop / one compound');
    expect(reasons.some((r) => r.startsWith('a:No pit'))).toBe(false);
    // Totals include penalties and are in order.
    const totals = standings.map((s) => s.totalTime!);
    expect([...totals].sort((x, y) => x - y)).toEqual(totals);
  });

  it('a wet race has a soaked track and no DRS', () => {
    const { session } = run({ qualifying: false, weather: 'wet', laps: 2 }, {}, 'race', 30);
    expect(session.world.options.wetness).toBe(1);
    let drs = false;
    for (let t = 0; t < 120; t += DT) {
      const inputs = new Map(session.world.racers.map((r) => [r.id, { ...botInput(track, r), drs: true }] as const));
      session.step(DT, inputs);
      drs ||= session.world.racers.some((r) => r.drsOpen);
    }
    expect(drs).toBe(false);
  });
});

describe('Reset (R)', () => {
  const step = (s: Session, reset: string | null) => {
    const inputs = new Map<string, PlayerInput>();
    const waiting = s.phase === 'grid' || s.phase === 'lights';
    for (const r of s.world.racers) inputs.set(r.id, { ...botInput(track, r, { hold: waiting }), reset: r.id === reset });
    return s.step(DT, inputs);
  };

  it('puts a crashed car back on track in a race after a 5 s wait', () => {
    const s = new Session(track, { ...DEFAULT_SETTINGS, trackId: 'test', qualifying: false }, PLAYERS);
    while (s.phase !== 'race') step(s, null);
    for (let t = 0; t < 5; t += DT) step(s, null);
    const a = s.world.racer('a')!;
    a.car.impact(30, 2.6, 0);
    expect(a.car.retired).toBe(true);
    step(s, 'a');
    // Waiting: still wrecked, held in place as a ghost.
    expect(a.frozen).toBe(true);
    for (let t = 0; t < 4.5; t += DT) step(s, t < 1 ? 'a' : null); // mashing R doesn't restart the wait
    expect(a.car.retired).toBe(true);
    for (let t = 0; t < 0.6; t += DT) step(s, null);
    expect(a.car.retired).toBe(false);
    expect(a.frozen).toBe(false);
    expect(a.car.damage).toBe(0);
    expect(penaltyTime(a)).toBe(0);
    const q = track.query(a.car.x, a.car.y)!;
    expect(Math.abs(q.d)).toBeLessThan(1);
  });

  it('loses the timed lap in qualifying', () => {
    const s = new Session(track, { ...DEFAULT_SETTINGS, trackId: 'test' }, PLAYERS);
    let guard = 0;
    while (s.quali.get('a')!.status !== 'flying' && guard++ < 120 * 200) step(s, null);
    expect(s.quali.get('a')!.status).toBe('flying');
    step(s, 'a');
    expect(s.quali.get('a')!.status).toBe('done');
    expect(s.quali.get('a')!.time).toBeNull();
    expect(s.recovering.has('a')).toBe(true);
  });
});
