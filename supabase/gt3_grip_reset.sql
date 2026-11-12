-- GT3 grip +20% (Nov 2026): every GT3 lap set before it was on a much slower car, so they are
-- cleared (laps and ghosts; F1 laps are untouched). Run once in the Supabase SQL editor after
-- deploying the change. Safe to run twice: it records what it did. Medals are worked out from the
-- board, so GT3 medals earned on the old car go too, to be won again on the new one.
create table if not exists public.adjustments (name text primary key, applied_at timestamptz not null default now());
alter table public.adjustments enable row level security;

do $$
begin
  if exists (select 1 from public.adjustments where name = 'gt3-grip-2026-11') then
    raise notice 'gt3-grip-2026-11 already applied';
    return;
  end if;
  delete from public.time_trial where track like '%@gt3';
  insert into public.adjustments (name) values ('gt3-grip-2026-11');
end $$;
