/**
 * Medal times for another car class (src/tracks/medals-<class>.json), for tracks that don't
 * have them yet.
 *
 *   npx tsx scripts/class-medals.ts <class> [--all] [trackId ...]
 *
 * The F1 author times (src/tracks/medals.json) were set against the best players' laps, so a
 * class's author time is the F1 one scaled by how much slower the Hard bot is in that car on
 * that track. Like the F1 ones, they should stay put once players chase them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import F1_MEDALS from '../src/tracks/medals.json';
import { isCarClassId } from '../src/sim/carClass';
import { medalTimesFrom, type MedalTimes } from '../src/sim/medals';
import { REAL_TRACK_IDS } from '../src/tracks';
import { botLap } from './class-laps';

const [cls, ...rest] = process.argv.slice(2);
if (!isCarClassId(cls) || cls === 'f1') throw new Error('Usage: class-medals.ts <class> [--all] [trackId ...]');
const OUT = `src/tracks/medals-${cls}.json`;
const all = rest.includes('--all');
const named = rest.filter((a) => !a.startsWith('--'));
const f1 = F1_MEDALS as Record<string, MedalTimes>;
const table: Record<string, MedalTimes> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const todo = REAL_TRACK_IDS.filter((id) => f1[id] && (named.length ? named.includes(id) : all || !table[id]));
for (const id of todo) {
  const a = botLap(id, 'f1').time;
  const b = botLap(id, cls).time;
  if (a === null || b === null) {
    console.log(`${id.padEnd(16)} no clean bot lap (F1 ${a}, ${cls} ${b}): skipped`);
    continue;
  }
  table[id] = medalTimesFrom(f1[id].author * (b / a));
  console.log(`${id.padEnd(16)} x${(b / a).toFixed(3)} -> author ${table[id].author}`);
  // Written as it goes, in the F1 table's order, so a long run can be stopped and resumed.
  const ordered = Object.fromEntries(REAL_TRACK_IDS.filter((t) => table[t]).map((t) => [t, table[t]]));
  writeFileSync(OUT, `{\n${Object.entries(ordered).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`);
}
