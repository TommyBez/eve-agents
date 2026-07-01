# Plan: Eve Agents Monorepo Starter Template

Transform this repository into a **starter template for a Turborepo monorepo of Eve agents**, optimized for:

1. **Fast, consistent agent creation** — a new agent goes from zero to running REPL in one command.
2. **Multi-surface testing** — every agent is exercisable locally (TUI, HTTP), via evals (deterministic + live), and per channel (Slack, GitHub, Linear, schedules).
3. **Long-term maintainability by AI coding agents** (Claude Code, Codex, Cursor) — one canonical verification loop, single-sourced versions, checked-in conventions, and machine-readable guardrails.

Everything below is grounded in **Eve 0.18.0** (docs bundled at `node_modules/eve/docs/`) and **Turborepo 2.x**, validated against this repo on 2026-07-01.

---

## 0. Decisions already made (with the maintainer)

| Decision | Choice |
| --- | --- |
| Example agents | Keep **`code-reviewer`** as the single exemplar (it exercises channels, tools, skills, lib code, and evals). Remove `linear-operation-agent`, `postgres-data-analyst`, `x-draft-assistant`, `x-hot-topic-digest`. |
| Deliverable | This plan first; implementation in follow-up sessions, phase by phase. |
| Deployment | **Vercel-first** (`eve link` / `eve deploy`, per-app Vercel projects). Self-hosting documented as an escape hatch only. |
| Toolchain | **Node 24 + pnpm, strictly enforced** (Eve 0.18 hard-requires Node ≥ 24). |

## 0.1 Groundwork already applied on this branch

Validated and committed together with this plan:

- `eve` bumped `^0.13.3 → ^0.18.0` in all five apps; `ai` bumped `7.0.0-beta.178 → 7.0.10` (stable) including the root `overrides`/`resolutions`; lockfile updated.
- `apps/code-reviewer` evals migrated off the removed pre-0.15 eval API (`t.completed()` → `t.succeeded()`); `code-reviewer` now **typechecks and `eve build` succeeds on Node 24.18**.
- Known-red leftovers, intentionally not fixed because Phase 1 deletes those apps: `postgres-data-analyst` (missing `@types/pg`, extensionless relative imports), `x-draft-assistant` (union-narrowing error in `typefully-client.ts`). Neither failure is caused by the Eve upgrade — both predate it.

---

## 1. Current-state assessment (what the template must fix)

Audit findings against the tree as of commit `b4fd717`:

**Structural**
- Five hand-grown apps with copy-paste drift: three files duplicated ~98–100% between the two `x-*` apps (`hot-topic-config.ts`, `scan_x_profiles.ts`, `research_hot_topics.ts`); every app repeats identical `agent/channels/eve.ts`, `tsconfig.json`, `imports` map, and a large hand-maintained `turbo.json`.
- `packages/*` is declared in `pnpm-workspace.yaml` but empty — no shared-code story exists.

**Version management**
- `scripts/create-agent.mjs` hardcodes `eve ^0.13.3` and `ai 7.0.0-beta.178` — five minor versions behind the apps it scaffolds next to. This is the exact failure class the template must make impossible.
- `@vercel/connect` split across apps (`0.2.2` vs `0.2.7`).
- `pnpm-workspace.yaml` carries a stale `packageExtensions` shim for eve 0.6–0.7 and a `minimumReleaseAgeExclude` list that no longer matches the 0.18 scaffold's.

**Tooling gaps**
- No linter, no formatter, no unit tests, no CI, no `.env.example` anywhere, 4 of 5 apps have no README.
- Per-app `turbo.json` files contain 20+-entry `passThroughEnv` lists repeated across `dev`/`eval`/`start` — pure maintenance drag.
- Apps pin a dated TypeScript-native dev snapshot (`@typescript/native-preview 7.0.0-dev.20260523.1`, script `tsgo`); the current eve scaffold ships `typescript@7.0.1-rc` with plain `tsc`.

**Eve 0.18 features the repo doesn't use yet but the template should**
- `mockModel()` fixture models for deterministic, key-less evals (0.15.4+).
- `eve eval --strict --junit <path> --tag <tag>` for CI gating and reporting.
- Snapshot-style eval assertions (`t.succeeded()`, `t.calledTool(name, {input, count})`, `t.toolOrder`, `t.judge.autoevals.*`).
- `defineAgent({ reasoning, limits: { maxInputTokensPerSession, maxSubagentDepth } })` cost/recursion guardrails.
- `eve dev <url>` — attach the local TUI to a deployed preview/production agent.
- `t.target.dispatchSchedule(id)` — trigger cron schedules from evals.

