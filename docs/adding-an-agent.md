# Adding an agent

End-to-end playbook: scaffold, implement, run, test, verify, deploy. New agents are created **only** through the generator — never by copying an existing app or running `eve init` inside this repo.

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
