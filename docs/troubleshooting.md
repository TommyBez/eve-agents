# Troubleshooting

Real failure modes hit in this repo, with fixes. Generic first step for anything eve-shaped: `pnpm --filter <app> info` — it prints what eve discovered and any diagnostics, faster than booting the dev server.

For environment problems (wrong Node, broken install, missing env files), run `pnpm doctor` first — it checks the toolchain and prints the exact fix command for each failure.

## `pnpm install` fails with an engine error

**Symptom:** install aborts with an "unsupported engine" / Node-version error.

**Cause:** eve 0.18 hard-requires Node ≥ 24, and this repo enforces it (`engines: { node: "24.x" }` everywhere + `engine-strict=true` in `.npmrc`), so pnpm refuses to install on Node 22/20 instead of failing later at runtime.

**Fix:** `nvm use` (the repo has `.nvmrc` → `24`) or install Node 24, then re-run `pnpm install`. Do not remove `engine-strict` to "fix" this.

## Evals fail after an eve bump: `t.completed is not a function`

**Symptom:** typecheck or eval runs fail on `t.completed()` (or other removed eval APIs) after upgrading eve.

**Cause:** eve 0.15 removed the pre-0.15 eval API; `t.completed()` became `t.succeeded()`. This repo hit exactly this during the 0.13 → 0.18 migration.

**Fix:** rename to `t.succeeded()`. More generally: after any eve bump, diff your eval usage against `node_modules/eve/docs/evals/assertions.mdx` — the bundled docs always match the installed version.

## `eve dev` connects to the wrong thing / behaves stale

**Symptom:** a second `eve dev` reconnects to an old server, or the TUI reports a server that doesn't match your code.

**Cause:** local dev records the last ready URL per app root in `.eve/dev-server-state.v1.json` and reconnects when that URL is loopback and healthy. A stale record, or a *different* healthy process squatting the recorded URL, produces confusing reconnections.

**Fix:** stop all `eve dev` processes and delete `apps/<app>/.eve/dev-server-state.v1.json` (or the whole `.eve/` — it is disposable build output). Passing `--port`/`--host` (or setting `PORT`) skips reconnection entirely. Stale runtime snapshots can be cleared the same way: delete `.eve/dev-runtime/snapshots/` with the dev server stopped.

## Port conflict on 3000

**Symptom:** `eve dev`/`eve start` fails to bind, or requests hit a different app.

**Cause:** every app defaults to `$PORT`, then 3000. Two apps' dev servers collide.

**Fix:** run one at a time, or pin ports: `pnpm --filter <app> exec eve dev --port 3100`. Remember `--port` also disables dev-server reconnection (see above).

## Install fails resolving `catalog:` references

**Symptom:** `pnpm install` errors on a dependency declared as `"catalog:"` (unknown protocol, or a "catalog entry not found"-style error).

**Two causes:**

1. **pnpm too old.** Catalogs need pnpm ≥ 9.5; this repo pins pnpm 10 via `packageManager`. Use corepack (`corepack enable`) or install the pinned pnpm — a globally installed old pnpm is the usual culprit in CI images.
2. **Misspelled or missing catalog entry.** The package name in the app's `package.json` must match a key in the `catalog:` section of `pnpm-workspace.yaml` exactly. Add the entry there; never "fix" it by writing a version number in the app.

## Lint/test results look stale (biome or turbo cache confusion)

**Symptom:** `pnpm verify` passes but the code is visibly wrong, or lint keeps failing after you fixed the config — cached `lint`/`test` results being replayed.

**Cause:** turbo caches task outputs by input hash. Inputs that aren't part of the hash (e.g. an edit to root `biome.json`, an env var not covered by the task's `env` wildcards) don't invalidate the cache. `pnpm-workspace.yaml` and `.npmrc` *are* global dependencies, so catalog changes do bust caches — config files outside that list may not.

**Fix:** re-run with `--force` to bypass cache reads: `pnpm turbo run lint --force` (or the whole `verify` set). If a specific file keeps causing staleness, add it to `globalDependencies` in the root `turbo.json` or the task's `inputs`. Nuclear option: `pnpm clean` removes every generated tree (`.turbo`, `.eve`, `.next`, `.output`, `dist`, …) without touching `.env` files; `pnpm clean --modules` also removes every `node_modules` (follow with `pnpm install`).

## Missing `AI_GATEWAY_API_KEY` (local vs deployed)

**Symptom (local):** turns fail with an AI Gateway authentication error; the TUI points you at `/model`.

**Symptom (deployed):** the same, on a project without a model credential.

**How it's supposed to work:**

- **Deterministic evals and `pnpm verify` never need it** — they run on `mockModel` fixtures. If `eval:ci` demands a key, an eval tagged `ci` is wrongly using the real model.
- **Locally**, either run `/model` in the TUI (or `eve link`) to pull a credential into `.env.local` from a linked Vercel project, or set `AI_GATEWAY_API_KEY` in `.env.local`.
- **On Vercel**, a linked project authenticates gateway model ids via OIDC automatically — no key to set. Only non-Vercel hosts need `AI_GATEWAY_API_KEY` (or a direct provider key with a provider model object; see [deployment.md](./deployment.md#self-hosting-escape-hatch)).
- The eve CLI loads `.env`/`.env.local` from the **app root**, not the repo root — a key in the wrong directory is silently ignored.

## Still stuck?

- `eve info` for discovery problems; `eve build` prints full diagnostics on failure.
- Eval failures: read the artifacts under `apps/<app>/.eve/evals/<timestamp>/` — the console output is intentionally terse.
- Route the symptom through `.agents/skills/eve/SKILL.md` to the right doc under `node_modules/eve/docs/`.

## Evals start failing with `EMFILE: too many open files`

**Symptom:** `eve eval` (or `eval:ci`) fails with `[eve:dev] failed to prune stale runtime snapshots: EMFILE: too many open files, open '.../.workflow-data/events/...'`.

**Cause:** `.workflow-data/` (eve's local durable session state) accumulates event files with every eval/dev run and is never garbage-collected; once the directory outgrows the file-descriptor limit (`ulimit -n`), eve's own startup prune crashes. `pnpm doctor` warns when an app is approaching this.

**Fix:** normally automatic — the `dev`/`eval*` scripts run `scripts/prune-eve-state.mjs` first, which removes the store once it passes 1,000 event files. If you hit the error anyway (e.g. running `eve` directly), delete the app's local state — it is dev-only and safe to remove:

```bash
rm -rf apps/<app>/.workflow-data
```
