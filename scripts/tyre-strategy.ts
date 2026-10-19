/**
 * How tyre strategies compare: a Hard bot drives stints on each compound, then every 0, 1 and
 * 2 stop strategy is priced (stint laps + pit loss) for a few race lengths.
 *
 *   npx tsx scripts/tyre-strategy.ts [trackId ...]
 *
 * Used to balance tyre grip, wear and life (src/sim/tyres.ts): the best few strategies at
 * each race length should be close, rather than one compound always winning.
 */
import { BotDriver, type BotContext } from '../src/sim/ai/botDriver';
import { DRY_COMPOUNDS, Tyres, tyreLife, type Compound } from '../src/sim/tyres';
import { RaceWorld } from '../src/sim/world';
import { Track } from '../src/track/track';
import { TRACKS } from '../src/tracks';

const DT = 1 / 120;
const LENGTHS = [5, 8, 12];

/** Lap times of a stint of `laps` flying laps on fresh tyres, in a race of `raceLaps`. */
function stint(track: Track, compound: Compound, raceLaps: number, laps: number): number[] {
  const world = new RaceWorld(track, { drsRule: 'free', wetness: 0, raceLaps, tyreWear: true });
  const r = world.addRacer('a', 'A', 'red');
  const bot = new BotDriver(track, 'a', 'hard');
  const ctx: BotContext = { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false };
  const times: number[] = [];
  let started = false;
  for (let t = 0; t < 120 * (laps + 2) && times.length < laps; t += DT) {
    for (const e of world.step(DT, new Map([['a', bot.drive(world, ctx, DT)]]))) {
      if (e.kind !== 'lap') continue;
      // The first crossing ends the standing-start lap: fit fresh tyres there.
      if (started) times.push(e.lap.time);
      else r.tyres = new Tyres(compound);
      started = true;
    }
  }
  return times;
}

/** Time lost by a stop: a short race with the stop against one without. */
function pitLoss(track: Track): number {
  const race = (stop: boolean) => {
    const world = new RaceWorld(track, { drsRule: 'free', wetness: 0, raceLaps: 3, tyreWear: false });
    world.addRacer('a', 'A', 'red');
    const bot = new BotDriver(track, 'a', 'hard');
    const ctx: BotContext = { phase: 'race', raceStart: 0, laps: 3, mandatoryStop: stop, tyreWear: false };
    let laps = 0;
    for (let t = 0; t < 400 && laps < 3; t += DT) for (const e of world.step(DT, new Map([['a', bot.drive(world, ctx, DT)]]))) if (e.kind === 'lap') laps++;
    return world.time;
  };
  return race(true) - race(false);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['silverstone', 'bahrain', 'monaco'];
for (const id of ids) {
  const track = new Track(TRACKS[id]);
  const loss = pitLoss(track);
  console.log(`\n${id}: pit stop costs ${loss.toFixed(1)} s`);
  for (const L of LENGTHS) {
    // Lap times by compound for a whole race's worth of laps (stints never run longer).
    const lap = Object.fromEntries(DRY_COMPOUNDS.map((c) => [c, stint(track, c, L, L)])) as Record<Compound, number[]>;
    const run = (c: Compound, n: number) => lap[c].slice(0, n).reduce((a, b) => a + b, 0);
    const results: { name: string; time: number; two: boolean }[] = [];
    for (const a of DRY_COMPOUNDS) {
      results.push({ name: `${a[0].toUpperCase()} no stop`, time: run(a, L), two: false });
      for (const b of DRY_COMPOUNDS)
        for (let k = 1; k < L; k++) {
          results.push({ name: `${a[0].toUpperCase()}${k}-${b[0].toUpperCase()}`, time: run(a, k) + run(b, L - k) + loss, two: a !== b });
          for (const c of DRY_COMPOUNDS)
            for (let m = k + 1; m < L; m++)
              results.push({ name: `${a[0].toUpperCase()}${k}-${b[0].toUpperCase()}${m - k}-${c[0].toUpperCase()}`, time: run(a, k) + run(b, m - k) + run(c, L - m) + 2 * loss, two: new Set([a, b, c]).size > 1 });
        }
    }
    const best = (list: typeof results) => {
      const byPlan = new Map<string, (typeof results)[0]>();
      for (const r of list.sort((x, y) => x.time - y.time)) {
        const plan = r.name.replace(/\d+/g, '');
        if (!byPlan.has(plan)) byPlan.set(plan, r);
      }
      const top = [...byPlan.values()].slice(0, 5);
      return top.map((r) => `${r.name} +${(r.time - top[0].time).toFixed(1)}`).join('  ');
    };
    const lives = DRY_COMPOUNDS.map((c) => `${c[0].toUpperCase()}${tyreLife(c, L).toFixed(1)}`).join(' ');
    const fresh = DRY_COMPOUNDS.map((c) => `${c[0].toUpperCase()} ${lap[c][0].toFixed(2)}→${lap[c][L - 1].toFixed(2)}`).join('  ');
    console.log(`  ${L} laps (life ${lives}; laps ${fresh})`);
    console.log(`    free:      ${best(results)}`);
    console.log(`    mandatory: ${best(results.filter((r) => r.two))}`);
  }
}
