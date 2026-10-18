/**
 * Work out time trial medal times (src/tracks/medals.json) for tracks that don't have them yet.
 *
 *   npx tsx scripts/medal-times.ts [--all] [trackId ...]
 *
 * Medal times are meant to stay put once players chase them, so existing tracks are left alone
 * unless --all (or their id) is given.
 *
 * How the author time is set (analysis of the leaderboard, Oct 2026): the best players' laps are
 * far quicker than the Hard bot's (they carry 2-3x its speed through many corners), at 0.70-0.92
 * of its time, median 0.82. So:
 *  - estimate E = 0.80 x the Hard bot's time trial lap (a little better than the median best lap);
 *  - with a world record R (read from the database when .env.local has its URL and key), author
 *    is E kept between 0.97 R and 0.985 R: always faster than anyone has gone, by 1.5-3%;
 *  - without one (a new track), author is E.
 * Gold / silver / bronze follow from author (MEDAL_FACTORS in src/sim/medals.ts).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BotDriver } from '../src/sim/ai/botDriver';
import { medalTimesFrom, type MedalTimes } from '../src/sim/medals';
import { TimeTrial } from '../src/sim/timeTrial';
import { Track } from '../src/track/track';
import { REAL_TRACK_IDS, TRACKS } from '../src/tracks';

const OUT = 'src/tracks/medals.json';
const BOT_TO_TOP = 0.8;
const RECORD_MIN = 0.97;
const RECORD_MAX = 0.985;
const DT = 1 / 120;

/** The Hard bot's first flying lap in time trial (rolling start, softs, DRS everywhere, ERS). */
function botLap(id: string): number {
  const track = new Track(TRACKS[id]);
  const tt = new TimeTrial(track, id, 'Bot', 'red');
  const bot = new BotDriver(track, 'me', 'hard');
  let lap: number | null = null;
  tt.onLap = (l) => (lap = l.time);
  for (let t = 0; t < 300 && lap === null; t += DT) {
    tt.step(DT, bot.drive(tt.world, { phase: 'practice', raceStart: 0, laps: null, mandatoryStop: false }, DT));
  }
  if (lap === null) throw new Error(`${id}: the bot didn't set a valid lap`);
  return lap;
}

/** World records by track, if the database is configured. */
async function records(): Promise<Record<string, number>> {
  if (!existsSync('.env.local')) return {};
  const env = Object.fromEntries(
    readFileSync('.env.local', 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  const url = env.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const key = env.VITE_SUPABASE_KEY;
  if (!url || !key) return {};
  const res = await fetch(`${url}/rest/v1/time_trial_best?select=track,time&order=time.asc`, { headers: { apikey: key } });
  if (!res.ok) throw new Error(`Leaderboard: ${res.status}`);
  const out: Record<string, number> = {};
  for (const r of (await res.json()) as { track: string; time: number }[]) out[r.track] = Math.min(out[r.track] ?? Infinity, r.time);
  return out;
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const named = args.filter((a) => !a.startsWith('--'));
const table: Record<string, MedalTimes> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const todo = REAL_TRACK_IDS.filter((id) => (named.length ? named.includes(id) : all || !table[id]));
const wr = await records();
for (const id of todo) {
  const bot = botLap(id);
  const estimate = BOT_TO_TOP * bot;
  const r = wr[id];
  const author = r === undefined ? estimate : Math.min(RECORD_MAX * r, Math.max(RECORD_MIN * r, estimate));
  table[id] = medalTimesFrom(author);
  const m = table[id];
  console.log(
    `${id.padEnd(14)} bot ${bot.toFixed(2)}  record ${r?.toFixed(2) ?? '  -  '}  -> author ${m.author}  gold ${m.gold}  silver ${m.silver}  bronze ${m.bronze}`,
  );
}
// Calendar order, like src/tracks/index.ts.
const sorted = Object.fromEntries(REAL_TRACK_IDS.filter((id) => table[id]).map((id) => [id, table[id]]));
writeFileSync(OUT, `{\n${Object.entries(sorted).map(([id, m]) => `  ${JSON.stringify(id)}: ${JSON.stringify(m)}`).join(',\n')}\n}\n`);
console.log(`wrote ${OUT} (${Object.keys(sorted).length} tracks)`);
