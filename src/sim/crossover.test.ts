import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { BotDriver } from './ai/botDriver';
import { racingLine } from './ai/racingLine';
import { DEFAULT_SETTINGS, Session } from './session';
import { RaceWorld, type PlayerInput, type Racer } from './world';

const DT = 1 / 120;
const PRACTICE = { phase: 'practice' as const, raceStart: 0, laps: null, mandatoryStop: false };

// Suzuka is a figure of eight: the road crosses itself at the bridge.
const track = new Track(TRACKS.suzuka);
const line = racingLine(track);

/** Lap distances of the two roads where they cross. */
function crossing(): [number, number] {
  const ss = track.samples;
  const n = ss.length;
  for (let i = 0; i < n; i++) {
    const a = ss[i];
    const b = ss[(i + 1) % n];
    for (let j = i + 50; j < n; j++) {
      // Two different parts of the lap (not the end of the lap meeting its start).
      let ds = Math.abs(ss[j].s - a.s);
      ds = Math.min(ds, track.length - ds);
      if (ds < 100) continue;
      const c = ss[j];
      const d = ss[(j + 1) % n];
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [a.s, c.s];
    }
  }
  throw new Error('no crossing');
}

/** On the racing line (or the centreline), `before` metres short of lap distance s, at speed. */
function placeBefore(r: Racer, s: number, before: number, speed: number, onRacingLine = true): void {
  const i = Math.floor((((s - before) % track.length) + track.length) % track.length / 2);
  const t = track.samples[i];
  const h = Math.atan2(t.ty, t.tx);
  const lateral = onRacingLine ? line.offset[i] : 0;
  r.car.place(t.x + t.nx * lateral, t.y + t.ny * lateral, h, i);
  r.car.vx = Math.cos(h) * speed;
  r.car.vy = Math.sin(h) * speed;
}

describe("Suzuka's crossover", () => {
  const [sA, sB] = crossing();

  it('cars on the two roads go over and under each other without touching', () => {
    // Along the centre of each road, on a timing sweep so that some runs meet right on the crossing.
    let closest = Infinity;
    const steady = { throttle: 0, brake: 0, steer: 0, drs: false, ers: false, limiter: false, nextTyre: 'medium' as const };
    for (let offset = 44; offset <= 64; offset += 2) {
      const world = new RaceWorld(track, { drsRule: 'race', wetness: 0, collisions: true });
      const a = world.addRacer('a', 'A', 'red');
      const b = world.addRacer('b', 'B', 'blue');
      placeBefore(a, sA, 40, 25, false);
      placeBefore(b, sB, offset, 25, false);
      let contact = false;
      for (let t = 0; t < 3.5; t += DT) {
        for (const e of world.step(DT, new Map([['a', steady], ['b', steady]]))) if (e.kind === 'contact') contact = true;
        closest = Math.min(closest, Math.hypot(a.car.x - b.car.x, a.car.y - b.car.y));
      }
      expect(contact).toBe(false);
      // Each went straight on along its own road.
      for (const [r, s0] of [[a, sA], [b, sB]] as const) {
        const q = track.query(r.car.x, r.car.y, r.car.trackIndex)!;
        expect(track.forwardDistance(s0, q.s)).toBeGreaterThan(10);
        expect(track.forwardDistance(s0, q.s)).toBeLessThan(90);
      }
    }
    // They really did pass right over each other (cars that can collide are pushed at least a
    // car's width apart).
    expect(closest).toBeLessThan(1);
  });

  it('a bot races through the crossing while another car goes over it', () => {
    const world = new RaceWorld(track, { drsRule: 'race', wetness: 0, collisions: true });
    const a = world.addRacer('a', 'A', 'red');
    const b = world.addRacer('b', 'B', 'blue');
    const bots = [new BotDriver(track, 'a', 'hard'), new BotDriver(track, 'b', 'hard')];
    placeBefore(a, sA, 60, 40);
    placeBefore(b, sB, 60, 40);
    let contact = false;
    for (let t = 0; t < 4; t += DT) {
      const inputs = new Map<string, PlayerInput>(bots.map((bot) => [bot.id, bot.drive(world, PRACTICE, DT)]));
      for (const e of world.step(DT, inputs)) if (e.kind === 'contact') contact = true;
    }
    expect(contact).toBe(false);
    for (const [r, s0] of [[a, sA], [b, sB]] as const) {
      const q = track.query(r.car.x, r.car.y, r.car.trackIndex)!;
      expect(track.forwardDistance(s0, q.s)).toBeGreaterThan(50);
      expect(track.forwardDistance(s0, q.s)).toBeLessThan(250);
    }
  });

  it.each([
    ['first', 0],
    ['second', 1],
  ] as const)('a car reset right on the crossing (%s road) goes back onto its own road', (_name, which) => {
    const s = which === 0 ? sA : sB;
    const players = [{ id: 'a', name: 'A', color: 'red' }];
    const session = new Session(track, { ...DEFAULT_SETTINGS, trackId: 'suzuka', laps: 5, qualifying: false }, players);
    for (let t = 0; t < 30 && session.phase !== 'race'; t += DT) session.step(DT, new Map([['a', { throttle: 0, brake: 0, steer: 0, drs: false, ers: false, limiter: false, nextTyre: 'medium', ready: true }]]));
    const r = session.world.racer('a')!;
    // Stopped right on the crossing, on this road.
    placeBefore(r, s, 0, 0);
    r.car.retired = true;
    const idle = { throttle: 0, brake: 0, steer: 0, drs: false, ers: false, limiter: false, nextTyre: 'medium' as const };
    session.step(DT, new Map([['a', { ...idle, reset: true }]]));
    for (let t = 0; t < 7; t += DT) session.step(DT, new Map([['a', idle]]));
    const q = track.query(r.car.x, r.car.y, r.car.trackIndex)!;
    let ds = Math.abs(q.s - s);
    ds = Math.min(ds, track.length - ds);
    expect(ds).toBeLessThan(10);
    // Pointing along that road.
    const tangent = Math.atan2(q.sample.ty, q.sample.tx);
    expect(Math.cos(r.car.heading - tangent)).toBeGreaterThan(0.95);
  });
});
