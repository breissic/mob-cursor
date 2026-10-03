# Workflows

- `ci.yml`: typecheck, lint, unit tests, module build, client build and a stale-bindings check on every PR and on pushes to main.
- `publish-module.yml`: publishes `spacetimedb/` to Maincloud (`mob-cursor-live`) on pushes to main that touch the module. It never uses `--delete-data`. A manual run defaults to the throwaway DB `mob-cursor-ci-test`.

The frontend isn't deployed from here. Vercel's Git integration builds it (see the README's "Deploy" section).
