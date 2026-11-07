-- Base schema: the two tables every other file in supabase/ builds on.
-- Run this FIRST in the Supabase SQL Editor of a fresh project, then the
-- rest in the order listed in supabase/README.md.
--
-- The original deployment created these tables by hand, outside version
-- control, so a fresh project had nothing for leaderboards-v2.sql,
-- presence.sql, results-hardening.sql and the rest to ALTER or read. The
-- columns here are exactly what the code writes and reads:
--   profiles      - authStore.ts (upsert id, username; select *), plus the
--                   columns later files add with `add column if not exists`
--                   (share_code, country, equipped_card_back, last_seen_at,
--                   avatar_version), which are left to those files.
--   game_results  - game-server/src/game.ts persistResults() and
--                   record_bot_result() in results-hardening.sql.
--
-- Idempotent: safe to re-run. Additive only.

-- ============================== profiles ==============================

create table if not exists public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    username     text not null unique,
    games_played integer not null default 0,
    games_won    integer not null default 0,
    created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Names, share codes and countries are public anyway (leaderboards, profile
-- pages, friend lists, avatars all read other players' rows), so anyone may
-- read a profile. Writes are your own row only; results-hardening.sql then
-- narrows WHICH columns a player may write.
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles
    for select to anon, authenticated using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
    for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
    for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

-- ============================ game_results ============================

create table if not exists public.game_results (
    id                     bigint generated always as identity primary key,
    game_id                text not null,
    user_id                uuid not null references auth.users (id) on delete cascade,
    opponent_count         integer not null default 1,
    result                 text not null check (result in ('won', 'lost', 'eliminated')),
    cards_remaining        integer not null default 0,
    peak_cards             integer not null default 0,
    draw_cards_played      integer not null default 0,
    wild_cards_played      integer not null default 0,
    cards_played_total     integer not null default 0,
    skips_dealt            integer not null default 0,
    swaps_made             integer not null default 0,
    draws_taken            integer not null default 0,
    biggest_stack_survived integer not null default 0,
    uno_calls              integer not null default 0,
    uno_penalties          integer not null default 0,
    game_duration_secs     integer not null default 0,
    is_bot_game            boolean not null default false,
    played_at              timestamptz not null default now(),
    created_at             timestamptz not null default now()
);

-- One row per player per game. This is also the daily's one-attempt rule:
-- a second 'daily-YYYY-MM-DD' result for the same player is a
-- unique_violation, which record_bot_result() reports as 'duplicate'.
create unique index if not exists game_results_game_user_idx
    on public.game_results (game_id, user_id);
create index if not exists game_results_user_played_idx
    on public.game_results (user_id, played_at desc);

-- Owner-select-only (see CLAUDE.md): every public read goes through a
-- SECURITY DEFINER function. Never widen this.
alter table public.game_results enable row level security;

drop policy if exists game_results_select_own on public.game_results;
create policy game_results_select_own on public.game_results
    for select to authenticated using (user_id = auth.uid());

-- Kept only until results-hardening.sql STEP 2 revokes direct inserts; after
-- that, solo results arrive via record_bot_result() and multiplayer results
-- via the game server's service-role key (which bypasses RLS).
drop policy if exists game_results_insert_own on public.game_results;
create policy game_results_insert_own on public.game_results
    for insert to authenticated with check (user_id = auth.uid());

grant select, insert on public.game_results to authenticated;

-- ===================== profile on signup (trigger) =====================

-- guest-profile-trigger.sql replaces this body with the full version (name
-- collision handling, guest support). It is defined here first only so the
-- trigger below can be created; no file in the repo created the trigger.
create or replace function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.is_anonymous or new.email_confirmed_at is not null then
        insert into public.profiles (id, username)
        values (new.id, left(coalesce(nullif(new.raw_user_meta_data->>'username', ''), 'Player'), 11)
                        || '_' || left(new.id::text, 8))
        on conflict (id) do nothing;
    end if;
    return new;
exception when others then
    raise warning 'profile insert failed for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.create_profile_for_user();

-- Email signups get their profile when the address is confirmed.
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
    after update of email_confirmed_at on auth.users
    for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
    execute function public.create_profile_for_user();

-- ============================== feedback ==============================
-- The in-game feedback form (components/FeedbackModal.vue) inserts here.
-- Anyone may submit; nobody can read submissions through the API. Read them
-- in the Table Editor or SQL Editor. Until this table exists, the form falls
-- back to opening a prefilled GitHub issue.
create table if not exists public.feedback (
    id         bigint generated always as identity primary key,
    message    text not null check (char_length(message) between 1 and 4000),
    email      text check (email is null or char_length(email) <= 320),
    user_id    uuid references auth.users (id) on delete set null,
    page       text check (page is null or char_length(page) <= 500),
    user_agent text check (user_agent is null or char_length(user_agent) <= 500),
    created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

drop policy if exists feedback_insert_any on public.feedback;
create policy feedback_insert_any on public.feedback
    for insert to anon, authenticated
    with check (user_id is null or user_id = auth.uid());

grant insert on public.feedback to anon, authenticated;
