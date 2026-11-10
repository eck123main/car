/**
 * Hard bot time trial laps per car class, to compare classes (and to set medal times).
 *
 *   npx tsx scripts/class-laps.ts [trackId ...]
 */
import { BotDriver } from '../src/sim/ai/botDriver';
import { CAR_CLASSES, type CarClassId } from '../src/sim/carClass';
import { TimeTrial } from '../src/sim/timeTrial';
import { Track } from '../src/track/track';
import { REAL_TRACK_IDS, TRACKS } from '../src/tracks';

const DT = 1 / 120;

/** The Hard bot's first valid flying lap in time trial, and its top speed (km/h). */
export function botLap(id: string, cls: CarClassId): { time: number | null; top: number } {
  const track = new Track(TRACKS[id]);
  const tt = new TimeTrial(track, id, 'Bot', 'red', cls);
  const bot = new BotDriver(track, 'me', 'hard', CAR_CLASSES[cls].params);
  let lap: number | null = null;
  let top = 0;
  tt.onLap = (l) => (lap = l.time);
  for (let t = 0; t < 300 && lap === null; t += DT) {
    tt.step(DT, bot.drive(tt.world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT));
    top = Math.max(top, tt.me.car.speed * 3.6);
  }
  return { time: lap, top };
}

if (process.argv[1]?.includes('class-laps')) {
  const named = process.argv.slice(2);
  for (const id of named.length ? named : REAL_TRACK_IDS) {
    const f1 = botLap(id, 'f1');
    const gt = botLap(id, 'gt3');
    const ratio = f1.time && gt.time ? (gt.time / f1.time).toFixed(3) : '-';
    console.log(`${id.padEnd(16)} F1 ${f1.time?.toFixed(2) ?? 'none'} (${f1.top.toFixed(0)})  GT3 ${gt.time?.toFixed(2) ?? 'none'} (${gt.top.toFixed(0)})  x${ratio}`);
  }
}
