# Open Mercy — Program Summary

A living overview of the codebase. **Update the Change log at the bottom with every change.**

## What it is

Open Mercy is a browser card game that implements the published rules of the
"Show 'Em No Mercy" ruleset (168-card deck, stacking draw cards, the
25-card Mercy knockout, 7-swap and 0-pass). You can play solo against bots, play
a seeded daily deal, or play real-time multiplayer with friends or at public tables.
It is an independent project, not affiliated with Mattel. The rules reference is
`https://service.mattel.com/instruction_sheets/HVW18-Eng.pdf`.

## Repository layout

| Path | What lives there |
|------|------------------|
| `shared/engine/` | **The rules engine** (pure TypeScript, no DOM). The frontend and the game server both import it through the `@engine` alias. |
| `shared/protocol.ts` | WebSocket wire format between the client and the game server (intents and snapshots). |
| `frontend/` | Vue 3 + TypeScript + Vite SPA: UI, the local game host (Pinia), and the multiplayer client. |
| `game-server/` | Cloudflare Worker + Durable Objects. One `GameRoomDO` per room holds the authoritative engine state. |
| `functions/` | Cloudflare Pages Functions: host redirects, `/api/geo` country lookup, `/p/<code>` server-side OG tags for shared profiles. |
| `api/`, `vercel.json` | Vercel ports of `functions/` (see Deployment). |
| `supabase/` | SQL files run by hand in the Supabase SQL editor (profiles, leaderboards, badges, friends, polls, presence). |
| `supabase-proxy/` | Optional Cloudflare Worker that proxies Supabase for regions that block it. |
| `mobile/` | A Flutter app; currently only the template stub. |
| `cards*/`, `promo-video/`, `docs/` | Reference art, marketing and design plans. |

## The rules engine (`shared/engine`)

- `types.ts`: `Card` (`color`, `type`, `value`), `Player`, `EngineState` (players,
  deck, discard pile, turn index, direction, `drawStack`, `currentColor`,
  `turnState`, UNO flags, stacking mode) and the `EngineEvent` union that hosts map
  onto sounds, stats and announcements.
- `deck.ts`: builds and shuffles the 168-card deck.
- `rules.ts`: pure helpers: `canPlayCard` (colour/number/symbol match plus the
  stacking rule), draw values, scoring, reshuffle, the Mercy check (25+ cards),
  and hand rotation for 0s.
- `engine.ts`: state transitions that mutate an `EngineState` in place:
  `playCard`, `applyCardEffect`, the Mercy elimination, the 7-swap, Color Roulette
  steps, UNO penalties, `drawFirstDiscard`, and `advanceTurn`.
- `bot.ts`, `botSearch.ts`, `playout.ts`, `sim.ts`: the bot ladder. Heuristics
  plus a Monte-Carlo lookahead that clones the engine state and plays it out.

The engine is **host-agnostic**: timers, draw pacing, the UNO catch window and bot
policy live in the hosts:

- **Local host**: `frontend/src/stores/gameStore.ts` wraps reactive refs in an
  `EngineState` facade, paces draws with timeouts, runs bots and records stats.
