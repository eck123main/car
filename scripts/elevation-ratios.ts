/**
 * How much the hills change lap times, per track: the Hard bot's time trial lap with elevation
 * divided by its lap on the same track flat (as before elevation existed: no terrain heights
 * and no Suzuka bridge in the physics).
 *
 *   npx tsx scripts/elevation-ratios.ts [--write] [trackId ...]
 *
 * --write saves the ratios to src/tracks/elevation-ratios.json, which rescales the medal times
 * (--medals also rewrites src/tracks/medals.json) and generates the SQL that rescales the
 * leaderboard (supabase/elevation_adjust.sql). Ratios within NO_CHANGE of 1 count as 1: those
 * tracks keep their times.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BotDriver } from '../src/sim/ai/botDriver';
import { medalTimesFrom, type MedalTimes } from '../src/sim/medals';
import { TimeTrial } from '../src/sim/timeTrial';
import { Track } from '../src/track/track';
import type { TrackDef } from '../src/track/types';
import { REAL_TRACK_IDS, TRACKS } from '../src/tracks';

const DT = 1 / 120;
/** Changes smaller than this (share of the lap) are left alone. */
const NO_CHANGE = 0.002;
const RATIOS = 'src/tracks/elevation-ratios.json';
const MEDALS = 'src/tracks/medals.json';
const SQL = 'supabase/elevation_adjust.sql';

function botLap(id: string, def: TrackDef): number {
  const track = new Track(def);
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

/** The track as it was before elevation: flat, and the crossover only drawn. */
function flat(def: TrackDef): TrackDef {
  const landmarks = def.scenery?.landmarks?.filter((l) => l.type !== 'crossover');
  return { ...def, elevation: undefined, scenery: def.scenery && { ...def.scenery, landmarks } };
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const medals = args.includes('--medals');
const named = args.filter((a) => !a.startsWith('--'));
const ratios: Record<string, number> = {};
for (const id of named.length ? named : REAL_TRACK_IDS) {
  const before = botLap(id, flat(TRACKS[id]));
  const after = botLap(id, TRACKS[id]);
  const r = after / before;
  ratios[id] = Math.abs(r - 1) < NO_CHANGE ? 1 : Math.round(r * 10000) / 10000;
  console.log(`${id.padEnd(14)} flat ${before.toFixed(2)}  hills ${after.toFixed(2)}  ${((r - 1) * 100).toFixed(2)}%${ratios[id] === 1 ? '  (unchanged)' : ''}`);
}

if (write) {
  writeFileSync(RATIOS, `{\n${Object.entries(ratios).map(([id, r]) => `  ${JSON.stringify(id)}: ${r}`).join(',\n')}\n}\n`);
  console.log(`wrote ${RATIOS}`);
  const changed = Object.entries(ratios).filter(([, r]) => r !== 1);
  writeFileSync(
    SQL,
    `-- Elevation: rescale saved time trial laps by how much the hills changed each track's lap
-- times (scripts/elevation-ratios.ts, Hard bot laps flat vs hilly). Run once, in the Supabase
-- SQL editor, after deploying the elevation update. Safe to run twice: it records what it did.
create table if not exists public.adjustments (name text primary key, applied_at timestamptz not null default now());
alter table public.adjustments enable row level security;

do $$
begin
  if exists (select 1 from public.adjustments where name = 'elevation-2026-10') then
    raise notice 'elevation-2026-10 already applied';
    return;
  end if;
${changed
  .map(
    ([id, r]) => `  -- ${id}: x ${r}. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * ${r})::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * ${r}, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * ${r})), '{time}', to_jsonb(round((ghost->>'time')::numeric * ${r}, 3))) else ghost end
  where track = '${id}';`,
  )
  .join('\n')}
  insert into public.adjustments (name) values ('elevation-2026-10');
end $$;
`,
  );
  console.log(`wrote ${SQL} (${changed.length} tracks change)`);
  if (medals) {
    const table = JSON.parse(readFileSync(MEDALS, 'utf8')) as Record<string, MedalTimes>;
    for (const [id, r] of changed) if (table[id]) table[id] = medalTimesFrom(Math.round(table[id].author * r * 100) / 100);
    writeFileSync(MEDALS, `{\n${Object.entries(table).map(([id, m]) => `  ${JSON.stringify(id)}: ${JSON.stringify(m)}`).join(',\n')}\n}\n`);
    console.log(`rescaled ${MEDALS}`);
  }
}
