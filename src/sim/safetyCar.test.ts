import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { botContext, BotDriver, type Difficulty } from './ai/botDriver';
import { botInput } from './bot';
import { DEFAULT_SETTINGS, Session, type RaceSettings, type SessionEvent } from './session';
import type { PlayerInput } from './world';

const DT = 1 / 120;

function race(id: string, settings: Partial<RaceSettings> = {}) {
  const track = new Track(TRACKS[id]);
  const grid: Difficulty[] = ['hard', 'medium', 'hard', 'medium', 'easy', 'hard'];
  const players = grid.map((_, i) => ({ id: `b${i}`, name: `B${i}`, color: 'red' }));
  const session = new Session(track, { ...DEFAULT_SETTINGS, trackId: id, laps: 5, qualifying: false, ...settings }, players);
  const bots = grid.map((d, i) => new BotDriver(track, `b${i}`, d));
  const events: SessionEvent[] = [];
  const step = () => {
    const ctx = botContext(session);
    const inputs = new Map<string, PlayerInput>(bots.map((b) => [b.id, b.drive(session.world, ctx, DT)]));
    const e = session.step(DT, inputs);
    events.push(...e);
    return e;
  };
  /** Run until a condition holds (or time runs out). */
  const runUntil = (done: () => boolean, seconds = 600) => {
    for (let t = 0; t < seconds && !done(); t += DT) step();
  };
  /** Distance from the leader back to the fourth car (the rest may be crashing behind). */
  const spread = () => {
    const p = session.world.racers.filter((r) => !r.car.retired && r.pit.phase === 'out').map((r) => session.progress(r));
    p.sort((a, b) => b - a);
    return p[0] - p[Math.min(3, p.length - 1)];
  };
  return { track, session, events, step, runUntil, spread };
}

