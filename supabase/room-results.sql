-- Multiplayer results for peer-hosted rooms. Run in the Supabase SQL Editor
-- (included in setup-all.sql). Additive and idempotent.
--
-- With the Cloudflare Worker, the server saved every seat's game_results row
-- with the service-role key. Peer-hosted rooms (frontend/src/p2p/) have no
-- server, and a browser must never hold that key, so each player files their
-- own row through this function, the same trust model record_bot_result
-- already uses for solo games. The frontend feature-detects it: until this
-- file has run, finished online games simply are not recorded.
--
-- Guards: the caller is auth.uid() (never a parameter); the game id must be a
-- room game id minted in the last six hours; a win requires an empty hand;
-- every stat is clamped to what real games produce; one row per player per
-- game (the unique index in 00-base-schema.sql); and a rate limit.

create or replace function public.record_room_result(
    p_game_id text,
    p_result text,
    p_opponent_count int,
    p_cards_remaining int,
    p_peak_cards int,
    p_draw_cards_played int,
    p_wild_cards_played int,
    p_cards_played_total int,
    p_skips_dealt int,
    p_swaps_made int,
    p_draws_taken int,
    p_biggest_stack_survived int,
    p_uno_calls int,
    p_uno_penalties int,
    p_game_duration_secs int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    me uuid := auth.uid();
    started_ms bigint;
begin
    if me is null then return 'unauthorized'; end if;
    if p_game_id !~ '^do-[A-Z0-9]{4,8}-[0-9]{12,14}$' then return 'bad_game'; end if;
    if p_result not in ('won', 'lost', 'eliminated') then return 'bad_result'; end if;
    if p_result = 'won' and coalesce(p_cards_remaining, 0) <> 0 then return 'bad_result'; end if;

    started_ms := substring(p_game_id from '([0-9]+)$')::bigint;
    if started_ms > (extract(epoch from now()) * 1000)::bigint + 60000
       or started_ms < (extract(epoch from now() - interval '6 hours') * 1000)::bigint then
        return 'stale';
    end if;

    if (
        select count(*) from game_results
        where user_id = me and not is_bot_game
          and played_at > now() - interval '10 minutes'
    ) >= 20 then return 'too_soon'; end if;

    insert into game_results (
        game_id, user_id, opponent_count, result, cards_remaining, peak_cards,
        draw_cards_played, wild_cards_played, cards_played_total, skips_dealt,
        swaps_made, draws_taken, biggest_stack_survived, uno_calls,
        uno_penalties, game_duration_secs, is_bot_game, played_at
    ) values (
        p_game_id, me,
        least(greatest(coalesce(p_opponent_count, 1), 1), 5),
        p_result,
        least(greatest(coalesce(p_cards_remaining, 0), 0), 25),
        least(greatest(coalesce(p_peak_cards, 0), 0), 25),
        least(greatest(coalesce(p_draw_cards_played, 0), 0), 60),
        least(greatest(coalesce(p_wild_cards_played, 0), 0), 60),
        least(greatest(coalesce(p_cards_played_total, 0), 0), 200),
        least(greatest(coalesce(p_skips_dealt, 0), 0), 60),
        least(greatest(coalesce(p_swaps_made, 0), 0), 30),
        least(greatest(coalesce(p_draws_taken, 0), 0), 200),
        least(greatest(coalesce(p_biggest_stack_survived, 0), 0), 100),
        least(greatest(coalesce(p_uno_calls, 0), 0), 50),
        least(greatest(coalesce(p_uno_penalties, 0), 0), 20),
        least(greatest(coalesce(p_game_duration_secs, 0), 0), 6 * 3600),
        false, now()
    );
    return 'ok';
exception
    when unique_violation then return 'duplicate';
end;
$$;

revoke execute on function public.record_room_result from public, anon;
grant execute on function public.record_room_result to authenticated;
