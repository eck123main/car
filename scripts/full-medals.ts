/**
 * Medal times for full length time trial (src/tracks/medals-full.json), for tracks that don't
 * have them yet.
 *
 *   npx tsx scripts/full-medals.ts <class> [--all] [trackId ...]
 *
 * A track's full length author time is its normal author time for that class (medals.json, or
 * medals-<class>.json) scaled by how much longer the Hard bot's lap takes at full length. Like the
 * others, they should stay put once players chase them. Several classes can run side by side:
 * each run rereads the file before writing its own class.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { CAR_CLASS_ORDER, boardKey, isCarClassId, type CarClassId } from '../src/sim/carClass';
import { medalTimes, medalTimesFrom, type MedalTimes } from '../src/sim/medals';
import { fullLengthDef, hasFullLength } from '../src/track/fullLength';
import { REAL_TRACK_IDS, TRACKS } from '../src/tracks';
import { botLap } from './class-laps';

const OUT = 'src/tracks/medals-full.json';
const [cls, ...rest] = process.argv.slice(2);
if (!isCarClassId(cls)) throw new Error('Usage: full-medals.ts <class> [--all] [trackId ...]');
const all = rest.includes('--all');
const named = rest.filter((a) => !a.startsWith('--'));

type Tables = Partial<Record<CarClassId, Record<string, MedalTimes>>>;
const read = (): Tables => JSON.parse(readFileSync(OUT, 'utf8')) as Tables;
const todo = REAL_TRACK_IDS.filter((id) => hasFullLength(TRACKS[id]) && medalTimes(boardKey(id, cls)) && (named.length ? named.includes(id) : all || !read()[cls]?.[id]));
for (const id of todo) {
  const a = botLap(id, cls).time;
  const b = botLap(id, cls, fullLengthDef(TRACKS[id])).time;
  if (a === null || b === null) {
    console.log(`${id.padEnd(16)} no clean bot lap (normal ${a}, full ${b}): skipped`);
    continue;
  }
  const times = medalTimesFrom(medalTimes(boardKey(id, cls))!.author * (b / a));
  console.log(`${id.padEnd(16)} ${a.toFixed(2)} -> ${b.toFixed(2)} x${(b / a).toFixed(3)} -> author ${times.author}`);
  // Reread and written as it goes (in track order), so runs per class can share the file and be resumed.
  const tables = read();
  const mine = { ...tables[cls], [id]: times };
  tables[cls] = Object.fromEntries(REAL_TRACK_IDS.filter((t) => mine[t]).map((t) => [t, mine[t]]));
  const body = CAR_CLASS_ORDER.map((c) => {
    const rows = Object.entries(tables[c] ?? {}).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `  ${JSON.stringify(c)}: {${rows.length ? `\n${rows.join(',\n')}\n  ` : ''}}`;
  });
  writeFileSync(OUT, `{\n${body.join(',\n')}\n}\n`);
}
