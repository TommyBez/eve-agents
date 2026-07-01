# code-reviewer

Reviews GitHub pull requests for concrete bugs, regressions, security issues,
and missing tests. Mention `@code-reviewer` on a PR and it publishes a GitHub
review with inline comments via the `submit_pr_review` tool.

Repo-wide conventions (catalog deps, verification loop, eve docs) live in the
root `AGENTS.md`. This file covers only what is specific to this app.

## Surfaces

- **GitHub channel** (`agent/channels/github.ts`): mention-driven PR reviews,
  webhook at `/eve/v1/github`, Upstash-backed rate limiting
  (`agent/lib/review-rate-limit.ts`).
- **eve HTTP channel** (`agent/channels/eve.ts`): `eve dev` TUI, evals, and
  the `/eve/v1/*` session API.

## Environment

All variables are listed with comments in `.env.example`. Typed access goes
through `agent/lib/env.ts` (`env()` / `requireEnv()`); never read
`process.env` directly in app code. `EVE_MOCK_MODEL=1` swaps the model for a
deterministic fixture (see `agent/agent.ts`) — tests and CI evals need no env.

## Commands (from the repo root)

```bash
pnpm --filter code-reviewer run dev        # local TUI / dev server
pnpm --filter code-reviewer run test       # vitest unit tests (tests/)
pnpm --filter code-reviewer run eval:ci    # deterministic evals, no API keys
pnpm --filter code-reviewer run eval       # all evals (live ones need AI_GATEWAY_API_KEY)
pnpm --filter code-reviewer run lint       # biome check
pnpm --filter code-reviewer run typecheck  # tsc
pnpm --filter code-reviewer run build      # eve build
```

Eval tiers: `evals/deterministic/` (tag `ci`, mock model, runs on every PR)
and `evals/live/` (tag `live`, real model, nightly / on demand).