describe('Safety car', () => {
  it('comes out for a wreck, bunches the field, comes in and restarts at the line', () => {
    // No stop owed, so the bunching isn't mixed up with pit stops.
    const { session, events, step, runUntil, spread } = race('silverstone', { mandatoryStop: false });
    // Into lap 2, then a car is wrecked.
    runUntil(() => session.phase === 'race' && session.world.racers.every((r) => r.timer.lapsCompleted >= 1));
    const victim = session.world.racers[4];
    victim.car.retired = true;
    step();
    expect(session.safetyCar).not.toBeNull();
    expect(events.some((e) => e.kind === 'safetyCar' && e.state === 'deployed')).toBe(true);
    // Every car is told: no overtaking. DRS is off.
    expect(session.noOvertaking.size).toBe(6);
    step();
    expect(session.world.options.drsDisabled).toBe(true);
    const spreadAtStart = spread();

    let maxBehind = -Infinity;
    runUntil(() => {
      const sc = session.safetyCar;
      // Nobody gets ahead of the safety car.
      if (sc) for (const r of session.world.racers) if (!r.car.retired) maxBehind = Math.max(maxBehind, session.progress(r) - sc.progress);
      return sc?.phase === 'inThisLap';
    }, 120);
    expect(session.safetyCar?.phase).toBe('inThisLap');
    expect(maxBehind).toBeLessThan(0);
    // The queue has closed up behind it.
    expect(spread()).toBeLessThan(spreadAtStart * 0.6);
    expect(spread()).toBeLessThan(250);

    runUntil(() => session.safetyCar === null, 120);
    expect(events.some((e) => e.kind === 'safetyCar' && e.state === 'in')).toBe(true);
    runUntil(() => events.some((e) => e.kind === 'safetyCar' && e.state === 'green'), 60);
    const states = events.flatMap((e) => (e.kind === 'safetyCar' ? [e.state] : []));
    expect(states).toEqual(['deployed', 'inThisLap', 'in', 'green']);

    runUntil(() => session.phase === 'finished');
    expect(session.phase).toBe('finished');
    // Bots obey the rules: no overtaking under it, nobody passes it.
    const scPenalties = events.filter((e) => e.kind === 'penalty' && /safety car/.test(e.penalty.reason));
    expect(scPenalties).toEqual([]);
  }, 60_000);

  it('bots never overtake under the safety car, even a slow human off the racing line', () => {
    const track = new Track(TRACKS.silverstone);
    const grid: Difficulty[] = ['hard', 'medium', 'hard', 'easy', 'hard'];
    const players = [{ id: 'h', name: 'Human', color: 'blue' }, ...grid.map((_, i) => ({ id: `b${i}`, name: `B${i}`, color: 'red' }))];
    const session = new Session(track, { ...DEFAULT_SETTINGS, trackId: 'silverstone', laps: 6, qualifying: false, mandatoryStop: false }, players);
    const bots = grid.map((d, i) => new BotDriver(track, `b${i}`, d));
    const humanAsBot = new BotDriver(track, 'h', 'hard');
    const events: SessionEvent[] = [];
    let slow = false;
    const step = () => {
      const ctx = botContext(session);
      const inputs = new Map<string, PlayerInput>(bots.map((b) => [b.id, b.drive(session.world, ctx, DT)]));
      const h = session.world.racer('h')!;
      // The human races normally (from pole), then under the safety car dawdles along well off the racing line.
      let input = slow ? botInput(track, h, { offset: 5 }) : humanAsBot.drive(session.world, ctx, DT);
      if (slow && h.car.speed > 26) input = { ...input, throttle: 0, brake: 0.5 };
      inputs.set('h', input);
      events.push(...session.step(DT, inputs));
    };
    for (let t = 0; t < 600 && !(session.phase === 'race' && session.world.racers.every((r) => r.timer.lapsCompleted >= 1)); t += DT) step();
    session.world.racers[3].car.retired = true;
    step();
    expect(session.safetyCar).not.toBeNull();
    slow = true;
    // Cars behind the human when it starts to dawdle: they must stay there.
    const h = session.world.racer('h')!;
    const behind = session.world.racers.filter((r) => r !== h && !r.car.retired && session.progress(r) < session.progress(h));
    expect(behind.length).toBeGreaterThanOrEqual(2);
    for (let t = 0; t < 60 && session.safetyCar; t += DT) step();
    // Everyone is still queued behind the human.
    for (const r of behind) if (!r.car.retired && r.pit.phase === 'out') expect(session.progress(r)).toBeLessThan(session.progress(h));
    const botPenalties = events.filter((e) => e.kind === 'penalty' && e.racerId !== 'h' && /safety car/.test(e.penalty.reason));
    expect(botPenalties).toEqual([]);
  }, 60_000);

  it('bots that still owe their stop take the cheap one under the safety car', () => {
    const { session, events, step, runUntil } = race('bahrain');
    runUntil(() => session.phase === 'race' && session.world.racers.every((r) => r.timer.lapsCompleted >= 1));
    session.world.racers[5].car.retired = true;
    step();
    expect(session.safetyCar).not.toBeNull();
    const before = events.length;
    runUntil(() => session.safetyCar === null, 150);
    const stops = events.slice(before).filter((e) => e.kind === 'pitStop');
    expect(stops.length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('penalises overtaking and passing the safety car, but only once per driver', () => {
    const { session, events, step, runUntil, track } = race('bahrain');
    runUntil(() => session.phase === 'race' && session.world.racers.every((r) => r.timer.lapsCompleted >= 1));
    session.world.racers[5].car.retired = true;
    step();
    // Let the queue form.
    runUntil(() => false, 15);
    const order = session.world.racers
      .filter((r) => !r.car.retired && r.pit.phase === 'out')
      .sort((a, b) => session.progress(b) - session.progress(a));
    const [leader, second] = order;
    // The second car jumps past the leader (as if it drove round it)...
    const move = (r: typeof leader, metres: number) => {
      const s = (r.timer.lapDistance! + metres) % track.length;
      const t = track.samples[Math.floor(s / 2)];
      r.car.place(t.x, t.y, Math.atan2(t.ty, t.tx));
    };
    const ahead = session.progress(leader) - session.progress(second) + 12;
    move(second, ahead);
    step();
    step();
    expect(second.penalties.map((p) => p.reason)).toEqual([`Overtaking ${leader.name} under the safety car`]);
    // ...then past the safety car itself: no second penalty.
    const sc = session.safetyCar!;
    move(second, sc.progress - session.progress(second) + 10);
    step();
    step();
    expect(second.penalties).toHaveLength(1);
    // Someone else passing the safety car is penalised.
    const third = order[2];
    move(third, sc.progress - session.progress(third) + 10);
    step();
    step();
    expect(third.penalties.map((p) => p.reason)).toContain('Passing the safety car');
    expect(events.filter((e) => e.kind === 'penalty' && e.racerId === leader.id)).toEqual([]);
  }, 60_000);

  it('stays in when the host turns it off, and is never sent out on the last lap', () => {
    const off = race('silverstone', { safetyCar: false });
    off.runUntil(() => off.session.phase === 'race' && off.session.world.time - off.session.raceStart > 20);
    off.session.world.racers[3].car.retired = true;
    off.step();
    expect(off.session.safetyCar).toBeNull();

    const last = race('silverstone', { laps: 2 });
    // On the last lap (and with no safety car already out from an earlier crash).
    last.runUntil(() => last.session.phase === 'race' && last.session.safetyCar === null && last.session.world.racers.some((r) => r.timer.lapsCompleted >= 1));
    last.session.world.racers[3].car.retired = true;
    last.step();
    expect(last.session.safetyCar).toBeNull();
  }, 60_000);
});