---

## 2. Target architecture

```
eve-agents/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # lint → typecheck → build → test → eval (deterministic), --affected on PRs
│   │   ├── evals-live.yml          # nightly live-model evals (tag: live), non-blocking
│   │   └── scaffold-drift.yml      # weekly: `eve init` in tmp dir, diff against our template
│   └── renovate.json5              # grouped weekly eve/ai/vercel updates
├── .agents/skills/                 # skills for AI coding agents (checked in, hash-locked)
│   ├── turborepo/                  # existing vendored Vercel skill (keep)
│   └── eve/                        # NEW: index/router into node_modules/eve/docs
├── .cursor/rules/eve-agents.mdc    # Cursor rule that defers to AGENTS.md
├── AGENTS.md                       # canonical instructions for AI agents (rewritten, see §8)
├── CLAUDE.md                       # stays: `@AGENTS.md`
├── PLAN.md                         # this document (delete once executed)
├── docs/
│   ├── adding-an-agent.md          # end-to-end playbook (generator → env → dev → eval → deploy)
│   ├── testing.md                  # the multi-surface testing matrix (see §6)
│   ├── deployment.md               # Vercel-first: eve link/deploy, turbo-ignore, env management
│   ├── conventions.md              # naming, imports, env prefixes, when to extract a package
│   └── troubleshooting.md          # common eve/turbo failure modes and fixes
├── turbo/
│   └── generators/
│       ├── config.ts               # `turbo gen agent` implementation
│       └── templates/agent/        # handlebars templates for a new agent (see §4)
├── apps/
│   └── code-reviewer/              # the exemplar agent (kept, polished — see §7)
│       ├── AGENTS.md               # app-scoped agent instructions
│       ├── README.md
│       ├── .env.example
│       ├── package.json            # deps via `catalog:`, standard scripts
│       ├── tsconfig.json           # extends @repo/typescript-config
│       ├── turbo.json              # ~15 lines, wildcard env (see §5)
│       ├── agent/                  #   eve canonical layout: agent.ts, instructions.md,
│       │   ├── ...                 #   channels/, tools/, skills/, lib/, (schedules/, connections/)
│       ├── evals/
│       │   ├── evals.config.ts
│       │   ├── deterministic/*.eval.ts   # mockModel fixtures, tag "ci" — run on every PR, no keys
│       │   └── live/*.eval.ts            # real model, tag "live" — nightly / on demand
│       └── tests/                  # vitest unit tests for agent/lib and tool logic
├── packages/
│   └── typescript-config/          # @repo/typescript-config (base.json) — replaces root tsconfig.base.json
│       └── (future shared packages follow this pattern: internal, just-in-time TS)
├── package.json                    # name: eve-agents; scripts delegate to turbo; pnpm 10 pinned
├── pnpm-workspace.yaml             # workspaces + **catalog** (single source of dependency truth)
├── turbo.json                      # root pipeline incl. lint/test/eval:ci, wildcard env strategy
├── biome.json                      # lint + format (single tool)
├── .npmrc                          # engine-strict=true
├── .nvmrc                          # 24
└── .gitignore / .vercelignore
```

Design principles:

- **One source of truth per fact.** Dependency versions live only in the pnpm catalog. TS config lives only in `@repo/typescript-config`. Conventions live only in `AGENTS.md`/`docs/` (README links there, never restates).
- **Apps are self-contained; packages are opt-in.** An agent app never imports from another app (enforced, §8). Shared code is extracted to `packages/*` only when a second consumer appears.
- **Everything an AI agent needs to verify its work is one command** (`pnpm verify`, §8) and every playbook is a checked-in doc it can follow deterministically.

---

## 3. Phase 1 — Toolchain baseline & repo hygiene (size: S)

Goal: strict, reproducible toolchain; delete what the template won't keep.

