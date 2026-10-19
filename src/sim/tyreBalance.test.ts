import { describe, expect, it } from 'vitest';
import { Track } from '../track/track';
import { TRACKS } from '../tracks';
import { BotDriver } from './ai/botDriver';
import { DRY_COMPOUNDS, Tyres, type Compound } from './tyres';
import { RaceWorld } from './world';

const DT = 1 / 120;
const LAPS = 8;
/** Time a stop costs at Silverstone (measured with scripts/tyre-strategy.ts). */
const PIT_LOSS = 20.7;

/** A Hard bot's flying laps on fresh tyres, in an 8-lap race. */
function stint(track: Track, compound: Compound): number[] {
  const world = new RaceWorld(track, { drsRule: 'free', wetness: 0, raceLaps: LAPS, tyreWear: true });
  const r = world.addRacer('a', 'A', 'red');
  const bot = new BotDriver(track, 'a', 'hard');
  const times: number[] = [];
  let started = false;
  for (let t = 0; t < 120 * (LAPS + 2) && times.length < LAPS; t += DT) {
    for (const e of world.step(DT, new Map([['a', bot.drive(world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT)]]))) {
      if (e.kind !== 'lap') continue;
      if (started) times.push(e.lap.time);
      else r.tyres = new Tyres(compound);
      started = true;
    }
  }
  return times;
}

// Full balancing across tracks and race lengths: scripts/tyre-strategy.ts.
describe('Tyre strategy balance (8 laps, Silverstone)', () => {
  const track = new Track(TRACKS.silverstone);
  const laps = Object.fromEntries(DRY_COMPOUNDS.map((c) => [c, stint(track, c)])) as Record<Compound, number[]>;
  const run = (c: Compound, n: number) => laps[c].slice(0, n).reduce((a, b) => a + b, 0);
  /** Best one-stop race from compound a to b. */
  const oneStop = (a: Compound, b: Compound) => Math.min(...Array.from({ length: LAPS - 1 }, (_, k) => run(a, k + 1) + run(b, LAPS - k - 1))) + PIT_LOSS;

  it('softs are quicker fresh, but fall off over a stint', () => {
    expect(laps.soft[0]).toBeLessThan(laps.medium[0]);
    expect(laps.medium[0]).toBeLessThan(laps.hard[0]);
    expect(laps.soft[LAPS - 1]).toBeGreaterThan(laps.hard[LAPS - 1]);
  });

  it('with the two-compound rule, every pairing is within a few seconds', () => {
    const times = DRY_COMPOUNDS.flatMap((a) => DRY_COMPOUNDS.filter((b) => b !== a).map((b) => oneStop(a, b)));
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(4);
  });

  it('without it, softs all the way is not the answer', () => {
    expect(run('soft', LAPS)).toBeGreaterThan(Math.min(run('medium', LAPS), run('hard', LAPS)) + 5);
    expect(Math.abs(run('medium', LAPS) - run('hard', LAPS))).toBeLessThan(2);
  });
});
