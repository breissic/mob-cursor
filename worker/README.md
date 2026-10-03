# Commentator worker

The worker narrates the mob's failures like an overexcited sports announcer. It runs as a separate Node process, so the Claude API key never reaches the module, the client or git.

```bash
cd worker && npm ci
# Once, as the DB owner: spacetime call mob-cursor-live admin_set_passphrase '"<passphrase>"' --server maincloud
ANTHROPIC_API_KEY=... ADMIN_PASSPHRASE=<passphrase> npm start
```

- It subscribes to `event_log` (but not the 1 Hz `sample` rows), `level`, `player`, `cursor` and `config`.
- It speaks at most once every `MIN_GAP_MS` (7 s by default). It speaks right away on urgent events (level start/end, mine, dictator) and otherwise every `IDLE_GAP_MS` (15 s), and only when something has happened.
- It posts through the admin-only `post_commentary` reducer. It claims admin once with `ADMIN_PASSPHRASE` and keeps its identity token in `worker/.stdb-token-<db>` (gitignored).
- It uses Claude Opus 5.5 at effort `low`, with server-side refusal fallback enabled (`fallbacks: "default"`).
- Without `ANTHROPIC_API_KEY` it runs in **DRY RUN** mode and posts canned lines, which is handy for testing the pipeline.
- `STDB_HOST` / `STDB_DB` point it at another database (default: Maincloud `mob-cursor-live`).