1. **Remove four apps**: `git rm -r apps/{linear-operation-agent,postgres-data-analyst,x-draft-assistant,x-hot-topic-digest}`. Before deleting, harvest into `docs/` any pattern worth keeping as prose: the MCP connection + per-tool approval gating from `linear-operation-agent/agent/connections/linear.ts`, the `defineSchedule` recipes, and the Slack channel setup — these become short examples in `docs/conventions.md`/`docs/testing.md` rather than living code.
2. **Node/pnpm enforcement**:
   - `.nvmrc` → `24`; keep `engines: { node: "24.x" }` root and per app.
   - `.npmrc` → `engine-strict=true` (pnpm then refuses Node < 24, matching eve's own hard check).
   - Bump `packageManager` to the latest pnpm 10.x and rely on corepack in CI.
3. **Root package.json**: rename `eve-test` → `eve-agents`; keep the `ai` override until nothing in the tree resolves a different `ai` major (re-evaluate in Phase 2 — with catalogs it likely becomes redundant and should be deleted).
4. **pnpm-workspace.yaml**: drop the stale `packageExtensions` (eve 0.6–0.7) shim; adopt the `minimumReleaseAgeExclude` list the 0.18 scaffold generates (`eve`, `ai`, `@ai-sdk/*`, `@vercel/*`, `@workflow/*`, `nitro`, `rolldown`, `@rolldown/*`, `workflow`, `experimental-ai-sdk-code-mode`); keep `allowBuilds: { sharp: false }`.
5. **TypeScript**: align with the current eve scaffold — `typescript@7.0.1-rc` (the native compiler; `tsc` binary) via catalog, script `"typecheck": "tsc"`. Drop the pinned `@typescript/native-preview` dev snapshot. Rationale: track what `eve init` ships so scaffold-drift checks (§4.3) stay meaningful.
6. **Acceptance criteria**: fresh clone + `pnpm install` fails on Node 22 with a clear error; succeeds on Node 24; `pnpm turbo run typecheck build` green across the (now 1-app) workspace.

## 4. Phase 2 — Version single-sourcing & the agent generator (size: M) — *the core DX phase*

### 4.1 pnpm catalog (adopt: third-party/native)

Define every cross-app dependency once in `pnpm-workspace.yaml`:

```yaml
catalog:
  eve: ^0.18.0
  ai: ^7.0.0
  zod: 4.4.3
  "@vercel/connect": 0.2.7
  "@types/node": 24.x
  typescript: 7.0.1-rc
```

Apps declare `"eve": "catalog:"`. Upgrading eve for the whole repo becomes a one-line diff — trivially reviewable and trivially automatable by Renovate or an AI agent. This **structurally eliminates** the `create-agent.mjs` version-drift bug: the generator emits `catalog:` references, never version numbers.

*Evaluated alternatives*: `syncpack`/`sherif` (post-hoc version linters) — not needed once catalogs make drift unrepresentable; revisit only if apps start needing intentionally divergent versions.

### 4.2 `turbo gen agent` replaces `scripts/create-agent.mjs` (adopt: third-party with checked-in templates)

- Implement a Turborepo generator (`turbo/generators/config.ts`, Plop/handlebars) invoked as **`pnpm agent:new`** (alias for `turbo gen agent`).
- Prompts: agent name (kebab-cased), description, primary surface (`http-only` | `slack` | `github` | `linear` | `scheduled`), whether to include a live-eval stub.
- Emits from `turbo/generators/templates/agent/`:
  - `package.json` — catalog deps, standard scripts (`build/dev/start/eval/info/typecheck/test/lint`), `imports` map (`#*`, `#evals/*`), engines.
  - `tsconfig.json` (extends `@repo/typescript-config/base.json`), minimal `turbo.json` (§5), `.gitignore` (`.vercel`).
  - `agent/agent.ts` (`defineAgent({ model: "anthropic/claude-sonnet-5", limits: { maxInputTokensPerSession: … } })`), `agent/instructions.md` skeleton, `agent/channels/eve.ts` (the canonical `vercelOidc() + localDev() + placeholderAuth()` stack with the "replace before production" comment), plus the surface-specific channel file when selected.
  - `evals/evals.config.ts` + one **deterministic smoke eval** using `mockModel` (tag `ci`) that passes out of the box, + optional live-eval stub (tag `live`).
  - `tests/` with one vitest example, `.env.example` seeded with `AI_GATEWAY_API_KEY` + surface-specific vars, `README.md` and `AGENTS.md` from templates.
- Post-generate actions: `pnpm install`, then `pnpm --filter <name> run info` as a smoke check (mirrors what the old script did, minus the version drift).

*Evaluated alternatives*:
- *Wrap `eve init` at generate time* (current approach): couples every scaffold to network/CLI behavior, requires post-hoc normalization (deleting `.git`, `pnpm-workspace.yaml`, lockfile), and produced the drift bug. Rejected as the primary path.
- *Custom Node script*: what exists today; loses Turborepo's prompt/CLI conventions and is more code to maintain. Rejected.

### 4.3 Scaffold-drift guard (build: custom, small)

Because we template instead of calling `eve init`, guard against upstream divergence: a small script (`scripts/check-scaffold-drift.mjs`) runs `eve init` into a temp dir with the workspace's eve version and diffs the *shape-defining* files (`agent/channels/eve.ts`, `tsconfig.json` compiler options, `package.json` deps/scripts, `pnpm-workspace.yaml` excludes) against our templates, allowing known intentional differences. Runs weekly in CI (`scaffold-drift.yml`) and opens/updates an issue on drift. This keeps our templates honest against every eve release with ~100 lines of custom code — the one place custom tooling clearly beats anything off the shelf.

### 4.4 Acceptance criteria

`pnpm agent:new -- --name demo --surface http-only` (non-interactive flags supported) produces an app where, with **zero manual edits and zero env vars**: `pnpm --filter demo run typecheck`, `build`, `test`, and `eval` (deterministic tag) all pass, and `pnpm --filter demo run dev` boots the TUI. Delete the demo, repo stays green.

## 5. Phase 3 — Turborepo pipeline & env-var strategy (size: S)

1. **Root `turbo.json`** gains: `lint`, `test` (vitest, cached, `dependsOn: ["^build"]` not needed — no compile step), `eval:ci` (deterministic evals; cached=false), and `"globalDependencies": ["pnpm-workspace.yaml", ".npmrc"]` so catalog changes bust caches. Existing `build/dev/start/typecheck/eval/info` stay.
2. **Kill the giant `passThroughEnv` lists.** Strategy:
   - Non-cached, interactive tasks (`dev`, `start`, `eval`) get `"passThroughEnv": ["*"]` **in the root pipeline** — they aren't hashed, so strict-mode filtering buys nothing there and costs a config edit for every new env var (today's biggest per-app `turbo.json` burden).
   - Cached tasks (`build`, `typecheck`, `test`) keep explicit `env` with **wildcards**: shared root entries `["NODE_ENV", "VERCEL", "VERCEL_ENV"]` plus one per-app line using the app's env prefix, e.g. `"env": ["CODE_REVIEWER_*", "GITHUB_APP_*"]`.
   - Result: a new agent's `turbo.json` is ~10 lines and almost never touched again.
