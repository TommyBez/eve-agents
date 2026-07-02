# Adding an agent

End-to-end playbook: scaffold, implement, run, test, verify, deploy. New agents are created **only** through the generator — never by copying an existing app or running `eve init` inside this repo.

## Start from a registry agent (evex.sh)

Instead of starting from the blank scaffold, install a published agent from the [evex.sh](https://evex.sh) registry:

```bash
pnpm agent:add @evex/<item> [name] [--yes] [--no-env-prefix]
# e.g.
pnpm agent:add @evex/x-hot-topic-digest
pnpm agent:add postgres-data-analyst my-analyst   # bare names default to @evex
pnpm agent:add --from-file ./item.json            # offline/private registry-item JSON
```

`agent:add` runs `agent:new` under the hood (so the app keeps the repo's standard shape), then layers the registry item on top. What it does beyond `agent:new`:

- **Overlay** — the item's files (instructions, tools, channels, skills, evals, …) are written into `apps/<name>`, replacing scaffold files on collision. `package.json` / `tsconfig.json` / `turbo.json` are never overwritten by the registry.
- **Dependency mapping** — the item's dependencies are merged into the app's `package.json`: packages managed by the pnpm catalog become `"catalog:"`, everything else keeps the item's range (app-specific deps are fine, per `docs/conventions.md`). Untyped deps get a matching `@types/<pkg>` devDependency when one exists.
- **evalModel rewiring** — registry items ship a plain `model: "provider/model"`; `agent:add` rewrites it to the `evalModel({ mock, production })` pattern from `apps/code-reviewer/agent/agent.ts` so the `ci`-tagged smoke eval (and `pnpm verify`) stays deterministic and secret-free. If no safe `model:` anchor is found, the scaffold's already-wired `agent.ts` is kept and the registry version is saved as `agent/agent.ts.registry` with a printed TODO for manual merging.
- **Auto env contract** — every env var the overlaid code reads but `.env.example` misses is appended under a `# From <item>` header, keeping `pnpm check:env-contract` green. Fill in real values before running live.
- **Env-prefix enforcement (on by default)** — app-specific env vars in the item are renamed to the `<APP>_` prefix required by AGENTS.md rule 3, consistently across all overlaid files (code, `.env.example`, docs). Detected legacy prefixes are replaced rather than double-prefixed (`DATA_ANALYST_DATABASE_URL` → `POSTGRES_DATA_ANALYST_DATABASE_URL`); everything else gets the prefix prepended (`RESEND_API_KEY` → `X_HOT_TOPIC_DIGEST_RESEND_API_KEY`). Shared platform vars (`AI_GATEWAY_API_KEY`, `GITHUB_*`, `SLACK_*`, `LINEAR_*`, `KV_REST_API_*`, …) keep their canonical names. The summary prints an old → new rename table — use it when copying values into `.env.local`. Pass `--no-env-prefix` to keep the item's names as authored (e.g. when sharing an env with a deployment of the original item).
- **Repo-convention fixes** — extensionless relative imports get `.js` added (nodenext resolution), unused exports are stripped (knip), and everything is Biome-formatted. It finishes by running lint + typecheck + eval:ci for the new app.

**Heed the eve-version warning.** Registry items declare the eve version they were authored against (e.g. `eve@^0.15.1`). When that range does not overlap the workspace catalog's version, `agent:add` prints a prominent warning: the app still installs against the catalog version, but eve is pre-1.0 and APIs move — review the item's code against the bundled docs (`apps/<name>/node_modules/eve/docs/`) before shipping. The same warning applies to any other catalog-managed dependency (e.g. zod).

The item's own evals are installed untagged: they run with `pnpm --filter <name> eval` (live model, needs keys), never in the `ci` tier.

## 1. Scaffold

Interactive (prompts for name, description, and primary surface):

```bash
pnpm agent:new
```

Non-interactive, for scripts and CI (`--args` passes answers positionally, in prompt order):

```bash
pnpm agent:new -- --args <name> "<description>" <surface>
# e.g.
pnpm agent:new -- --args triage-bot "Triages inbound support issues" slack
```

- `<name>` is kebab-case (`triage-bot`); it becomes the package name, the directory `apps/<name>`, and the env prefix (`TRIAGE_BOT_*`).
- `<surface>` is one of `http-only`, `slack`, `github`, `scheduled`.
- The authoritative prompt list lives in `turbo/generators/config.ts` — check it if the answers above don't line up.

Then wire the new app into the workspace and smoke-check it:

```bash
pnpm install
pnpm --filter <name> run eval:ci   # deterministic smoke eval — passes with no keys
```

## 2. What gets generated

```text
apps/<name>/
├── AGENTS.md              # app-specific context for coding agents
├── README.md
├── .env.example           # every env var the app reads, with placeholders
├── package.json           # catalog: deps only, standard scripts, #* imports map
├── tsconfig.json          # extends @repo/typescript-config/base.json
├── turbo.json             # extends "//"; per-app env wildcard on build
├── agent/
│   ├── agent.ts           # defineAgent({ model, limits }) + EVE_MOCK_MODEL fixture switch
│   ├── instructions.md    # system-prompt skeleton — fill this in first
│   ├── lib/env.ts         # typed env parsing
│   ├── channels/eve.ts    # localDev() + vercelOidc() + placeholderAuth()
│   └── channels/<surface>.ts   # slack/github surface; `scheduled` gets agent/schedules/example.ts
├── evals/
│   ├── evals.config.ts
│   └── deterministic/smoke.eval.ts   # mockModel fixture, tag "ci" — passes with no keys
└── tests/smoke.test.ts    # vitest unit test
```

Everything is deliberately identical in shape to `apps/code-reviewer/` — treat that app as the living reference.

## 3. Implement

1. Write `agent/instructions.md`. This is the always-on system prompt; be specific about scope, tone, and what the agent must never do.
2. Add tools under `agent/tools/`. The filename is the tool name the model sees (`agent/tools/get_weather.ts` → `get_weather`). Read `apps/<name>/node_modules/eve/docs/tools/overview.mdx` first; gate destructive tools on approval (`tools/human-in-the-loop.md`).
3. Add channels, connections, schedules, or skills as needed — route through `.agents/skills/eve/SKILL.md` to find the right doc before writing each one. Patterns for MCP connections, Slack channels, and schedules are in [conventions.md](./conventions.md).
4. Put pure logic in `agent/lib/` so it is unit-testable, including a typed `agent/lib/env.ts` that parses `process.env` (see [conventions.md](./conventions.md#env-vars)).

## 4. Env setup

```bash
cd apps/<name>
cp .env.example .env.local   # fill in real values
```

- `.env.example` is the contract: every var the app reads, with placeholder values. Keep it current when you add a var.
- App-specific vars use the app's SCREAMING_SNAKE prefix (`TRIAGE_BOT_*`).
- For model access the simplest local option is `AI_GATEWAY_API_KEY`; on a linked Vercel project, `eve link` pulls a credential into `.env.local` for you.
- The eve CLI loads `.env` / `.env.local` from the app root automatically.

## 5. Run it

```bash
pnpm --filter <name> dev
```

This boots the eve dev TUI — an interactive REPL against the real runtime. `pnpm --filter <name> info` prints what eve discovered (tools, channels, schedules, diagnostics); run it first whenever something looks off. For headless/scripted runs, see [testing.md](./testing.md#http-surface).

## 6. Write evals

Two tiers, both under `evals/`:

- **Deterministic** (`evals/deterministic/*.eval.ts`, tag `ci`): drive a `mockModel` fixture through eve's real runtime and assert on tool calls and replies. No API keys, runs on every PR. The generated smoke eval shows the pattern.
- **Live** (`evals/live/*.eval.ts`, tag `live`): the real model, real behavior. Needs `AI_GATEWAY_API_KEY`; runs nightly and on demand.

```bash
pnpm --filter <name> exec eve eval --tag ci --strict   # what CI runs (also: pnpm --filter <name> eval:ci)
pnpm --filter <name> exec eve eval --tag live --strict # live tier, needs a model credential
```

Authoring guidance, assertions, and per-surface recipes: [testing.md](./testing.md). Unit tests for `agent/lib/*` go in `tests/` (vitest).

## 7. Verify

```bash
pnpm verify
```

Runs `lint typecheck build test eval:ci` across the workspace, with no secrets required. This must be green before the task is done.

## 8. Deploy

One Vercel project per app, Root Directory `apps/<name>`. First time:

```bash
pnpm --filter <name> exec eve link
pnpm --filter <name> exec eve deploy
```

Full flow, `turbo-ignore`, env management, and the production checklist (including replacing `placeholderAuth()`): [deployment.md](./deployment.md).