- **Network host**: `game-server/src/game.ts` + `index.ts` apply client intents
  (`PLAY_CARD`, `DRAW`, `SWAP_HANDS`, `SET_ROULETTE_COLOR`...) to the engine,
  run the 2-minute turn clock and auto-play on time-outs, and send each seat a
  personalised snapshot (opponents' hands hidden).

### Rules as implemented (official sheet)

| Rule | Behaviour |
|------|-----------|
| Deal | 7 cards each. The opening card is flipped again until it is a number card (action and wild cards are ignored). 2 to 6 players. |
| Play | Match colour, number or symbol. Wilds play on anything (except during a stack). |
| No match | Draw until you draw a playable card, then that card is played. |
| Stacking | On a +2/+4/+6/+10, play a draw card of equal or higher value to pass the total on. Whoever cannot stack draws it all and loses the turn. ("House" and "casual" stacking remain as opt-in settings.) |
| Mercy | 25+ cards in hand knocks you out. The hand is set aside (bottom of the discard pile) and only comes back in the next reshuffle. |
| 7 Swap | You **must** swap hands with a player of your choice. |
| 0 Pass | Every active player passes their hand to the next player in the direction of play. |
| UNO | At one card you must call UNO. If caught before the next player starts, draw **2**. |
| Skip / Reverse | Reverse acts as Skip with 2 players. |
| Skip Everyone | Everyone else is skipped; you play again. |
| Discard All | Every other card of that colour in your hand goes **under** the Discard All, which stays on top. No other effects fire. |
| Wild Reverse Draw 4 | Reverses, then the next player takes +4. With 2 players it skips the opponent and **you** face the +4 (you may stack to send it back). |
| Wild Draw 6 / 10 | Next player takes 6 / 10 and loses the turn (stackable). |
| Wild Colour Roulette | The next player names a colour and flips cards until that colour appears (wilds don't count), keeps them all, and loses the turn. |
| Winning | Play your last card, or be the last player left after Mercy knockouts. |
| Score | Face value for numbers, 20 for coloured actions, 50 for wilds, plus 250 per player knocked out. |

### Deck (168 cards)

Per colour: two of each number from 0 to 9 (80 in all), Skip ×3, Reverse ×3,
Draw 2 ×3, Discard All ×3, Draw 4 ×2, Skip Everyone ×2.
Wilds: Wild Reverse Draw 4 ×8, Wild Draw 6 ×4, Wild Draw 10 ×4, Wild Colour Roulette ×8.

## Frontend (`frontend/src`)

- `App.vue`: a screen state machine (not a router). It shows loading, password
  reset, landing, auth, the lobby, the game views, friends, leaderboard, badges,
  changelog and profile. `utils/routes.ts` maps pathnames to screens so deep links
  work.
- `components/game/`: the table. `GameView.vue` is solo play and
  `MultiplayerGameView.vue` is online play. Pieces include `HandFan`, `Card`/`CardBack`
  (programmatic SVG cards), `CardPile`, `OpponentChip`, `PlayerConsoleBar` (the
  UNO and draw controls), `StatusPanel`, the colour, player and discard pickers,
  `GameOverModal`, the `FxLayer` effects and `GameBackground`.
- `components/`: landing, auth, `MultiplayerLobby` (create, join, quick-match,
  bot ladder, daily), leaderboards, profiles, badges, friends, settings, what's new.
- `stores/`: `gameStore` (local host), `multiplayerStore` (thin WebSocket mirror),
  `authStore` (Supabase, guest anonymous auth, Google linking), `socialStore`,
  `inviteStore`, `retentionStore`, `settingsStore`, `voiceStore`.
- `composables/`: animation, sound, music, motion, presence and leaderboard data.
- `data/changelog.ts` + `data/polls.ts`: the player-facing release notes and polls.
- `mcp/`: WebMCP tools, so an AI agent can play a seat.
- Styling ("Sky Arena" theme): design tokens in `style.css` (`@theme` block: sky
  and panel colours, candy accents, Lilita One / Nunito type, radius, chunky shadows,
  motion, z-index). `theme-sky.css` re-skins the main panels and top bars. The table
  theme is the last section of `assets/game-shared.css`: the lime hill, avatar-tile
  seats, round HUD buttons and the round MERCY! button. Every dialog card gets the
  glossy panel through `components/ui/Modal.vue`. Colour zones: yellow is
  daily/streak, red is create/primary, aqua is multiplayer, and royal blue is neutral.

## Backend services

- **Supabase**: auth (including anonymous guests), `profiles`, `game_results`
  (owner-only RLS, with public reads through `SECURITY DEFINER` functions),
  friendships, presence, polls. The schema ships as additive SQL files.
- **Game server** (`uno-game-server` Worker): `/rooms`, `/room/<code>/ws`,
  `/public-rooms`, `/live-tables`, `/health`. It is deployed by hand with
  `cd game-server && npx wrangler deploy`.

## Build, test, run

```bash
cd frontend && npm install && npm run dev       # local dev
cd frontend && npm run build                    # vue-tsc + vite build
cd frontend && npx vitest run                   # engine, store, server-logic tests
```

Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (see `frontend/.env.example`).
`src/lib/supabase.ts` throws at import time without them.

## Deployment

- Originally: Cloudflare Pages (repo root, output `frontend/dist`) + Pages Functions,
  with the game server deployed separately.
- **Vercel** (current): `vercel.json` at the repo root builds `frontend/` into
  `frontend/dist`, falls back to `index.html` for SPA routes, and sets the security
  headers. `api/geo.ts` and `api/profile-og.ts` port the Pages Functions to edge
  functions (`/p/<code>` rewrites to the latter). Set `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` in the Vercel project. The game server is still a
  Cloudflare Worker (`VITE_GAME_SERVER_URL`).
- The host redirects in `functions/_middleware.js` were specific to open-mercy.com
  and are not ported.

## Change log

- **2026-11-07**: Created this summary.
- **2026-11-07**: Rules now match the official HVW18 sheet: the deck mix; number-only
  opening card; Discard All buries its colour; with 2 players Wild Reverse Draw 4
  returns to the player; the Mercy hand is set aside; the 7-swap is mandatory; the UNO
  penalty is 2; 2 to 6 seats. Tests updated and added (616 passing).
- **2026-11-07**: Sky Arena visual overhaul across the app (tokens, buttons, modals,
  table, card back, lobby and secondary pages).
- **2026-11-07**: Loud changelog entry `2026-11-07` announcing the rules and the new look.
- **2026-11-07**: Added the Vercel config and edge-function ports. New GitHub repo:
  `protoknight12/open-mercy`.
- **2026-11-07**: Deployed to Vercel at https://open-mercy.vercel.app. The project is
  connected to the GitHub repo, so pushes to `main` auto-deploy. Supabase env vars are
  set for production and preview (project `virnfnbbakymsdxyrbuy`, publishable key).
  Verified: pages, deep links, `/rules/*`, `/api/geo` (JSON), `/p/<code>` (shell
  fallback), security headers. Open items: enable anonymous sign-ins and set the Site
  URL in Supabase, since guest play fails until then.
- **2026-11-07**: Added `supabase/00-base-schema.sql` (the `profiles` and `game_results`
  tables, RLS, and the signup trigger that no file created) and `supabase/README.md`
  with the verified run order for all 26 files plus the dashboard settings.
  `results-hardening.sql` now pins its three legacy functions only if they exist.
  Verified on Postgres 15 with Supabase stubs: every file runs, signup creates a
  profile, `record_bot_result` enforces the daily's one attempt, other players can't
  read your rows, and the boards and `public_profile` return the data.
- **2026-11-07**: Live test on https://open-mercy.vercel.app: guest sign-in works, the
  signup trigger creates the profile row, and a solo game plays with official rules
  (number-only opening card; Discard All took 4 blue cards in one play and the turn
  passed). In the live project only `00-base-schema.sql` has run so far:
  presence, leaderboards, results-hardening (`record_bot_result`), profile pages,
  badges, friends and the rest still return "function not found", so solo results
  are not recorded and the boards stay empty until the remaining files run.
- **2026-11-07**: The recheck still showed only the base schema live. Added
  `supabase/setup-all.sql`, a one-paste setup generated by `supabase/build-setup.sh`,
  which leaves out the superseded `leaderboards.sql` (re-running it after v2 fails with
  "cannot change return type"). Made `polls.sql` re-runnable by adding drop-before-create
  for its policies. Verified on Postgres 15: a fresh run, two reruns inside one
  transaction, and the functional smoke test all pass.
- **2026-11-07**: The live recheck passed: every SQL file is live, a finished solo game is
  saved (it shows on the all-time board with the `/api/geo` country), and the
  `/p/<code>` share preview shows the player's rank and stats.
- **2026-11-07**: Seats around the table. `utils/seating.ts` (tested) orders opponents
  in turn order from the next player and assigns seats: 1 top; 2 left and right; 3 left,
  top, right; 4 adds the two top corners; 5 left, top-left, top, top-right, right. Both
  game views tag each chip with `seat-*`, and CSS at the end of
  `assets/game-shared.css` fixes the side seats at the table edges. On phones 520px
  wide or narrower, the corner seats drop to the sides, two per side. The flying-card
  back in `useCardAnimations.ts`, the dealer intro, the settings drawer, the game-over
  modal and the canvas share image now use the new card back and fonts.