3. **Env-prefix convention** (documented in `docs/conventions.md`, enforced by template): every app-specific variable is prefixed with the SCREAMING_SNAKE app name (`CODE_REVIEWER_*`); shared platform vars (`AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`, `GITHUB_APP_*`, `SLACK_*`) are enumerated in `.env.example`. Each app ships `agent/lib/env.ts` — a zod-validated, typed env module (pattern in the template) so misconfiguration fails loudly at boot, not mid-session.
4. **Remote caching**: enable Vercel Remote Cache (`npx turbo login && npx turbo link`); CI uses `TURBO_TOKEN`/`TURBO_TEAM` secrets. Fallback if no Vercel team cache: `actions/cache` on `.turbo`.
5. **Acceptance criteria**: `turbo run build` twice → second run `FULL TURBO`; changing an app-prefixed env var invalidates only that app's `build`; `apps/*/turbo.json` ≤ ~15 lines each.

## 6. Phase 4 — Testing across surfaces (size: M)

Three test tiers, all runnable per-app and repo-wide:

| Tier | Tool | When | Needs API keys? |
| --- | --- | --- | --- |
| Unit (`tests/`) | vitest | every PR, cached by turbo | no |
| Deterministic evals (`evals/**`, tag `ci`) | `eve eval --tag ci --strict --junit` with `mockModel` fixtures | every PR | no |
| Live evals (tag `live`) | `eve eval --tag live --strict` against real models | nightly + pre-release, manual dispatch | yes (`AI_GATEWAY_API_KEY`) |

