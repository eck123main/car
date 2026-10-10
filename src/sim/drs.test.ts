import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { F1_CAR } from '../physics/carParams';
import { BotDriver } from './ai/botDriver';
import { racingLine, speedProfile } from './ai/racingLine';
import { RaceWorld, type PlayerInput, type Racer } from './world';

const DT = 1 / 120;
const PRACTICE = { phase: 'practice' as const, raceStart: 0, laps: null, mandatoryStop: false };

function placeAt(track: Track, r: Racer, s: number, speed: number, lateral = 0): void {
  const n = track.samples.length;
  const t = track.samples[Math.floor((((s % track.length) + track.length) % track.length) / 2) % n];
  const h = Math.atan2(t.ty, t.tx);
  r.car.place(t.x + t.nx * lateral, t.y + t.ny * lateral, h);
  r.car.vx = Math.cos(h) * speed;
  r.car.vy = Math.sin(h) * speed;
}

describe.each(['silverstone', 'bahrain', 'albert-park', 'monaco', 'cota', 'spa', 'baku', 'yas-marina'])('DRS on %s', (id) => {
  const track = new Track(TRACKS[id]);
  const line = racingLine(track);
  const plan = speedProfile(track, line, F1_CAR, 0.8);
  /** The racing line at lap distance s. */
  const onLine = (s: number) => line.offset[Math.floor((((s % track.length) + track.length) % track.length) / 2) % track.samples.length];
  /** A speed any car can carry at lap distance s. */
  const safe = (s: number) => Math.min(55, plan[Math.floor((((s % track.length) + track.length) % track.length) / 2)]);

  it.each(track.drsZones.map((z, i) => [i, z] as const))('opens in zone %i in practice, and only there', (_i, zone) => {
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    const r = world.addRacer('a', 'A', 'red');
    const bot = new BotDriver(track, 'a', 'hard');
    // Just before the zone at a speed any corner before it allows.
    placeAt(track, r, zone.start - 20, 40);
    let openInZone = false;
    let openOutside = false;
    for (let t = 0; t < 6; t += DT) {
      world.step(DT, new Map([['a', { ...bot.drive(world, PRACTICE, DT), drs: true }]]));
      const s = r.timer.lapDistance!;
      // Ignore the step right at the edges, where it is opening/closing.
      if (r.drsOpen && track.inRange(s, zone.start + 3, zone.end - 3)) openInZone = true;
      if (r.drsOpen && !track.inRange(s, zone.start - 1, zone.end + 3)) openOutside = true;
    }
    expect(openInZone).toBe(true);
    expect(openOutside).toBe(false);
  });

  it.each(track.drsZones.map((z, i) => [i, z] as const))('in a race, only the car within a second at detection gets it (zone %i)', (_i, zone) => {
    const world = new RaceWorld(track, { drsRule: 'race', wetness: 0 });
    const ahead = world.addRacer('a', 'A', 'red');
    const behind = world.addRacer('b', 'B', 'blue');
    ahead.timer.lapsCompleted = behind.timer.lapsCompleted = 1;
    placeAt(track, ahead, zone.detect - 25, safe(zone.detect - 25), onLine(zone.detect - 25));
    placeAt(track, behind, zone.detect - 40, safe(zone.detect - 40), onLine(zone.detect - 40));
    const bots = [new BotDriver(track, 'a', 'hard'), new BotDriver(track, 'b', 'hard')];
    let aheadOpen = false;
    let behindOpen = false;
    for (let t = 0; t < 7; t += DT) {
      const inputs = new Map<string, PlayerInput>(bots.map((b) => [b.id, { ...b.drive(world, PRACTICE, DT), drs: true }]));
      world.step(DT, inputs);
      aheadOpen ||= ahead.drsOpen;
      behindOpen ||= behind.drsOpen;
    }
    expect(behindOpen).toBe(true);
    expect(aheadOpen).toBe(false);
  });

  it('a car that is not racing (wrecked, or in the pit lane) does not give DRS to the car behind', () => {
    const zone = track.drsZones[0];
    const world = new RaceWorld(track, { drsRule: 'race', wetness: 0 });
    const ahead = world.addRacer('a', 'A', 'red');
    const behind = world.addRacer('b', 'B', 'blue');
    ahead.timer.lapsCompleted = behind.timer.lapsCompleted = 1;
    placeAt(track, ahead, zone.detect - 25, safe(zone.detect - 25), onLine(zone.detect - 25));
    placeAt(track, behind, zone.detect - 40, safe(zone.detect - 40), onLine(zone.detect - 40));
    const bots = [new BotDriver(track, 'a', 'hard'), new BotDriver(track, 'b', 'hard')];
    let behindOpen = false;
    for (let t = 0; t < 7; t += DT) {
      ahead.car.retired = true;
      const inputs = new Map<string, PlayerInput>(bots.map((b) => [b.id, { ...b.drive(world, PRACTICE, DT), drs: true }]));
      world.step(DT, inputs);
      behindOpen ||= behind.drsOpen;
    }
    expect(behindOpen).toBe(false);
  });
});

describe.each(['silverstone', 'bahrain', 'albert-park', 'monaco', 'cota', 'spa', 'baku', 'yas-marina'])('DRS fairness on %s', (id) => {
  const track = new Track(TRACKS[id]);

  /** A Hard bot's flying lap time, using DRS wherever it's allowed or never. */
  function lap(drs: boolean): number {
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    const r = world.addRacer('a', 'A', 'red');
    const s0 = track.samples[track.samples.length - 10];
    r.car.place(s0.x, s0.y, Math.atan2(s0.ty, s0.tx));
    const bot = new BotDriver(track, 'a', 'hard');
    const laps: number[] = [];
    for (let t = 0; t < 300 && laps.length < 2; t += DT) {
      for (const e of world.step(DT, new Map([['a', { ...bot.drive(world, PRACTICE, DT), drs }]]))) if (e.kind === 'lap') laps.push(e.lap.time);
    }
    return laps[1];
  }

  it('DRS is worth about the same on every track (0.4-1.2 s a lap)', () => {
    const gain = lap(false) - lap(true);
    expect(gain).toBeGreaterThan(0.4);
    expect(gain).toBeLessThan(1.2);
  }, 30_000);
});
