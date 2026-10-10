import { describe, expect, it } from 'vitest';
import { Track } from '../../track/track';
import { TRACKS } from '../../tracks';
import { DEFAULT_SETTINGS, Session, type SessionEvent } from '../session';
import { RaceWorld, type PlayerInput } from '../world';
import { BotDriver, DIFFICULTIES, type Difficulty } from './botDriver';
import { racingLine } from './racingLine';

const DT = 1 / 120;
const REAL_TRACKS = ['silverstone', 'bahrain', 'albert-park', 'monaco', 'cota', 'spa', 'baku', 'yas-marina'] as const;

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

describe('Bot racecraft', () => {
  /** Separate sideways moves of at least `min` metres (a move in one direction, then the other...). */
  function countMoves(positions: number[], min = 1): number {
    let moves = 0;
    let anchor = positions[0];
    let dir = 0;
    for (const p of positions) {
      if (dir !== 0 && Math.sign(p - anchor) === dir) anchor = p; // still going the same way
      else if (Math.abs(p - anchor) >= min) {
        moves++;
        dir = Math.sign(p - anchor);
        anchor = p;
      }
    }
    return moves;
  }

  it.each(['medium', 'hard'] as const)('a %s bot defends with one move down a straight, never into the attacker', (diff) => {
    const track = new Track(TRACKS.baku);
    const line = racingLine(track);
    const world = new RaceWorld(track, { drsRule: 'race', wetness: 0 });
    const defender = world.addRacer('d', 'D', 'red');
    const attacker = world.addRacer('a', 'A', 'blue');
    const place = (r: typeof defender, s: number, speed: number) => {
      const i = Math.floor(s / 2) % track.samples.length;
      const t = track.samples[i];
      const h = Math.atan2(t.ty, t.tx);
      r.car.place(t.x + t.nx * line.offset[i], t.y + t.ny * line.offset[i], h);
      r.car.vx = Math.cos(h) * speed;
      r.car.vy = Math.sin(h) * speed;
    };
    // Baku's long, dead straight run to the line: the defender ahead, a faster car closing.
    const straight = { from: 4090, to: 4620 };
    place(defender, straight.from - 150, 70);
    place(attacker, straight.from - 200, 78);
    defender.timer.lapsCompleted = attacker.timer.lapsCompleted = 1;
    const bots = { d: new BotDriver(track, 'd', diff), a: new BotDriver(track, 'a', 'hard') };
    const ctx = { phase: 'race' as const, raceStart: -100, laps: 10, mandatoryStop: false };
    const positions: number[] = [];
    let contact = false;
    for (let t = 0; t < 12; t += DT) {
      const inputs = new Map<string, PlayerInput>([
        ['d', bots.d.drive(world, ctx, DT)],
        ['a', { ...bots.a.drive(world, ctx, DT), ers: true }],
      ]);
      for (const e of world.step(DT, inputs)) if (e.kind === 'contact') contact = true;
      const q = track.query(defender.car.x, defender.car.y)!;
      if (!track.inRange(q.s, straight.from, straight.to)) continue;
      if (defender.car.brake > 0.1) break;
      positions.push(q.d);
    }
    expect(positions.length).toBeGreaterThan(400);
    expect(countMoves(positions)).toBe(1);
    expect(contact).toBe(false);
  });
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