1. **Unit tests**: add vitest via catalog; test pure logic in `agent/lib/*` and tool `execute` bodies (they're plain functions — import and call). The exemplar gets tests for `review-rate-limit.ts`.
2. **Deterministic evals**: introduce the `mockModel` pattern — an eval-only agent fixture (or `modelOverride` per eval where supported) so the run exercises eve's real runtime, channel routing, tool wiring, and assertions without a provider call. Tag `ci`. This is what makes `pnpm verify` runnable by any AI agent with no secrets.
3. **Live evals**: keep the existing behavioral evals, tag `live`, run via `evals-live.yml` nightly with `--junit` output uploaded as artifact; soft-fail initially (report, don't block) until flake rate is known, then tighten with `--strict`.
4. **Surface-specific testing recipes** in `docs/testing.md` (the "test across multiple surfaces" deliverable):
   - **HTTP/eve channel**: `eve dev` TUI (primary REPL); `eve dev --no-ui` + `POST /eve/v1/session` for scripted checks; `eve dev <preview-url>` to attach the TUI to a Vercel preview deployment — this is the key trick for testing deployed agents interactively.
   - **Evals against deployments**: `eve eval --url <deployment> --strict` (auth via Vercel OIDC / `EVE_EVAL_AUTH_TOKEN` / `VERCEL_AUTOMATION_BYPASS_SECRET`).
   - **GitHub channel**: deterministic evals send synthetic `<github_context>` turns (exemplar already does this); for end-to-end, the 0.16.1+ headerless-payload support means Vercel-Connect-forwarded webhooks work against previews — documented recipe.
   - **Slack/Linear channels**: local recipe via `@vercel/connect` credentials + tunneled webhooks; documented step-by-step with the pieces harvested from the deleted apps.
   - **Schedules**: never wait for cron — evals call `t.target.dispatchSchedule(id)`; manual runs via the TUI.
5. **Acceptance criteria**: `pnpm turbo run test eval:ci` green with no env vars set; JUnit XML lands in `.eve/` and is picked up by CI; `docs/testing.md` walks each surface end-to-end.

## 7. Phase 5 — Exemplar app polish (size: S)

`apps/code-reviewer` becomes the living reference every generator template mirrors:

1. Align deps to catalog (`@vercel/connect` → 0.2.7 with the rest).
2. Restructure evals into `deterministic/` (new, `mockModel`-driven: "posts a review with inline comment when the fixture model calls `submit_pr_review`") and `live/` (the two existing evals, tags updated).
3. Add `tests/review-rate-limit.test.ts` (vitest) and `agent/lib/env.ts` (typed env pattern).
4. Add `.env.example`, app `AGENTS.md`; trim `turbo.json` per §5; README updated to link `docs/` instead of restating conventions.
5. Adopt 0.17+ guardrails in `agent.ts`: explicit `limits.maxInputTokensPerSession`, and `reasoning` where the chosen model supports it. Revisit the model choice (`zai/glm-5.2` today) — default the template line to `anthropic/claude-sonnet-5` to match eve's scaffold default and document how to change it.
6. **Acceptance criteria**: exemplar passes all three test tiers; a diff of exemplar vs. generator output shows only intentional, content-level differences (this comparison itself becomes a CI assertion if cheap enough — else a documented manual check).

## 8. Phase 6 — AI-agent maintainability layer (size: M) — *the differentiating phase*

1. **Rewrite `AGENTS.md`** (root, ≤ ~120 lines, imperative, no prose fluff):
   - Repo map (5 lines), the golden commands (`pnpm agent:new`, `pnpm verify`, `pnpm --filter <app> dev/eval`), and the rule that eve docs live at `node_modules/eve/docs/` and MUST be read before writing eve code (kept from today).
   - Hard rules: never edit versions in an app's `package.json` (catalog only); never import across `apps/*`; env vars must use the app prefix; new agents only via the generator; run `pnpm verify` before finishing any task.
   - Pointers into `docs/*.md` playbooks for anything longer.
   - Per-app `AGENTS.md` (generated) covers only app-specific context: what the agent does, its env vars, its surfaces, how to run just it. `CLAUDE.md` remains `@AGENTS.md`; add `.cursor/rules/eve-agents.mdc` with the same deferral so all three ecosystems read one file.
2. **`pnpm verify`** — the single deterministic loop: `turbo run lint typecheck build test eval:ci` (secrets-free by construction, §6). This is the command every AI agent runs to self-check; CI runs exactly the same thing, so "green locally" ≡ "green in CI".
3. **Lint/format: Biome** (adopt: third-party). One binary, one `biome.json`, fast enough to run repo-wide in <2s, deterministic output — ideal for AI agents (no plugin resolution, no config sprawl). `lint` task per app + root `pnpm format`. *Evaluated alternative*: ESLint+Prettier — richer rule ecosystem, but nothing here needs framework-specific rules, and two tools + plugin graphs are exactly the kind of drift surface this template is trying to remove.
4. **Boundary enforcement**: adopt Turborepo **Boundaries** (`turbo boundaries`, tags in each app's `turbo.json`) to fail CI when an app imports from another app or from an undeclared dependency. It's experimental but zero-cost to add and precisely targets the failure mode AI agents introduce most often (reaching across the tree). Fallback if it proves unstable: a 30-line custom import-path check in the lint step.
5. **Eve docs skill** (`.agents/skills/eve/SKILL.md`): a router document — "for channels read `node_modules/eve/docs/channels/<x>.mdx`, for evals read `docs/evals/*`, …" with a one-paragraph summary per area, so coding agents load the right doc instead of grepping 80 files. Register it in `skills-lock.json` beside the existing turborepo skill. Add a note in `AGENTS.md` that after any eve version bump, this skill's index must be re-validated against `node_modules/eve/docs/meta.json` (cheap, and the scaffold-drift job can assert the referenced paths still exist).
6. **Dependency automation**: Renovate config — group `eve` + `ai` + `@ai-sdk/*` into one weekly "eve stack" PR (catalog edits only), everything else monthly; CI (`pnpm verify` + live evals on the eve-stack group) is the merge gate. This is how the template stays current without a human babysitting versions.
7. **Docs set** (`docs/`): `adding-an-agent.md`, `testing.md`, `deployment.md`, `conventions.md`, `troubleshooting.md` — each written as a numbered playbook an AI agent can execute verbatim. `troubleshooting.md` seeds with the real failures hit during this migration (Node <24 install failure, eval-API rename, `.eve` cache confusion, port conflicts with `eve dev` reconnection state).
8. **Acceptance criteria**: a fresh Claude Code/Cursor session, given only "add a new agent that does X on Slack", can complete the task using `AGENTS.md` + generator + `pnpm verify` without reading any source of a sibling app — dry-run this as a real test before calling the phase done.

## 9. Phase 7 — CI/CD & deployment (size: M)

1. **`ci.yml`** (every PR + main):
   - `pnpm/action-setup` (version from `packageManager`), `actions/setup-node@v4` with `node-version-file: .nvmrc`, pnpm store cache.
   - `pnpm install --frozen-lockfile`, then `pnpm turbo run lint typecheck build test eval:ci --affected --continue` (PRs run only affected packages; main runs everything). Turbo remote cache via `TURBO_TOKEN`/`TURBO_TEAM`.
   - JUnit upload from `eve eval --junit` for PR annotation.
2. **`evals-live.yml`**: nightly cron + `workflow_dispatch`; matrix over apps; `eve eval --tag live --strict --junit` with `AI_GATEWAY_API_KEY` secret; uploads artifacts; failure opens/updates a tracking issue rather than blocking merges.
3. **`scaffold-drift.yml`**: weekly, per §4.3.
4. **Vercel deployment (Vercel-first)**, documented in `docs/deployment.md`:
   - One Vercel project per app, **Root Directory = `apps/<name>`**; eve's Vercel build path emits `.vercel/output` natively — no adapter work.
   - First-time setup per app: `pnpm --filter <app> exec eve link` (creates/links project, pulls AI Gateway credentials), then `eve deploy` or Git-integration auto-deploys.
   - **`turbo-ignore`** as each project's Ignored Build Step so an unrelated app's commit doesn't trigger a rebuild/deploy.
   - Env management: `vercel env pull` per app into `.env.local`; `.env.example` is the contract, Vercel is the store.
   - Production checklist (from eve docs, made concrete): replace `placeholderAuth()`, set provider/gateway credentials, smoke-test `/eve/v1/health` + session + stream routes post-deploy — scripted as `scripts/smoke.mjs <url>` (tiny custom script, ~40 lines).
5. **Acceptance criteria**: PR touching only `docs/` runs no build/eval tasks (affected-filtering works); PR touching exemplar runs its full tier-1/2 suite in < ~5 min warm-cache; preview deploy of the exemplar reachable and `eve dev <preview-url>` attaches.

## 10. Phase 8 — Cleanup & template finalization (size: S)

1. Delete `scripts/create-agent.mjs`, this `PLAN.md`, and any harvested-app remnants; final `pnpm dedupe`; confirm the `ai` override removal (per §3.3).
2. Root `README.md` rewrite: what this template is, 5-minute quickstart (`use this template` → `pnpm install` → `pnpm agent:new` → `pnpm --filter <new> dev`), link map into `docs/`.
3. Mark the GitHub repo as a **Template repository**; verify `pnpm dlx degit`/"Use this template" flows produce a working clone (no absolute paths, no committed `.vercel`, no lockfile assumptions broken).
4. Fresh-clone end-to-end test on a clean machine/container: Node 24 + pnpm only → quickstart → green `pnpm verify` → generator round-trip → exemplar deploys to a scratch Vercel project. This test is the definition of done for the whole effort.

---

## 11. Build vs. adopt — summary of tooling decisions

| Concern | Decision | Why |
| --- | --- | --- |
| Monorepo tasks/caching | **Turborepo** (mandated) + Vercel Remote Cache | Native Vercel integration, `--affected`, `turbo-ignore` |
| Version single-sourcing | **pnpm catalogs** (native) | Makes version drift unrepresentable; beats syncpack-style linting |
| Scaffolding | **`turbo gen`** with checked-in templates | Diffable templates > runtime `eve init` wrapping; prompts for free |
| Scaffold freshness | **Custom** drift-check script (~100 LOC) | No off-the-shelf tool compares your template to upstream's scaffold |
| Lint/format | **Biome** | One deterministic binary; ideal for AI-agent workflows |
| Unit tests | **Vitest** | Standard, fast, zero-config for pure-TS libs |
| Agent behavior tests | **eve evals** (`mockModel` + tags + `--junit`) | First-party; exercises the real runtime and HTTP surface |
| Cross-app import guard | **Turborepo Boundaries** (fallback: 30-LOC custom check) | Targets the top AI-agent failure mode |
| Dependency updates | **Renovate** (grouped eve-stack PRs) | Catalog edits are one-line; live evals gate the merge |
| Deploy smoke test | **Custom** `scripts/smoke.mjs` (~40 LOC) | Three HTTP checks; a framework would be overkill |
| Versioning/changelogs (changesets etc.) | **Skip** | Private apps, nothing published; revisit if `packages/*` ever publishes |

## 12. Risks & mitigations

- **Eve moves fast (0.13→0.18 in weeks, pre-1.0).** Mitigation: catalogs (one-line bumps), Renovate grouping, scaffold-drift job, deterministic eval tier that catches runtime breakage without burning tokens.
- **`typescript@7.0.1-rc` and Boundaries are pre-stable.** Both are what eve's own scaffold/Turborepo ship today; each has a documented fallback (stable `tsc` 5.x works against the same tsconfig; custom import check).
- **`passThroughEnv: ["*"]` on dev/eval loosens env hygiene.** Accepted deliberately for non-cached tasks only; cached tasks stay strict, and typed `env.ts` modules surface missing vars explicitly.
- **`mockModel` fidelity** — deterministic evals can't catch prompt regressions. That's what the nightly live tier is for; the two tiers are complementary, not redundant.
- **Node 24-only** excludes some hosts. It's an eve hard requirement, not a template choice; documented prominently in README.

## 13. Suggested execution order & sizing

| Phase | Scope | Size | Depends on |
| --- | --- | --- | --- |
| 1 | Toolchain baseline, delete 4 apps | S | groundwork (done) |
| 2 | Catalogs + `turbo gen agent` + drift guard | M | 1 |
| 3 | Turbo pipeline + env strategy | S | 1 |
| 4 | Test tiers + `docs/testing.md` | M | 2, 3 |
| 5 | Exemplar polish | S | 2–4 |
| 6 | AI-maintainability layer | M | 2–5 |
| 7 | CI/CD + Vercel deployment docs | M | 3, 4 |
| 8 | Cleanup, README, template flag, E2E test | S | all |

Phases 2+3 and 6+7 pair naturally into single working sessions. Every phase ends with the repo fully green (`pnpm verify` once it exists; `turbo run typecheck build` before that), so work can pause safely at any phase boundary.
