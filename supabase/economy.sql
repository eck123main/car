-- Coins and car skins (the garage). Run this AFTER accounts.sql, in the same project:
-- SQL Editor -> paste this file -> Run. It is safe to run again (prices are updated).
--
-- Only signed-in players have a wallet. Like the accounts tables, nothing here can be read or
-- written with the public key: the functions below check the session token and do the sums,
-- so coins can't be edited from the browser. Days are UTC days.
--
-- Shop prices and spin prizes must match src/cosmetics/skins.ts and src/net/wallet.ts
-- (a test checks). Medal skins are unlocked by medals, which the game works out from the
-- leaderboard, so they aren't kept here; equipping one is allowed for any account.

create table if not exists public.wallets (
  account uuid primary key references public.accounts (id) on delete cascade,
  coins int not null default 0 check (coins >= 0),
  -- Days in a row the daily reward was claimed (the reward climbs over a 7-day week).
  streak int not null default 0,
  last_daily date,
  last_spin date,
  -- Won on the wheel: more spins today, and the next daily reward doubled.
  extra_spins int not null default 0,
  double_daily boolean not null default false,
  owned text[] not null default '{}',
  equipped text not null default 'team'
);

create table if not exists public.skin_shop (
  id text primary key,
  price int not null check (price > 0)
);

insert into public.skin_shop (id, price) values
  ('midnight', 300), ('arctic', 300), ('lime', 300), ('heritage', 300),
  ('sunset', 750), ('retro', 750), ('neon', 750), ('chequered', 750),
  ('chrome', 1500), ('carbon', 1500), ('inferno', 1500)
on conflict (id) do update set price = excluded.price;

alter table public.wallets enable row level security;
alter table public.skin_shop enable row level security;
revoke all on public.wallets, public.skin_shop from anon, authenticated;

-- Daily reward by day of the streak's week (day 7 is the weekly bonus).
create or replace function public.daily_reward(p_streak int) returns int
language sql immutable as $$
  select (array[50, 60, 70, 80, 100, 120, 300])[((greatest(p_streak, 1) - 1) % 7) + 1];
$$;

create or replace function public.utc_today() returns date
language sql stable as $$
  select (now() at time zone 'utc')::date;
$$;

-- The account's wallet, made on first use and locked for the rest of the transaction.
create or replace function public.wallet_of(p_token text) returns public.wallets
language plpgsql security definer set search_path = public, extensions as $$
declare
  acc accounts := account_from_token(p_token);
  w wallets;
begin
  if acc.id is null then
    raise exception 'signed_out';
  end if;
  insert into wallets (account) values (acc.id) on conflict (account) do nothing;
  select * into w from wallets where account = acc.id for update;
  return w;
end $$;

-- What the game shows: balance, what can be claimed today, skins.
create or replace function public.wallet_json(w public.wallets) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'coins', w.coins,
    'streak', case when w.last_daily >= utc_today() - 1 then w.streak else 0 end,
    'canClaim', w.last_daily is distinct from utc_today(),
    -- The reward a claim now would give (the streak carries on from yesterday, else restarts).
    'nextReward', daily_reward(case when w.last_daily = utc_today() - 1 then w.streak + 1
                                    when w.last_daily = utc_today() then w.streak + 1 else 1 end)
                  * case when w.double_daily then 2 else 1 end,
    'doubleDaily', w.double_daily,
    'canSpin', w.last_spin is distinct from utc_today() or w.extra_spins > 0,
    'extraSpins', case when w.last_spin = utc_today() then w.extra_spins else 0 end,
    'resetsIn', extract(epoch from ((utc_today() + 1)::timestamp - (now() at time zone 'utc')))::int,
    'owned', to_json(w.owned),
    'equipped', w.equipped
  );
$$;

create or replace function public.get_wallet(p_token text) returns json
language plpgsql security definer set search_path = public as $$
begin
  return wallet_json(wallet_of(p_token));
end $$;

