# Decisions

Small decisions made while building, newest at the bottom of each section.

## Tooling
- **SpacetimeDB CLI pinned to 2.10.2** (was 2.0.2 from install), to match the `spacetimedb` npm SDK 2.10.2 the template pulled. Done before any game code existed, so not a mid-project upgrade. `spacetime version use 2.10.2`.
- **Exact npm versions** (no `^`), lockfiles committed, Node 24 (`.nvmrc`, `engines`).
- **Client stays at the repo root** (template layout) instead of moving to `client/`. Less churn; `spacetimedb/` is the module.
- **`spacetime.json` points at production** (`mob-cursor-live` on maincloud). For local work use the npm scripts, which pass `--no-config` or explicit flags. Gotcha: with `spacetime.json` present, `spacetime call/sql <db>` resolves the DB from the config, so ad-hoc commands against other DBs need `--no-config`.
- **New production database `mob-cursor-live`** instead of reusing the template's `mob-cursor-9xp0y`. Reusing it would remove the template's `person` table, which needs `--delete-data`. The brief says to ask before any `--delete-data`, so I left the old DB untouched. Delete it whenever: `spacetime delete mob-cursor-9xp0y --server maincloud`.
- **Index syntax**: SDK 2.10 uses `accessor` (not `name`) in table-level index options. The repo's CLAUDE.md shows the older `name` form. I used column-level `.index()` to sidestep it.
- **Scheduled reducers use `reducer({ onSchedule: table }, ...)`**: the current docs prefer it over the deprecated `table({ scheduled })`. In 2.x, scheduled reducers are private by default, so clients cannot call `tick`.

- **CI publishes with `--yes=remote,migrate`**, not bare `--yes`. Bare `--yes` means `all`, which also auto-accepts break-clients and delete-data prompts.

## Schema / server
- **World is 16 x 9 units.** Pads send normalized 0..1 coordinates and the tick scales them. The cursor is stored in world units.
- **The tick runs only while at least one player is connected.** `clientConnected`, `clientDisconnected` and `join` insert or delete the interval row. No players means no ticks and no energy burn.
- **Presence comes from a private `session` table** (one row per connection), so a player who has two tabs open stays "connected" until the last tab closes. Disconnecting deletes the pointer and click vote.
- **Level row writes are limited to progress changes plus 1 Hz.** Every phone receives this row, and the cursor row already changes 15 times a second.
- **Minesweeper mines live in a private `level_secret` table.** The public `level.progress` only has revealed cells. The first click is always safe, because the mine moves away from it.
- **Maze: touching a wall sends the cursor back to the start**, frozen for 0.7 s. Losing only happens at the deadline, and each bonk costs 5 points. An earlier version that lost after N hits ended within a second.
- **Click quorum**: votes go into a private `click_vote` table. A click registers when `max(quorumMin, ceil(quorumFrac * active))` votes landed within `quorumWindowMs` and `quorumRadius` of the current cursor. Each player gets one vote per 250 ms.
- **The pointer rate limit in the reducer is a safety net only**, at 2x the advertised Hz. It returns silently instead of throwing, so it doesn't spam errors. It is a GCRA (private `pointer_rate` table) with a burst of 4: the earlier min-gap check dropped the *newer* of two packets that mobile Wi-Fi delivered close together.
- **Snappier spring by default** (`gain 40, damping 12, maxSpeed 20`, was `6 / 4.5 / 7`). The old spring took ~0.7 s to cover half the distance to the crowd target, which felt like lag no matter the network. `init` only applies to fresh databases, so set these on a live DB from the admin panel.
- **Energy lever**: `pointerHzEffective = clamp(min(pointerHz, pointerBudget / players), 1, 30)`. It's recomputed on join, leave and config changes, and clients read it live.
- **Admin**: the `init` reducer records the publisher identity in a private `admin` table. Other devices, like a laptop browser or the commentator worker, claim admin with a passphrase that the owner sets via `spacetime call ... admin_set_passphrase`. Only a salted SHA-256 is stored. Every `admin_*` reducer checks `ctx.sender` against `admin`. The admin route is only a UI.
- **`am_i_admin` view** exposes the single "is the caller an admin" bit from the private table, so the admin UI knows which screen to show.
- **`fx` is an event table** (votes, bonks, target hits, wins). The display gets sounds and particles without any stored rows.
- **The event log has a `sample` kind at 1 Hz** (cursor x/y, chaos, active count) for the replay/heatmap. The display excludes samples from its default subscription and pulls them per level only when the heatmap is on.
- **Awards are computed at level end** from private per-level `player_stats`, which the tick samples at 1 Hz. Awards with zero signal are skipped.

