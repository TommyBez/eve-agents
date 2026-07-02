---
name: eve
description: |
  Router into the bundled eve-framework docs. Triggers on: eve, defineAgent, defineTool,
  defineEval, defineSchedule, defineChannel, defineMcpClientConnection, agent/ directory files
  (agent.ts, instructions.md, channels/, tools/, skills/, connections/, schedules/, sandbox/,
  subagents/, hooks/), evals/*.eval.ts, the eve CLI (eve dev, eve build, eve eval, eve deploy,
  eve link, eve info), mockModel, placeholderAuth, /eve/v1/* routes.

  Use when the user: writes or changes any eve agent code, authors evals, wires a channel
  (Slack/GitHub/Linear/custom), adds an MCP/OpenAPI connection, configures schedules or the
  sandbox, deploys an eve app, or debugs eve runtime/discovery behavior.
metadata:
  eve-version: 0.18.x
---

# eve Docs Router

eve bundles its complete docs **inside the installed package**, so they always match the installed version. Never answer from memory — resolve the docs path, then read the exact file for the topic.

## Resolve the docs path

In this pnpm workspace, `eve` is a per-app dependency; the docs live at:

```text
apps/<app>/node_modules/eve/docs/
```

(e.g. `apps/code-reviewer/node_modules/eve/docs/`). There is no `eve` in the root `node_modules`. All paths below are relative to that `docs/` directory. `docs/meta.json` (and the per-section `meta.json` files) hold the authoritative doc tree.

> **Maintenance rule:** after any eve version bump (a `catalog:` edit in `pnpm-workspace.yaml`), re-validate every path in this index against the new `docs/meta.json` — files move between releases. Update this file in the same change as the bump.

## Routed index

### Start here / core layout

- `introduction.mdx` — how an agent is laid out as files and what runs when a message arrives.
- `reference/project-layout.md` — **the naming rule** (identity comes from the file path; no `name` fields) and the full slot table for `agent/`. Read before adding any new file under `agent/`.
- `getting-started.mdx` — scaffold-to-running walkthrough (this repo uses `pnpm agent:new` instead of `eve init`).

### Agent config & instructions

- `agent-config.md` — `defineAgent`: `model` (gateway string id vs direct provider object), `reasoning`, `compaction`, `limits` (`maxInputTokensPerSession`, `maxOutputTokensPerSession`, `maxSubagentDepth`), `experimental.workflow.world`, `build.externalDependencies`.
- `instructions.mdx` — the always-on system prompt: `instructions.md`, `instructions.ts`, or an `instructions/` directory; static vs dynamic sources.

### Tools

- `tools/overview.mdx` — `defineTool`: typed inputs, `execute`, the runtime `ctx`, filename = tool name.
- `tools/human-in-the-loop.md` — approval gates (`once`/`always`/`never`/custom policies), `ask_question`, and the durable pause/resume contract.

### Channels

- `channels/overview.mdx` — the channel contract (normalize input, own the continuation token, decide delivery) and which channel to pick.
- `channels/eve.mdx` — the default HTTP API: `/eve/v1/health`, `/eve/v1/session`, streams, and the route-auth stack (`localDev`, `vercelOidc`, `placeholderAuth`, …).
- `channels/slack.mdx` — Slack via Vercel Connect (`connectSlackCredentials`), mentions/DMs, thread context, HITL buttons.
- `channels/github.mdx` — GitHub App webhooks at `/eve/v1/github`, @mention dispatch, PR diff context, sandbox checkout, CI-event hooks.
- `channels/linear.mdx` — Linear Agent Sessions.
- `channels/discord.mdx`, `channels/teams.mdx`, `channels/telegram.mdx`, `channels/twilio.mdx` — other platform channels.
- `channels/custom.mdx` — `defineChannel`: HTTP/WS routes, events map, `send`, continuation tokens, file uploads.

### Evals

- `evals/overview.mdx` — `defineEval`, the `t` context, **`mockModel` deterministic fixtures**, gate-vs-soft severity.
- `evals/cases.mdx` — single/multi-turn scripts and dataset fan-out.
- `evals/assertions.mdx` — `t.succeeded()`, `t.calledTool(...)`, `t.check(...)`, matchers, severity overrides.
- `evals/judge.mdx` — LLM-as-judge (`t.judge.autoevals.*`) and the judge model.
- `evals/targets.mdx` — local vs `--url` targets, remote auth (OIDC / `EVE_EVAL_AUTH_TOKEN` / `VERCEL_AUTOMATION_BYPASS_SECRET`), `t.target.dispatchSchedule`, `t.target.attachSession`, `t.target.fetch`.
- `evals/reporters.mdx` — Braintrust and JUnit output. `evals/running.mdx` — the `eve eval` CLI, exit codes, `.eve/evals/` artifacts, CI invocation.

### Schedules

- `schedules.mdx` — `defineSchedule`: cron (UTC on Vercel), markdown task mode vs `run` handler (`receive`/`waitUntil`/`appAuth`), the dev dispatch route (`POST /eve/v1/dev/schedules/:id`), Vercel Cron and self-hosted behavior.
- `patterns/dynamic-scheduling.md` — schedules whose targets/args are computed at runtime.

### Skills (agent-facing)

- `skills.mdx` — load-on-demand procedures under `agent/skills/` (flat markdown, module-backed, or packaged), pulled into context with `load_skill`. Not to be confused with this repo's `.agents/skills/` (which are for coding agents).

### Subagents

- `subagents.mdx` — local child agents under `agent/subagents/<id>/` with their own slots, plus self-delegation.
- `guides/remote-agents.md` — `defineRemoteAgent`: call another eve deployment as a subagent.

### Connections (MCP / OpenAPI)

- `connections/overview.mdx` — shared auth, headers, approval, per-caller patterns; tokens never reach the model.
- `connections/mcp.mdx` — `defineMcpClientConnection`, Vercel Connect OAuth (`connect(...)`), static tokens, `tools.allow`/`block`, per-tool approval policies.
- `connections/openapi.mdx` — generate one tool per OpenAPI operation.

### Sandbox

- `sandbox.mdx` — the isolated bash environment: built-in file tools, seeded `/workspace`, backends (`vercel()`, `defaultBackend()`, Docker/microsandbox), lifecycle, network policy.

### Deployment & operations

- `guides/deployment.md` — the production checklist: build output, env/secrets, model routing, sandbox backend, replacing `placeholderAuth()`, Vercel vs self-hosted (`.workflow-data`, proxy prefixes), smoke tests.
- `guides/auth-and-route-protection.md` — the ordered auth walk, verifier helpers, fail-closed guarantee, connection OAuth.
- `guides/instrumentation.md` — OpenTelemetry, run tags, `eve info` debugging, the common-failures table.
- `guides/dev-tui.md` — the `eve dev` terminal UI, slash commands, and attaching to remote deployments (`eve dev <url>`).
- `reference/cli.md` — every command and flag (`init`, `info`, `build`, `start`, `dev`, `link`, `deploy`, `eval`, `channels`).

### Client & frontend

- `guides/client/overview.mdx` — the TypeScript SDK (`Client`, sessions, auth, health); plus `messages`, `continuations`, `streaming`, `output-schema` in the same directory.
- `guides/frontend/overview.mdx` — browser chat with `useEveAgent`; framework guides in `guides/frontend/` (`nextjs`, `nuxt`, `sveltekit`, Svelte/Vue hooks).

### Concepts (read when behavior surprises you)

- `concepts/execution-model-and-durability.md` — durable sessions, checkpointed steps, parked work.
- `concepts/sessions-runs-and-streaming.md` — continuation tokens, the NDJSON event stream, reconnecting.
- `concepts/default-harness.md` — the built-in agent loop and default tools, and how to override them.
- `concepts/context-control.md` — what the model sees and when, across instructions/skills/workspace/subagents.
- `concepts/security-model.md` — trust boundaries, where secrets live, what fails closed.

### Everything else

- `reference/typescript-api.md` — every `define*` helper and its import path.
- `guides/hooks.md`, `guides/state.md`, `guides/session-context.md`, `guides/dynamic-capabilities.md` — runtime event subscribers, durable per-session state, `ctx` helpers, runtime-resolved capabilities.
- `patterns/` — multi-tenant memory/auth/approvals and dynamic scheduling.
- `tutorial/` — a full build-an-agent walkthrough (`first-agent` … `ship-it`).

Note: `reference/meta.json` lists an `http-api` page that is not shipped in the 0.18 package; the HTTP routes are covered in `channels/eve.mdx` and `guides/deployment.md`.
