/**
 * How much lap time each way of using ERS is worth: the ideal-line robot drives several laps in a
 * row (battery carried over, as in a race; fresh softs each lap), with no ERS, the robot's own
 * "on every straight", the bots' rule, and Auto ERS (`src/sim/autoErs.ts`).
 *
 *   npx tsx scripts/ers-bench.ts [trackId ...]
 */
import { idealLine, LineDriver } from '../src/sim/ai/idealLine';
import { autoErs } from '../src/sim/autoErs';
import { restartIndex } from '../src/sim/timeTrial';
import { Tyres } from '../src/sim/tyres';
import { RaceWorld, type PlayerInput, type Racer } from '../src/sim/world';
import { Track } from '../src/track/track';
import { TRACKS } from '../src/tracks';

const DT = 1 / 120;
const LAPS = 5;

type Rule = (track: Track, r: Racer, input: PlayerInput) => boolean;
const RULES: Record<string, Rule> = {
  none: () => false,
  straights: (_t, _r, input) => input.ers,
  bots: (t, r, input) => {
    const ideal = idealLine(t);
    const q = t.query(r.car.x, r.car.y, r.car.trackIndex);
    const straight = q !== null && Math.abs(ideal.line.curvature[q.index]) < 1 / 300 && r.car.speed > 35;
    return straight && input.throttle === 1 && r.ers > 0.85;
  },
  auto: (t, r, input) => autoErs(t, idealLine(t), r, input),
};

/** Average of laps 2..LAPS (s), or null if a lap went wrong. */
function run(track: Track, rule: Rule): number | null {
  const world = new RaceWorld(track, { drsRule: 'free', wetness: 0, slipstream: false, collisions: false });
  const me = world.addRacer('me', 'Bench', 'red', 'soft');
  const s = track.samples[restartIndex(track)];
  me.car.place(s.x, s.y, Math.atan2(s.ty, s.tx), restartIndex(track));
  me.car.vx = s.tx * 40;
  me.car.vy = s.ty * 40;
  me.pit.phase = 'out';
  const driver = new LineDriver(track, idealLine(track), 'me');
  const laps: number[] = [];
  for (let t = 0; t < 400 && laps.length < LAPS; t += DT) {
    const input = driver.drive(world);
    input.ers = rule(track, me, input);
    for (const e of world.step(DT, new Map([['me', input]]))) {
      if (e.kind === 'lap' && e.racerId === 'me') {
        laps.push(e.lap.time);
        me.tyres = new Tyres('soft');
      }
    }
  }
  if (laps.length < LAPS) return null;
  const flying = laps.slice(1);
  return flying.reduce((a, b) => a + b, 0) / flying.length;
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['silverstone', 'monza', 'monaco', 'spa', 'hungaroring', 'baku', 'suzuka'];
const sums: Record<string, number> = {};
for (const id of ids) {
  if (!TRACKS[id]) continue;
  const track = new Track(TRACKS[id]);
  const res = Object.fromEntries(Object.entries(RULES).map(([k, rule]) => [k, run(track, rule)]));
  const base = res.none;
  console.log(id.padEnd(14), Object.entries(res).map(([k, v]) => `${k} ${v?.toFixed(3) ?? '-'}${base && v ? ` (${(v - base).toFixed(2)})` : ''}`).join('  '));
  for (const [k, v] of Object.entries(res)) if (base && v) sums[k] = (sums[k] ?? 0) + v - base;
}
console.log('total vs none', sums);