- **Stages**: every game has 3 stages (`STAGE_SPECS` in `sim.ts`). Stage number, count and `playAt` (end of the 3 s countdown, unix ms) live in the `level.params` JSON, so the schema stays unchanged. The flow goes stage 1→3 of a game, then the next game. A stage's score is multiplied by its stage number. The new `admin_start_stage` reducer is added alongside `admin_start_level`; `admin_start_level` was not changed, so CI's `--yes=remote,migrate` publish still goes through.
- **Countdown**: the tick holds the cursor at the start spot until `playAt`, and clicks registered before then are ignored. The deadline is `playAt + stage seconds`.
- **Minesweeper auto-click**: `progress.nextAutoAt` is public, and each fire re-rolls it to a random 2-30 s ahead using `ctx.random`. It's public so the display can show a 5 s fuse at the end, but the display never shows the full countdown, which keeps the surprise. `revealCell` now spreads the old progress so the timer survives a reveal.
- **`ghost_frame` table** (additive): at 5 Hz, a version byte then 6 bytes per fresh pointer, `[keyHi, keyLo, colorIndex, flags, x, y]` (`packGhosts`/`unpackGhosts` in `sim.ts`). The palette moved to `sim.ts` (`COLORS`) so the server and client agree on the color index.
- **Ghost key** is a 16-bit FNV-1a hash of the identity, not a schema column: changing the byte encoding needs no binding regeneration. Phones match ghosts across frames by key + color and glide them over ~1.25 frame intervals (raw 5 Hz frames teleported). A collision only drops smoothing for that pair. Records are sorted by key so an idle room yields identical bytes and skips the write. Old 4-byte frames are always 4n bytes and can never parse as 1 + 6k, so mixed deploys show no ghosts rather than garbage.
- **Phones hide their own ghost**: the finger dot already shows you, and a copy trailing ~200 ms behind it read as a bug.

- **Vote round** (`kind: 'vote'`, which is just another level row, so there's no schema change): after a game's 3rd stage, or on admin "next"/"vote", the mob gets a 3-2-1 countdown, then 7 s to park the cursor on a game card. The cursor runs at 2.5x gain and 2x top speed for the vote. When time is up, the card under the cursor wins; if the cursor is between cards, the nearest one wins, so there's always a winner. The winning game's stage 1 starts in the same tick. Card layout and winner logic live in `sim.ts` (`voteLayout`, `voteWinner`) so the display's "LEADING" chip matches the server.

- **Minesweeper is one life**: a bomb explodes and ends the stage immediately, and every mine is revealed (`'m'` cells). Before this a bomb cost one of 3 lives, which players read as "a bomb did nothing, then it failed at some random later time". Auto-click delay is now 0-30 s.
- **The board stays on screen after a stage ends**: the display keeps drawing the finished level, and the results dialog waits 1.5 s so the room sees the win or explosion first.

## Client
- **Hash routes** (`#/display`, `#/play`, `#/admin`), so the static host needs no rewrites.
- **No React re-render per frame**: the canvas reads `conn.db` in rAF. React chrome uses `useRows`, which coalesces table callbacks to at most every 100-500 ms.
- **The phone has no CLICK button**: taps on the pad only send `click` during minesweeper, the only game where clicks do anything. Elsewhere no reducer call is spent.
- **Phones subscribe only to** `cursor`, `config`, `level WHERE state='running'` and `player WHERE identity = me`. The phone shows a mini-map from the cursor row, so it never needs the pointer table.
- **Phone send loop**: leading-edge throttle at `config.pointerHzEffective`. A move sends at once if a full interval has passed, otherwise a trailing send fires at the end of the interval. Dead-band 0.4% of the pad, 1 s heartbeat, only while the page is visible.
- **Cursor prediction** (`src/lib/cursorSmoother.ts`, used by the display and the phone mini-map): each snapshot is advanced to "now" with the tick's own spring physics in whole tick steps, timed with `src/lib/clock.ts` (min-latency server-time estimate on the monotonic `performance` clock, decaying 0.3 ms per tick; the earlier 2 ms decay saw-toothed the estimate and showed up as jitter) so arrival jitter does not wobble it. Prediction is switched off while the tick pins the cursor (countdown before `playAt`, maze respawn `frozenUntil`). When a new snapshot disagrees, both predictions are compared at the same instant and the difference decays over ~100 ms. Tuned in a simulation with 30-90 ms jitter: about half the position error of the old extrapolate-and-ease renderer, at equal or better smoothness.
- **The QR code points at `VITE_PUBLIC_URL`** if set (useful when the display runs on localhost but phones need a LAN or prod URL). Otherwise it uses the current origin. `?db=` and `?host=` overrides carry over.

- **MobOS 95 look**: each game is an app window, and dialogs handle the intro and results. Fonts are Bungee and VT323 from Google Fonts. Sprites are pixel maps in code, rendered to cached canvases per tint; `scripts/gen-assets.ts` writes the same maps out as SVGs.
- **Canvas text at world-unit sizes broke** (sub-pixel fonts get clamped or mis-measured), so all world text goes through `worldText()`, which scales the context by 100.
- **The phone pad stretches the world to fill the pad**, so a pad position maps to the same world position. Sprites are drawn in screen space so they don't stretch.
- **Server clock estimate** (`lib/clock.ts`) comes from `cursor.lastTickAt`, and countdowns and timers use it, so laptop clock skew doesn't matter.

## Fun layer
- **Procedures can make HTTP calls** (`ctx.http.fetch`, beta), so the commentator could live inside the module. I kept it as a separate `worker/`, per the brief. That keeps the API key off the database host and makes it easy to kill.
- **Stale pointer cleanup**: a phone that sleeps or gets backgrounded can keep its connection open without ever sending a disconnect. The tick deletes any pointer that has been silent for 10 s (live clients heartbeat every 1 s), and the display hides ghosts older than 2.5 s by server time. The player row stays `connected` until the connection really closes.
