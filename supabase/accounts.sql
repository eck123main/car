-- Player accounts: a username and a password, no email (so nothing to confirm, and also no
-- way to reset a forgotten password). Run this AFTER time_trial.sql, in the same project:
-- SQL Editor -> paste this file -> Run. It is safe to run again.
--
-- The tables can't be read or written with the public key at all: everything goes through
-- the functions below, which check the password (bcrypt, via pgcrypto) and hand out a
-- random session token. Only a hash of each token is stored.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_username on public.accounts (lower(username));

create table if not exists public.account_sessions (
  token_hash text primary key,
  account uuid not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.account_sessions enable row level security;
revoke all on public.accounts, public.account_sessions from anon, authenticated;

-- Rules shared with the game (src/net/accounts.ts).
create or replace function public.account_check_new(p_username text, p_password text) returns void
language plpgsql immutable as $$
begin
  if p_username !~ '^[A-Za-z0-9_.-]{3,16}$' then
    raise exception 'bad_username';
  end if;
  if char_length(p_password) < 8 or char_length(p_password) > 72
     or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    raise exception 'weak_password';
  end if;
end $$;

create or replace function public.account_new_session(p_account uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  t text := encode(gen_random_bytes(32), 'hex');
begin
  insert into account_sessions (token_hash, account) values (encode(digest(t, 'sha256'), 'hex'), p_account);
  return t;
end $$;

-- The account a session token belongs to (null if the token is unknown or signed out).
create or replace function public.account_from_token(p_token text) returns public.accounts
language sql stable security definer set search_path = public, extensions as $$
  select a.* from account_sessions s join accounts a on a.id = s.account
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.sign_up(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  acc accounts;
begin
  perform account_check_new(p_username, p_password);
  if exists (select 1 from accounts where lower(username) = lower(p_username)) then
    raise exception 'username_taken';
  end if;
  insert into accounts (username, password_hash) values (p_username, crypt(p_password, gen_salt('bf', 10)))
  returning * into acc;
  return json_build_object('id', acc.id, 'username', acc.username, 'token', account_new_session(acc.id));
end $$;

create or replace function public.sign_in(p_username text, p_password text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  acc accounts;
begin
  select * into acc from accounts where lower(username) = lower(p_username);
  if acc.id is null then
    raise exception 'wrong_login';
  end if;
  if acc.locked_until is not null and acc.locked_until > now() then
    raise exception 'locked';
  end if;
  if acc.password_hash <> crypt(p_password, acc.password_hash) then
    -- Ten wrong passwords in a row: no more tries for five minutes.
    update accounts set
      failed_logins = case when failed_logins + 1 >= 10 then 0 else failed_logins + 1 end,
      locked_until = case when failed_logins + 1 >= 10 then now() + interval '5 minutes' else null end
    where id = acc.id;
    raise exception 'wrong_login';
  end if;
  update accounts set failed_logins = 0, locked_until = null where id = acc.id;
  return json_build_object('id', acc.id, 'username', acc.username, 'token', account_new_session(acc.id));
end $$;

create or replace function public.sign_out(p_token text) returns void
language sql security definer set search_path = public, extensions as $$
  delete from account_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- Who a token belongs to: {id, username}, or null.
create or replace function public.whoami(p_token text) returns json
language sql stable security definer set search_path = public, extensions as $$
  select case when a.id is null then null else json_build_object('id', a.id, 'username', a.username) end
  from account_from_token(p_token) a;
$$;

create or replace function public.change_password(p_token text, p_old text, p_new text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  acc accounts := account_from_token(p_token);
begin
  if acc.id is null then
    raise exception 'signed_out';
  end if;
  if acc.password_hash <> crypt(p_old, acc.password_hash) then
    raise exception 'wrong_password';
  end if;
  perform account_check_new(acc.username, p_new);
  update accounts set password_hash = crypt(p_new, gen_salt('bf', 10)) where id = acc.id;
end $$;

-- A time trial lap set while signed in: saved under the account's id and name.
create or replace function public.submit_lap(p_token text, p_track text, p_time double precision, p_sectors jsonb, p_ghost jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  acc accounts := account_from_token(p_token);
begin
  if acc.id is null then
    raise exception 'signed_out';
  end if;
  if char_length(p_track) not between 1 and 40 or p_time not between 10 and 600
     or (p_ghost is not null and pg_column_size(p_ghost) >= 300000) then
    raise exception 'bad_lap';
  end if;
  insert into time_trial (track, player, name, time, sectors, ghost)
  values (p_track, acc.id::text, acc.username, p_time, coalesce(p_sectors, '[]'::jsonb), p_ghost);
end $$;

-- Guests (no account) can still add laps directly, but never under an account's id.
create or replace function public.is_account_id(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from accounts where id::text = p);
$$;

drop policy if exists "add laps" on public.time_trial;
create policy "add laps" on public.time_trial for insert with check (
  char_length(track) between 1 and 40
  and char_length(name) between 1 and 16
  and char_length(player) between 1 and 64
  and time between 10 and 600
  and (ghost is null or pg_column_size(ghost) < 300000)
  and not public.is_account_id(player)
);

-- Only the functions meant for players can be called with the public key.
revoke execute on function public.account_new_session(uuid) from public, anon, authenticated;
revoke execute on function public.account_from_token(text) from public, anon, authenticated;
grant execute on function public.sign_up(text, text) to anon, authenticated;
grant execute on function public.sign_in(text, text) to anon, authenticated;
grant execute on function public.sign_out(text) to anon, authenticated;
grant execute on function public.whoami(text) to anon, authenticated;
grant execute on function public.change_password(text, text, text) to anon, authenticated;
grant execute on function public.submit_lap(text, text, double precision, jsonb, jsonb) to anon, authenticated;
grant execute on function public.is_account_id(text) to anon, authenticated;
