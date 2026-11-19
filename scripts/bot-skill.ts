/**
 * How each bot level drives each car class: time trial laps per class x difficulty on a set of
 * tracks. Prints the clean lap time (median of the clean ones), how many laps were thrown away
 * (all four wheels off) and how often the car was wrecked.
 *
 *   npx tsx scripts/bot-skill.ts [--laps 3] [--class gt3] [trackId ...]
 */
import { BotDriver, DIFFICULTIES, type Difficulty } from '../src/sim/ai/botDriver';
import { CAR_CLASS_ORDER, CAR_CLASSES, type CarClassId } from '../src/sim/carClass';
import { TimeTrial } from '../src/sim/timeTrial';
import { Track } from '../src/track/track';
import { TRACKS } from '../src/tracks';

const DT = 1 / 120;

export interface SkillRun {
  clean: number[];
  dirty: number;
  wrecks: number;
}

/** `laps` laps (or as many as fit in the time) by one bot in time trial. */
export function skillRun(id: string, cls: CarClassId, level: Difficulty, laps = 3): SkillRun {
  const track = new Track(TRACKS[id]);
  const tt = new TimeTrial(track, id, 'Bot', 'red', cls);
  let bot = new BotDriver(track, 'me', level, CAR_CLASSES[cls].params);
  const out: SkillRun = { clean: [], dirty: 0, wrecks: 0 };
  tt.onLap = (l) => out.clean.push(l.time);
  let lapsDone = 0;
  let wasRetired = false;
  for (let t = 0; t < laps * 250 && lapsDone < laps; t += DT) {
    const events = tt.step(DT, bot.drive(tt.world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT));
    for (const e of events) if (e.kind === 'lap' && e.racerId === 'me') lapsDone++;
    const retired = tt.me.car.retired;
    if (retired && !wasRetired) {
      out.wrecks++;
      // As a player would: restart the lap.
      tt.restart();
      bot = new BotDriver(track, 'me', level, CAR_CLASSES[cls].params);
      lapsDone++;
    }
    wasRetired = tt.me.car.retired;
  }
  out.dirty = lapsDone - out.clean.length - out.wrecks;
  return out;
}

const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : NaN);

if (process.argv[1]?.includes('bot-skill')) {
  const args = process.argv.slice(2);
  const take = (flag: string) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const laps = Number(take('--laps') ?? 3);
  const only = take('--class') as CarClassId | undefined;
  const ids = args.length ? args : ['silverstone', 'monaco', 'spa', 'suzuka', 'hungaroring', 'baku', 'interlagos', 'zandvoort'];
  for (const cls of only ? [only] : CAR_CLASS_ORDER) {
    for (const id of ids) {
      const row = DIFFICULTIES.map((level) => {
        const r = skillRun(id, cls, level, laps);
        return `${level} ${median(r.clean).toFixed(2).padStart(6)} ${r.clean.length}/${laps}${r.dirty ? ` off${r.dirty}` : ''}${r.wrecks ? ` WRECK${r.wrecks}` : ''}`.padEnd(30);
      });
      console.log(`${cls.padEnd(6)} ${id.padEnd(13)} ${row.join(' ')}`);
    }
  }
}
