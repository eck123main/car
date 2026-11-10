import { describe, expect, it } from 'vitest';
import { LocalLeaderboard, type KeyValue } from '../net/leaderboard';
import { Track } from '../track/track';
import { REAL_TRACK_IDS, TRACKS } from '../tracks';
import { BotDriver } from './ai/botDriver';
import { boardKey, CAR_CLASSES, parseBoardKey } from './carClass';
import { medalTimes } from './medals';
import { TimeTrial } from './timeTrial';
import { IDLE_INPUT, RaceWorld } from './world';

const DT = 1 / 120;

function memory(): KeyValue {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** The Hard bot's first valid time trial lap in this class. */
function botLap(id: string, cls: 'f1' | 'gt3'): number | null {
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

  it('is slower in a GT3, by about as much as real GT3 cars are (~1.3x)', () => {
    for (const id of ['silverstone', 'monaco']) {
      const f1 = botLap(id, 'f1')!;
      const gt = botLap(id, 'gt3')!;
      expect(gt).not.toBeNull();
      expect(gt / f1).toBeGreaterThan(1.2);
      expect(gt / f1).toBeLessThan(1.45);
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
});
