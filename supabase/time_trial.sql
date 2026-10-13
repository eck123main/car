-- Global time trial leaderboard (free Supabase project).
-- 1. Create a project at https://supabase.com (free tier).
-- 2. SQL Editor -> paste this file -> Run.
-- 3. Project Settings -> API: copy the Project URL and the anon / publishable key into
--    .env.local (for npm run dev) and into the GitHub repo variables SUPABASE_URL and
--    SUPABASE_KEY (Settings -> Secrets and variables -> Actions -> Variables) for the
--    deployed game:
--      VITE_SUPABASE_URL=https://xxxx.supabase.co
--      VITE_SUPABASE_KEY=sb_publishable_... (or the legacy anon key)

create table if not exists public.time_trial (
  id bigint generated always as identity primary key,
  track text not null,
  player text not null,
  name text not null,
  time double precision not null,
  sectors jsonb not null default '[]',
  ghost jsonb,
  created_at timestamptz not null default now()
);

create index if not exists time_trial_track_time on public.time_trial (track, time);

alter table public.time_trial enable row level security;

-- Anyone can read times and add laps; nobody can change or delete them.
drop policy if exists "read times" on public.time_trial;
create policy "read times" on public.time_trial for select using (true);

drop policy if exists "add laps" on public.time_trial;
create policy "add laps" on public.time_trial for insert with check (
  char_length(track) between 1 and 40
  and char_length(name) between 1 and 16
  and char_length(player) between 1 and 64
  and time between 10 and 600
  and (ghost is null or pg_column_size(ghost) < 300000)
);

-- Each player's best lap per track.
create or replace view public.time_trial_best with (security_invoker = true) as
  select distinct on (track, player) track, player, name, time, sectors, created_at
  from public.time_trial
  order by track, player, time asc;

grant select on public.time_trial_best to anon, authenticated;
grant select, insert on public.time_trial to anon, authenticated;
