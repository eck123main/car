import { describe, expect, it } from 'vitest';
import { F1_CAR } from '../../physics/carParams';
import { Track } from '../../track/track';
import { TRACKS } from '../../tracks';
import { RaceWorld } from '../world';
import { BotDriver } from './botDriver';
import { racingLine, speedProfile, type RacingLine } from './racingLine';

const DT = 1 / 120;

/**
 * Proves that, as in real F1, the line matters: a car on the racing line (wide entry,
 * clip the apex, wide exit) laps faster than one in the middle of the road, which laps
 * faster than one that hugs the inside of every corner.
 */
function lapWith(track: Track, line: RacingLine): number {
  const world = new RaceWorld(track, { drsRule: 'free', wetness: 0 });
  const r = world.addRacer('b', 'B', 'red');
  const s0 = track.samples[track.samples.length - 10];
  r.car.place(s0.x, s0.y, Math.atan2(s0.ty, s0.tx));
  const bot = new BotDriver(track, 'b', 'hard');
  // Swap the bot's line (and its speed plan) for the one being tested.
  Object.assign(bot, { line, profile: speedProfile(track, line, F1_CAR, 0.95) });
  const laps: number[] = [];
  for (let t = 0; t < 300 && laps.length < 2; t += DT) {
    const input = bot.drive(world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT);
    for (const e of world.step(DT, new Map([['b', input]]))) if (e.kind === 'lap') laps.push(e.lap.time);
  }
  return laps[1];
}

/** A line through the middle of the track, or hugging the inside of each bend. */
function simpleLine(track: Track, inside: boolean): RacingLine {
  const ss = track.samples;
  const offset = ss.map((s) => (inside ? Math.sign(s.curvature) * (s.halfWidth - 2.2) * Math.min(1, Math.abs(s.curvature) * 150) : 0));
  // Curvature of that path, measured the same way as for the racing line.
  const n = ss.length;
  const px = ss.map((s, i) => s.x + s.nx * offset[i]);
  const py = ss.map((s, i) => s.y + s.ny * offset[i]);
  const curvature = ss.map((_, i) => {
    const a = (i - 3 + n) % n;
    const b = (i + 3) % n;
    const ax = px[i] - px[a];
    const ay = py[i] - py[a];
    const bx = px[b] - px[i];
    const by = py[b] - py[i];
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by) / Math.max(0.1, (Math.hypot(ax, ay) + Math.hypot(bx, by)) / 2);
  });
  return { offset, curvature };
}

describe.each(['silverstone', 'bahrain', 'monaco', 'spa'])('Lines on %s', (id) => {
  it('racing line beats the middle of the road, which beats hugging the inside', () => {
    const track = new Track(TRACKS[id]);
    const racing = lapWith(track, racingLine(track));
    const middle = lapWith(track, simpleLine(track, false));
    const inside = lapWith(track, simpleLine(track, true));
    expect(racing).toBeLessThan(middle);
    expect(middle).toBeLessThan(inside);
  }, 60_000);
});
