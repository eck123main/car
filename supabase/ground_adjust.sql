-- 3D ground fix: smoother hills and evened-out heights moved lap times on a few tracks
-- (src/tracks/ground-ratios.json). Run once in the Supabase SQL editor after deploying it, and
-- after elevation_adjust.sql (these factors go on top). Safe to run twice: it records what it did.
do $$
begin
  if not exists (select 1 from public.adjustments where name = 'elevation-2026-10') then
    raise exception 'run elevation_adjust.sql first';
  end if;
  if exists (select 1 from public.adjustments where name = 'ground-2026-10') then
    raise notice 'ground-2026-10 already applied';
    return;
  end if;
  -- monaco: x 0.9873.
  update public.time_trial set
    time = round((time * 0.9873)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9873, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9873)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9873, 3))) else ghost end
  where track = 'monaco';
  -- baku: x 0.9932.
  update public.time_trial set
    time = round((time * 0.9932)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9932, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9932)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9932, 3))) else ghost end
  where track = 'baku';
  -- magny-cours: x 0.9954.
  update public.time_trial set
    time = round((time * 0.9954)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 0.9954, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 0.9954)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 0.9954, 3))) else ghost end
  where track = 'magny-cours';
  -- spa: x 1.004.
  update public.time_trial set
    time = round((time * 1.004)::numeric, 3),
    sectors = coalesce((select jsonb_agg(round((v::numeric) * 1.004, 3) order by i) from jsonb_array_elements_text(sectors) with ordinality as e(v, i)), sectors),
    ghost = case when ghost ? 'dt' and ghost ? 'time' then jsonb_set(jsonb_set(ghost, '{dt}', to_jsonb((ghost->>'dt')::numeric * 1.004)), '{time}', to_jsonb(round((ghost->>'time')::numeric * 1.004, 3))) else ghost end
  where track = 'spa';
  insert into public.adjustments (name) values ('ground-2026-10');
end $$;