create or replace function public.claim_daily(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  w wallets := wallet_of(p_token);
  today date := utc_today();
  reward int;
begin
  if w.last_daily = today then
    raise exception 'already_claimed';
  end if;
  w.streak := case when w.last_daily = today - 1 then w.streak + 1 else 1 end;
  reward := daily_reward(w.streak) * case when w.double_daily then 2 else 1 end;
  update wallets set coins = coins + reward, streak = w.streak, last_daily = today, double_daily = false
  where account = w.account returning * into w;
  return json_build_object('wallet', wallet_json(w), 'reward', reward);
end $$;

-- The daily wheel. Prizes (weights out of 100) match SPIN_PRIZES in src/net/wallet.ts.
create or replace function public.daily_spin(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  w wallets := wallet_of(p_token);
  today date := utc_today();
  prizes text[] := array['c25', 'c50', 'c100', 'c150', 'c250', 'c500', 'double', 'again', 'skin'];
  weights int[] := array[28, 25, 18, 10, 7, 2, 5, 3, 2];
  roll int := floor(random() * 100)::int;
  prize text;
  won_skin text;
  coins_won int := 0;
  i int;
begin
  if w.last_spin = today and w.extra_spins <= 0 then
    raise exception 'already_spun';
  end if;
  if w.last_spin = today then
    w.extra_spins := w.extra_spins - 1;
  else
    w.extra_spins := 0;
  end if;
  for i in 1 .. array_length(prizes, 1) loop
    if roll < weights[i] then
      prize := prizes[i];
      exit;
    end if;
    roll := roll - weights[i];
  end loop;
  if prize = 'skin' then
    -- A common or rare skin you don't have yet; 500 coins if you have them all.
    select id into won_skin from skin_shop where price <= 750 and not (id = any (w.owned)) order by random() limit 1;
    if won_skin is null then
      prize := 'c500';
    else
      w.owned := w.owned || won_skin;
    end if;
  end if;
  if prize like 'c%' then
    coins_won := substr(prize, 2)::int;
  elsif prize = 'double' then
    w.double_daily := true;
  elsif prize = 'again' then
    w.extra_spins := w.extra_spins + 1;
  end if;
  update wallets set coins = coins + coins_won, last_spin = today, extra_spins = w.extra_spins,
    double_daily = w.double_daily, owned = w.owned
  where account = w.account returning * into w;
  return json_build_object('wallet', wallet_json(w), 'prize', prize, 'skin', won_skin);
end $$;

create or replace function public.buy_skin(p_token text, p_skin text) returns json
language plpgsql security definer set search_path = public as $$
declare
  w wallets := wallet_of(p_token);
  cost int;
begin
  select price into cost from skin_shop where id = p_skin;
  if cost is null then
    raise exception 'unknown_skin';
  end if;
  if p_skin = any (w.owned) then
    raise exception 'already_owned';
  end if;
  if w.coins < cost then
    raise exception 'not_enough_coins';
  end if;
  update wallets set coins = coins - cost, owned = owned || p_skin, equipped = p_skin
  where account = w.account returning * into w;
  return wallet_json(w);
end $$;

-- Shop skins must be owned; the team livery and medal skins are free to pick.
create or replace function public.equip_skin(p_token text, p_skin text) returns json
language plpgsql security definer set search_path = public as $$
declare
  w wallets := wallet_of(p_token);
begin
  if p_skin is null or char_length(p_skin) > 32 then
    raise exception 'unknown_skin';
  end if;
  if exists (select 1 from skin_shop where id = p_skin) and not (p_skin = any (w.owned)) then
    raise exception 'not_owned';
  end if;
  if not exists (select 1 from skin_shop where id = p_skin) and p_skin <> 'team' and p_skin !~ '^medal-[a-z]+$' then
    raise exception 'unknown_skin';
  end if;
  update wallets set equipped = p_skin where account = w.account returning * into w;
  return wallet_json(w);
end $$;

revoke execute on function public.wallet_of(text) from public, anon, authenticated;
revoke execute on function public.wallet_json(public.wallets) from public, anon, authenticated;
grant execute on function public.get_wallet(text) to anon, authenticated;
grant execute on function public.claim_daily(text) to anon, authenticated;
grant execute on function public.daily_spin(text) to anon, authenticated;
grant execute on function public.buy_skin(text, text) to anon, authenticated;
grant execute on function public.equip_skin(text, text) to anon, authenticated;
