import { describe, expect, it } from 'vitest';
import { LocalLeaderboard, type KeyValue } from '../net/leaderboard';
import { Track } from '../track/track';
import { REAL_TRACK_IDS, TRACKS } from '../tracks';
import { BotDriver } from './ai/botDriver';
import { boardKey, CAR_CLASSES, parseBoardKey, type CarClassId } from './carClass';
import { medalTimes } from './medals';
import { TimeTrial } from './timeTrial';
import { IDLE_INPUT, RaceWorld } from './world';

const DT = 1 / 120;

function memory(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** The Hard bot's first valid time trial lap in this class. */
function botLap(id: string, cls: CarClassId): number | null {
  const track = new Track(TRACKS[id]);
  const tt = new TimeTrial(track, boardKey(id, cls), 'Bot', 'red', cls);
  const bot = new BotDriver(track, 'me', 'hard', CAR_CLASSES[cls].params);
  let lap: number | null = null;
  tt.onLap = (l) => (lap = l.time);
  for (let t = 0; t < 200 && lap === null; t += DT) {
    tt.step(DT, bot.drive(tt.world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT));
  }
  return lap;
}

describe('Car classes', () => {
  it('keeps F1 laps under the plain track id and other classes apart', () => {
    expect(boardKey('silverstone', 'f1')).toBe('silverstone');
    expect(boardKey('silverstone', 'gt3')).toBe('silverstone@gt3');
    expect(parseBoardKey('silverstone@gt3')).toEqual({ track: 'silverstone', cls: 'gt3' });
    expect(parseBoardKey('red-bull-ring')).toEqual({ track: 'red-bull-ring', cls: 'f1' });
    // Every key fits the database's 40 characters.
    for (const id of REAL_TRACK_IDS) expect(boardKey(id, 'gt3').length).toBeLessThanOrEqual(40);
  });

  it('never mixes a GT3 lap into the F1 leaderboard', async () => {
    const board = new LocalLeaderboard(memory());
    await board.submit(boardKey('monza', 'gt3'), { player: 'a', name: 'A', time: 60, sectors: [] }, null);
    expect(await board.top('monza')).toEqual([]);
    expect((await board.top('monza@gt3')).map((e) => e.time)).toEqual([60]);
  });

  it('gives a GT3 no DRS and no ERS', () => {
    const track = new Track(TRACKS.silverstone);
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    const gt = world.addRacer('gt', 'GT', 'red', 'soft', 'gt3');
    const f1 = world.addRacer('f1', 'F1', 'blue', 'soft', 'f1');
    expect(gt.car.params).toBe(CAR_CLASSES.gt3.params);
    const zone = track.drsZones[0];
    for (const r of [gt, f1]) {
      const s = track.samples[Math.round((zone.start + 30) / (track.length / track.samples.length)) % track.samples.length];
      r.car.place(s.x, s.y, Math.atan2(s.ty, s.tx));
      r.car.vx = s.tx * 70;
      r.car.vy = s.ty * 70;
    }
    const flat = { ...IDLE_INPUT, throttle: 1, drs: true, ers: true };
    let gtDrs = false;
    let f1Drs = false;
    for (let i = 0; i < 120; i++) {
      world.step(DT, new Map([['gt', flat], ['f1', flat]]));
      gtDrs ||= gt.drsOpen || gt.ersActive;
      f1Drs ||= f1.drsOpen;
    }
    expect(f1Drs).toBe(true);
    expect(gtDrs).toBe(false);
    expect(gt.ers).toBe(1);
    expect(gt.drsHint).toBe('');
  });

  it('is clearly slower in a GT3 (more than the real ~1.35x: the game F1 has far more grip than a real one)', () => {
    for (const id of ['silverstone', 'monaco']) {
      const f1 = botLap(id, 'f1')!;
      const gt = botLap(id, 'gt3')!;
      expect(gt).not.toBeNull();
      expect(gt / f1).toBeGreaterThan(1.3);
      expect(gt / f1).toBeLessThan(1.65);
    }
  });

  it('has GT3 medals on every track with F1 medals, slower than the F1 ones', () => {
    for (const id of REAL_TRACK_IDS) {
      const f1 = medalTimes(id);
      if (!f1) continue;
      const gt = medalTimes(boardKey(id, 'gt3'));
      expect(gt, id).not.toBeNull();
      expect(gt!.author).toBeGreaterThan(f1.author * 1.2);
    }
  });

  it('slots the Hypercar between the F1 and the GT3', () => {
    for (const id of ['silverstone', 'monaco']) {
      const f1 = botLap(id, 'f1')!;
      const gt = botLap(id, 'gt3')!;
      const lmh = botLap(id, 'lmh')!;
      expect(lmh).not.toBeNull();
      expect(lmh / f1).toBeGreaterThan(1.12);
      expect(lmh / f1).toBeLessThan(1.35);
      expect(lmh).toBeLessThan(gt * 0.95);
    }
  });

  it('gives a Hypercar no DRS, and its hybrid (ERS) only from 190 km/h', () => {
    const track = new Track(TRACKS.silverstone);
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
    const r = world.addRacer('lmh', 'LMH', 'red', 'soft', 'lmh');
    expect(r.car.params).toBe(CAR_CLASSES.lmh.params);
    const zone = track.drsZones[0];
    const s = track.samples[Math.round((zone.start + 30) / (track.length / track.samples.length)) % track.samples.length];
    const flat = { ...IDLE_INPUT, throttle: 1, drs: true, ers: true };
    const run = (kmh: number) => {
      r.car.place(s.x, s.y, Math.atan2(s.ty, s.tx));
      r.car.vx = (s.tx * kmh) / 3.6;
      r.car.vy = (s.ty * kmh) / 3.6;
      let ers = false;
      let drs = false;
      // A quarter second: the throttle ramps up, the speed hardly changes.
      for (let i = 0; i < 30; i++) {
        world.step(DT, new Map([['lmh', flat]]));
        ers ||= r.ersActive;
        drs ||= r.drsOpen;
      }
      return { ers, drs };
    };
    expect(run(150)).toEqual({ ers: false, drs: false });
    expect(run(230)).toEqual({ ers: true, drs: false });
  });

  it('has Hypercar medals on every track with F1 medals, between the F1 and GT3 ones', () => {
    for (const id of REAL_TRACK_IDS) {
      const f1 = medalTimes(id);
      const gt = medalTimes(boardKey(id, 'gt3'));
      if (!f1 || !gt) continue;
      const lmh = medalTimes(boardKey(id, 'lmh'));
      expect(lmh, id).not.toBeNull();
      expect(lmh!.author).toBeGreaterThan(f1.author * 1.05);
      expect(lmh!.author).toBeLessThan(gt.author);
    }
  });
});
