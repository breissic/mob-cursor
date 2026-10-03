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

## Schema / server
- **World is 16 x 9 units.** Pads send normalized 0..1 coordinates and the tick scales them. The cursor is stored in world units.
- **The tick runs only while at least one player is connected.** `clientConnected`, `clientDisconnected` and `join` insert or delete the interval row. No players means no ticks and no energy burn.
- **Presence comes from a private `session` table** (one row per connection), so a player who has two tabs open stays "connected" until the last tab closes. Disconnecting deletes the pointer and click vote.
- **Level row writes are limited to progress changes plus 1 Hz.** Every phone receives this row, and the cursor row already changes 15 times a second.
- **Minesweeper mines live in a private `level_secret` table.** The public `level.progress` only has revealed cells. The first click is always safe, because the mine moves away from it.
- **Maze: touching a wall sends the cursor back to the start**, frozen for 0.7 s. Losing only happens at the deadline, and each bonk costs 5 points. An earlier version that lost after N hits ended within a second.
- **Click quorum**: votes go into a private `click_vote` table. A click registers when `max(quorumMin, ceil(quorumFrac * active))` votes landed within `quorumWindowMs` and `quorumRadius` of the current cursor. Each player gets one vote per 250 ms.
- **The pointer rate limit in the reducer is a safety net only**, at 2x the advertised Hz. It returns silently instead of throwing, so it doesn't spam errors.
- **Energy lever**: `pointerHzEffective = clamp(min(pointerHz, pointerBudget / players), 1, 30)`. It's recomputed on join, leave and config changes, and clients read it live.
- **Admin**: the `init` reducer records the publisher identity in a private `admin` table. Other devices, like a laptop browser or the commentator worker, claim admin with a passphrase that the owner sets via `spacetime call ... admin_set_passphrase`. Only a salted SHA-256 is stored. Every `admin_*` reducer checks `ctx.sender` against `admin`. The admin route is only a UI.
- **`am_i_admin` view** exposes the single "is the caller an admin" bit from the private table, so the admin UI knows which screen to show.
- **`fx` is an event table** (votes, bonks, target hits, wins). The display gets sounds and particles without any stored rows.
- **The event log has a `sample` kind at 1 Hz** (cursor x/y, chaos, active count) for the replay/heatmap. The display excludes samples from its default subscription and pulls them per level only when the heatmap is on.
- **Awards are computed at level end** from private per-level `player_stats`, which the tick samples at 1 Hz. Awards with zero signal are skipped.

## Client
- **Hash routes** (`#/display`, `#/play`, `#/admin`), so the static host needs no rewrites.
- **No React re-render per frame**: the canvas reads `conn.db` in rAF. React chrome uses `useRows`, which coalesces table callbacks to at most every 100-500 ms.
- **Phones subscribe only to** `cursor`, `config`, `level WHERE state='running'` and `player WHERE identity = me`. The phone shows a mini-map from the cursor row, so it never needs the pointer table.
- **Phone send loop**: a `setTimeout` chain at `config.pointerHzEffective`. It sends only if the pointer moved more than 1% of the pad, or after a 1 s heartbeat, and only while the page is visible.
- **The QR code points at `VITE_PUBLIC_URL`** if set (useful when the display runs on localhost but phones need a LAN or prod URL). Otherwise it uses the current origin. `?db=` and `?host=` overrides carry over.

## Fun layer
- **Procedures can make HTTP calls** (`ctx.http.fetch`, beta), so the commentator could live inside the module. I kept it as a separate `worker/`, per the brief. That keeps the API key off the database host and makes it easy to kill.
