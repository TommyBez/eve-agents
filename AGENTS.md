# eve-agents

Turborepo monorepo of [eve](https://www.npmjs.com/package/eve)-framework agents. One app per agent under `apps/`. Node 24 + pnpm 10, strictly enforced.

## Repo map

- `apps/<name>/` — one eve agent per app. `apps/code-reviewer/` is the exemplar; new apps must mirror its shape.
- `packages/typescript-config/` — shared tsconfig (`@repo/typescript-config`). Other shared code follows the same internal-package pattern.
- `turbo/generators/` — the `pnpm agent:new` scaffolder and its templates.
- `docs/` — executable playbooks (see Playbooks below).
- `.agents/skills/` — skills for coding agents: `turborepo` (build system) and `eve` (index into the bundled eve docs).

## Golden commands

```bash
pnpm agent:new                     # scaffold a new agent (turbo gen agent) — the ONLY way to create one
pnpm agent:add @evex/<item>        # scaffold from the evex.sh registry (agent:new + overlay; see docs/adding-an-agent.md)
pnpm verify                        # lint + typecheck + build + test + eval:ci — run before finishing ANY task
pnpm --filter <app> dev            # run one agent's TUI REPL
pnpm --filter <app> eval           # run one agent's evals (all tiers)
pnpm --filter <app> test           # run one agent's unit tests
```

`pnpm verify` is the single verification loop. CI runs the same tasks, so green locally means green in CI. It must pass with **no env vars and no secrets** — that is what the deterministic eval tier guarantees.

## Before writing eve code

The eve docs for the exact installed version are bundled at `apps/<app>/node_modules/eve/docs/`. You MUST read the relevant guide there before writing or changing eve code (channels, tools, evals, schedules, connections, sandbox, deployment). Do not rely on memory — eve is pre-1.0 and APIs move.

Use `.agents/skills/eve/SKILL.md` as the routed index: it maps each topic to the exact doc file so you load one file instead of grepping eighty.

## Hard rules

1. **Versions live only in the `catalog:` section of `pnpm-workspace.yaml`.** App `package.json` files declare `"eve": "catalog:"` etc. Never write a version number in an app's `package.json`.
2. **Never import across `apps/*`.** An app imports its own code (`#*` maps to `./agent/*`) and workspace packages (`@repo/*`). Shared code goes to `packages/*` once a second consumer exists — see `docs/conventions.md`. Enforced by `scripts/check-cross-app-imports.mjs` (runs in `pnpm verify` and CI).
3. **App-specific env vars are prefixed with the SCREAMING_SNAKE app name** (`CODE_REVIEWER_*` for `code-reviewer`). Shared platform vars (`AI_GATEWAY_API_KEY`, `GITHUB_APP_*`, `SLACK_*`, ...) keep their canonical names. Every var an app reads is listed in its `.env.example`.
4. **New agents are created only via `pnpm agent:new`.** Never hand-copy an existing app or run `eve init` inside this repo.
5. **Run `pnpm verify` before finishing any task.** If you touched only one app, `pnpm turbo run lint typecheck build test eval:ci --filter <app>` is an acceptable fast path, but the full `pnpm verify` is the definition of done.
6. **Deterministic evals (tag `ci`) must stay green without secrets.** Never add a real-model or network dependency to an eval tagged `ci`; that belongs in the `live` tier (`evals/live/`, tag `live`).
7. Upgrade eve only via `pnpm upgrade:eve [version]` — it bumps the catalog, prints the CHANGELOG delta, re-validates `.agents/skills/eve/SKILL.md` doc paths, and runs `pnpm verify`. If it reports missing skill paths, update the skill index before committing.

## Per-app AGENTS.md

Each app has its own `AGENTS.md` covering only app-specific context: what the agent does, its env vars, its surfaces, and how to run just that app. This file owns the repo-wide rules; never restate them per app.

## Playbooks

| Task | Read |
| --- | --- |
| Add a new agent end to end | `docs/adding-an-agent.md` |
| Test an agent (unit / deterministic / live / per surface) | `docs/testing.md` |
| Deploy to Vercel, or self-host | `docs/deployment.md` |
| Naming, imports, env, packages, channel auth, MCP, schedules | `docs/conventions.md` |
| Something is broken | `docs/troubleshooting.md` |
