-- Elevation: rescale saved time trial laps by how much the hills changed each track's lap
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
  -- miami: x 0.9953. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 0.9953)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9953, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9953)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9953, 3))) else ghost end
  where track = 'miami';
  -- montreal: x 0.9963. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 0.9963)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9963, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9963)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9963, 3))) else ghost end
  where track = 'montreal';
  -- monaco: x 1.0068. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.0068)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.0068, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.0068)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.0068, 3))) else ghost end
  where track = 'monaco';
  -- barcelona: x 0.9958. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 0.9958)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9958, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9958)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9958, 3))) else ghost end
  where track = 'barcelona';
  -- zandvoort: x 1.0044. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.0044)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.0044, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.0044)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.0044, 3))) else ghost end
  where track = 'zandvoort';
  -- monza: x 0.9966. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 0.9966)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9966, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9966)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9966, 3))) else ghost end
  where track = 'monza';
  -- madrid: x 1.0027. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.0027)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.0027, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.0027)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.0027, 3))) else ghost end
  where track = 'madrid';
  -- baku: x 1.0134. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.0134)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.0134, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.0134)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.0134, 3))) else ghost end
  where track = 'baku';
  -- mexico: x 0.9978. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 0.9978)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9978, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9978)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9978, 3))) else ghost end
  where track = 'mexico';
  -- interlagos: x 1.0029. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.0029)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.0029, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.0029)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.0029, 3))) else ghost end
  where track = 'interlagos';
  -- lusail: x 0.9955. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 0.9955)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9955, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9955)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9955, 3))) else ghost end
  where track = 'lusail';
  -- imola: x 0.9902. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 0.9902)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9902, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9902)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9902, 3))) else ghost end
  where track = 'imola';
  -- portimao: x 1.0033. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.0033)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.0033, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.0033)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.0033, 3))) else ghost end
  where track = 'portimao';
  -- estoril: x 1.0029. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.0029)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.0029, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.0029)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.0029, 3))) else ghost end
  where track = 'estoril';
  -- indianapolis: x 1.003. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.003)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.003, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.003)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.003, 3))) else ghost end
  where track = 'indianapolis';
  -- magny-cours: x 1.0075. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.0075)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.0075, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.0075)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.0075, 3))) else ghost end
  where track = 'magny-cours';
  -- buenos-aires: x 0.9974. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 0.9974)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9974, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9974)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9974, 3))) else ghost end
  where track = 'buenos-aires';
  -- watkins-glen: x 1.007. Lap, sector times and the ghost's replay (its sample interval) all scale.
  update public.time_trial set
    time = round((time * 1.007)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.007, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.007)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.007, 3))) else ghost end
  where track = 'watkins-glen';
  insert into public.adjustments (name) values ('elevation-2026-10');
end $$;
