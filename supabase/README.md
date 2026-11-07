# Supabase setup

Every file here is run by hand in the Supabase **SQL Editor**. All of them are
idempotent, so re-running one is safe.

## Fresh project: the one-paste way (recommended)

Open **`setup-all.sql`**, copy the whole file, paste it into a new query in
the SQL Editor and press **Run**. It contains every file below in the right
order and ends by refreshing the API's schema cache. It runs as one
transaction: if anything fails, nothing is applied, and the error names the
statement. Running it again is safe.

After editing any individual file, regenerate it with
`bash supabase/build-setup.sh`.

## Fresh project: file by file

Run these top to bottom. The order matters: later files `alter` columns or
read functions that earlier ones create. It was verified end to end on a
clean Postgres 15 with Supabase's `auth` and `storage` schemas stubbed.

| # | File | What it sets up |
|---|------|-----------------|
| 1 | `00-base-schema.sql` | `profiles`, `game_results`, their RLS, and the signup trigger |
| 2 | `profile-hardening.sql` | older signup-trigger body plus a backfill (superseded by #3) |
| 3 | `guest-profile-trigger.sql` | current signup-trigger body, so guests get a profile |
| 4 | `cosmetics.sql` | `profiles.equipped_card_back` |
| 5 | `avatars.sql` | `profiles.avatar_version` and the `avatars` storage bucket |
| 6 | `presence.sql` | `profiles.last_seen_at`, `touch_presence`, `online_now` |
| 7 | `leaderboards.sql` | daily and weekly boards v1. Optional on a fresh project; never run it after #8, which replaces it |
| 8 | `leaderboards-v2.sql` | `share_code`, `country`, boards v2 |
| 9 | `leaderboards-alltime.sql` | all-time board |
| 10 | `results-hardening.sql` (STEP 1) | `record_bot_result`, narrowed profile writes |
| 11 | `ranks.sql` | rank helpers |
| 12 | `profile-pages.sql` | `public_profile` for `/p/<code>` |
| 13 | `profile-activity.sql` | profile heatmap |
| 14 | `profile-dossier.sql` | rank, promotions, recent games |
| 15 | `badges.sql` | `player_points` |
| 16 | `badges-prestige.sql` | prestige tiers |
| 17 | `friends.sql` | friendships |
| 18 | `friends-realtime.sql` | live friend requests |
| 19 | `friends-ping.sql` | pings |
| 20 | `friends-recent.sql` | recently played with |
| 21 | `invites.sql` | room invites |
| 22 | `invites-sent.sql` | sent-invite status |
| 23 | `pulse.sql` | site pulse stats |
| 24 | `polls.sql` | `poll_votes` |
| 25 | `daily-suspects.sql` | daily review query |
| 26 | `username-suggestions.sql` | name suggestions |

Later, once the frontend that calls `record_bot_result` is live (it is in this
repo), run **STEP 2** at the bottom of `results-hardening.sql` to remove direct
inserts into `game_results`.

`migrations/` belongs to the retired Supabase-broadcast multiplayer path.
Don't run it on a fresh project; multiplayer now runs on `game-server/`.

## Dashboard settings

- **Authentication → Sign In / Providers:** enable **Allow anonymous sign-ins**.
  PLAY NOW gives every player a guest account, and without this, sign-in fails
  with `anonymous_provider_disabled`.
- **Authentication → URL Configuration:** set **Site URL** to the deployed origin
  (for example `https://open-mercy.vercel.app`) and add it under Redirect URLs.
- **Google sign-in (optional):** see the OAuth section in `CLAUDE.md`. Guest
  conversion also needs **manual linking** enabled.

## Multiplayer results

The game server writes multiplayer rows to `game_results` with the
**service-role / secret key**, set as the Worker secret `SUPABASE_SERVICE_KEY`.
That key bypasses RLS: keep it in the Worker only, never in the frontend or
Vercel.
