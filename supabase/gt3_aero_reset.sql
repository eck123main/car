-- GT3 downforce doubled (Nov 2026, after gt3_grip_reset.sql): GT3 laps set before it were on a
-- slower car in fast corners, so they are cleared (laps and ghosts; F1 laps are untouched). Run
-- once in the Supabase SQL editor after deploying the change. Safe to run twice: it records what
-- it did. GT3 medals earned on the old car go too, to be won again.
create table if not exists public.adjustments (name text primary key, applied_at timestamptz not null default now());
alter table public.adjustments enable row level security;

do $$
begin
  if exists (select 1 from public.adjustments where name = 'gt3-aero-2026-11') then
    raise notice 'gt3-aero-2026-11 already applied';
    return;
  end if;
  delete from public.time_trial where track like '%@gt3';
  insert into public.adjustments (name) values ('gt3-aero-2026-11');
end $$;
