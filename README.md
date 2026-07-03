# evex-starter

A starter template for running a **fleet of [eve](https://www.npmjs.com/package/eve)-framework agents** in one Turborepo monorepo: one app per agent, one command to scaffold a new one, one command to verify everything, and Vercel-first deployment.

Built on **Turborepo 2 + pnpm 10 + eve 0.18**, and designed to be maintained by AI coding agents as much as by humans — conventions are checked in ([AGENTS.md](./AGENTS.md)), versions are single-sourced (pnpm catalog), and the whole verification loop runs without secrets.

## Requirements

- **Node 24** (eve hard-requires it; `engine-strict` makes installs fail fast on anything older)
- **pnpm 10** (pinned via `packageManager`; use `corepack enable`)

## 5-minute quickstart

```bash
# 1. Use this template (GitHub "Use this template", or degit), then:
nvm use              # Node 24, from .nvmrc
corepack enable
pnpm install

# 2. Scaffold an agent
pnpm agent:new       # prompts for name, description, surface
# …or start from a published agent on the evex.sh registry:
pnpm agent:add @evex/code-reviewer

# 3. Run it
pnpm --filter <name> dev    # interactive TUI REPL against the real runtime
pnpm playground:dev --mock  # …or chat with every registered agent in the browser, no keys needed (docs/playground.md)

# 4. Verify everything
pnpm verify          # lint + typecheck + build + test + deterministic evals — no secrets needed
pnpm fix             # auto-fix whatever lint/format complains about
```

From there: fill in `agent/instructions.md`, add tools, and follow [docs/adding-an-agent.md](./docs/adding-an-agent.md) end to end.

**Editor:** the repo ships [`.vscode/`](./.vscode) — Biome as the formatter (format on save), debug/launch configs for the playground and any agent's REPL, and the one recommended extension ([Biome](https://marketplace.visualstudio.com/items?itemName=biomejs.biome)) — so VS Code and Cursor are zero-config. `pnpm doctor` diagnoses everything else (Node/pnpm versions, install state, env files) with copy-paste fixes; `pnpm clean` resets all generated output when things get weird.

## Repo layout

```text
evex-starter/
├── AGENTS.md                    # canonical rules for AI coding agents (Claude, Cursor, Codex all read it)
├── docs/                        # executable playbooks (see below)
├── apps/
│   ├── code-reviewer/           # the exemplar agent — every new app mirrors its shape
│   │   ├── agent/               # agent.ts, instructions.md, channels/, tools/, skills/, lib/
│   │   ├── evals/               # deterministic/ (tag ci) + live/ (tag live)
│   │   └── tests/               # vitest unit tests
│   ├── docs/                    # the docs site (Next.js + Fumadocs) — renders docs/, README, AGENTS.md
│   └── playground/              # browser chat + diagnostics for every registered agent
├── packages/
│   └── typescript-config/       # @repo/typescript-config — shared tsconfig base
├── turbo/generators/            # `pnpm agent:new` scaffolder + templates
├── .agents/skills/              # skills for coding agents: turborepo + eve docs router
├── pnpm-workspace.yaml          # workspaces + catalog: the single source of dependency versions
└── turbo.json                   # task pipeline (build/dev/test/eval:ci/…)
```

## Testing, in brief

| Tier | What | Keys needed |
| --- | --- | --- |
| Unit tests (`tests/`) | vitest over `agent/lib/*` and tool logic | none |
| Deterministic evals (tag `ci`) | eve's real runtime on `mockModel` fixtures — runs on every PR via `pnpm verify` | none |
| Live evals (tag `live`) | real model, nightly + on demand | `AI_GATEWAY_API_KEY` |

Per-surface recipes (HTTP, GitHub, Slack, Linear, schedules, deployed targets): [docs/testing.md](./docs/testing.md).

## Docs

- [AGENTS.md](./AGENTS.md) — repo map, golden commands, hard rules. Start here.
- [docs/adding-an-agent.md](./docs/adding-an-agent.md) — generator → implement → env → dev → evals → verify → deploy.
- [docs/testing.md](./docs/testing.md) — the three tiers and every surface's test recipe.
- [docs/deployment.md](./docs/deployment.md) — Vercel-first flow (`eve link`/`eve deploy`, `turbo-ignore`, env), production checklist, self-hosting escape hatch.
- [docs/conventions.md](./docs/conventions.md) — naming, env prefixes, imports, the catalog, package extraction, channel auth, MCP + schedule patterns.
- [docs/troubleshooting.md](./docs/troubleshooting.md) — real failure modes and fixes.
- eve's own docs ship inside the package at `apps/<app>/node_modules/eve/docs/`; [.agents/skills/eve/SKILL.md](./.agents/skills/eve/SKILL.md) is the routed index into them.
- Prefer a browser? `pnpm --filter docs dev` serves all of the above as a searchable site (`apps/docs`, built on Fumadocs).
