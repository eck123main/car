/**
 * The ground fix (smoother hills, evened-out heights) moved lap times on a few tracks: rescale
 * the medal times by src/tracks/ground-ratios.json and write supabase/ground_adjust.sql, which
 * does the same to the global board (on top of elevation_adjust.sql). Run once:
 *
 *   npx tsx scripts/ground-adjust.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { medalTimesFrom, type MedalTimes } from '../src/sim/medals';
import ratios from '../src/tracks/ground-ratios.json';

const MEDALS = 'src/tracks/medals.json';
const NAME = 'ground-2026-10';
const table = JSON.parse(readFileSync(MEDALS, 'utf8')) as Record<string, MedalTimes>;
for (const [id, r] of Object.entries(ratios)) if (table[id]) table[id] = medalTimesFrom(Math.round(table[id].author * r * 100) / 100);
writeFileSync(MEDALS, `{\n${Object.entries(table).map(([id, m]) => `  ${JSON.stringify(id)}: ${JSON.stringify(m)}`).join(',\n')}\n}\n`);
console.log(`rescaled ${MEDALS}`);

writeFileSync(
  'supabase/ground_adjust.sql',
  `-- 3D ground fix: smoother hills and evened-out heights moved lap times on a few tracks
-- (src/tracks/ground-ratios.json). Run once in the Supabase SQL editor after deploying it, and
-- after elevation_adjust.sql (these factors go on top). Safe to run twice: it records what it did.
do $$
begin
  if not exists (select 1 from public.adjustments where name = 'elevation-2026-10') then
    raise exception 'run elevation_adjust.sql first';
  end if;
  if exists (select 1 from public.adjustments where name = '${NAME}') then
    raise notice '${NAME} already applied';
    return;
  end if;
${Object.entries(ratios)
  .map(
    ([id, r]) => `  -- ${id}: x ${r}.
  update public.time_trial set
    time = round((time * ${r})::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * ${r}, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * ${r})), '{time}', to_jsonb(round((ghost->>'time')::numeric * ${r}, 3))) else ghost end
  where track = '${id}';`,
  )
  .join('\n')}
  insert into public.adjustments (name) values ('${NAME}');
end $$;
`,
);
console.log('wrote supabase/ground_adjust.sql');
