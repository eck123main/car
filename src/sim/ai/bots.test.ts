import { describe, expect, it } from 'vitest';
import { Track } from '../../track/track';
import { TRACKS } from '../../tracks';
import { DEFAULT_SETTINGS, Session, type SessionEvent } from '../session';
import { RaceWorld, type PlayerInput } from '../world';
import { BotDriver, DIFFICULTIES, type Difficulty } from './botDriver';
import { racingLine } from './racingLine';

const DT = 1 / 120;
const REAL_TRACKS = ['silverstone', 'bahrain'] as const;

describe('Racing line', () => {
  it.each(REAL_TRACKS)('stays inside the track on %s', (id) => {
    const track = new Track(TRACKS[id]);
    const line = racingLine(track);
    track.samples.forEach((s, i) => expect(Math.abs(line.offset[i])).toBeLessThanOrEqual(s.halfWidth - 2));
  });
});

describe('Bots on their own', () => {
  it.each(REAL_TRACKS)('lap %s cleanly, harder bots faster', (id) => {
    const track = new Track(TRACKS[id]);
    const lapTimes: Record<string, number> = {};
    for (const diff of DIFFICULTIES) {
      const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
      const r = world.addRacer('b', 'B', 'red');
      const s0 = track.samples[track.samples.length - 10];
      r.car.place(s0.x, s0.y, Math.atan2(s0.ty, s0.tx));
      const bot = new BotDriver(track, 'b', diff);
      const laps: number[] = [];
      let walls = 0;
      for (let t = 0; t < 200 && laps.length < 2; t += DT) {
        const input = bot.drive(world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT);
        const before = r.car.lastImpact;
        for (const e of world.step(DT, new Map([['b', input]]))) if (e.kind === 'lap') laps.push(e.lap.time);
        if (r.car.lastImpact !== before) walls++;
      }
      expect(laps).toHaveLength(2);
      expect(walls).toBe(0);
      expect(r.timer.trackLimitWarnings).toBe(0);
      lapTimes[diff] = laps[1];
    }
    expect(lapTimes.hard).toBeLessThan(lapTimes.medium);
    expect(lapTimes.medium).toBeLessThan(lapTimes.easy);
  }, 30_000);
});

function race(id: string, grid: Difficulty[], laps: number, qualifying: boolean) {
  const track = new Track(TRACKS[id]);
  const players = grid.map((d, i) => ({ id: `b${i}`, name: `${d} ${i}`, color: 'red' }));
  const session = new Session(track, { ...DEFAULT_SETTINGS, trackId: id, laps, qualifying }, players);
  const bots = grid.map((d, i) => new BotDriver(track, `b${i}`, d));
  const events: SessionEvent[] = [];
  for (let t = 0; t < 1500 && session.phase !== 'finished'; t += DT) {
    const ctx = { phase: session.phase, raceStart: session.raceStart, laps, mandatoryStop: true };
    const inputs = new Map<string, PlayerInput>();
    for (const b of bots) inputs.set(b.id, b.drive(session.world, ctx, DT));
    events.push(...session.step(DT, inputs));
  }
  return { session, events };
}

describe('Bot races', () => {
  it('a mixed grid races a full weekend without crashing out', () => {
    const grid: Difficulty[] = ['hard', 'medium', 'easy', 'hard', 'medium', 'easy', 'medium', 'hard'];
    const { session, events } = race('silverstone', grid, 4, true);
    expect(session.phase).toBe('finished');
    const standings = session.standings();
    expect(standings.filter((s) => s.status === 'dnf')).toHaveLength(0);
    expect(standings.every((s) => s.status === 'finished')).toBe(true);
    // Qualifying sorts them by pace.
    expect(session.gridOrder.slice(0, 3).map((id) => grid[+id.slice(1)])).toEqual(['hard', 'hard', 'hard']);
    // Clean racing: hardly any contact they caused, no jump starts.
    const atFault = events.filter((e) => e.kind === 'contact' && e.verdict === 'yourFault');
    expect(atFault.length).toBeLessThanOrEqual(3);
    expect(events.some((e) => e.kind === 'penalty' && e.penalty.reason === 'Jump start')).toBe(false);
    // Everyone makes the mandatory stop on a second compound.
    for (const r of session.world.racers) expect(new Set(r.compoundsUsed).size).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('a full grid of equal bots finishes without DNFs', () => {
    const { session } = race('bahrain', Array(10).fill('hard'), 3, false);
    expect(session.phase).toBe('finished');
    expect(session.standings().filter((s) => s.status === 'dnf')).toHaveLength(0);
  }, 60_000);
});
