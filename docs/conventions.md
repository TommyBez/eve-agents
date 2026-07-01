# Conventions

Repo-wide rules and the reference patterns to copy. The hard rules are summarized in [AGENTS.md](../AGENTS.md); this file is the why and the how.

## Naming

- **App names are kebab-case** (`code-reviewer`, `triage-bot`). The name is used verbatim as the package name, the directory (`apps/<name>`), the Vercel project, and — upper-snaked — the env prefix (`CODE_REVIEWER_*`).
- **In eve, identity comes from the file path.** You never write a `name`/`id` field: `agent/tools/get_weather.ts` is tool `get_weather`, `agent/skills/summarize.md` is skill `summarize`, `agent/connections/linear.ts` is connection `linear` (tools surfaced as `linear__<tool>`), `agent/schedules/billing/sweep.ts` is schedule `billing/sweep`. Rename the file and you rename the thing — treat file renames as breaking changes.
- The root agent takes its name from the app's `package.json` `name`.

## Env vars

- Every app-specific var is prefixed with the SCREAMING_SNAKE app name: `CODE_REVIEWER_RATE_LIMIT_ENABLED`, `TRIAGE_BOT_SLACK_CONNECT_UID`. This is what keeps the per-app `turbo.json` a one-line wildcard (`"env": ["CODE_REVIEWER_*"]`) and cache invalidation scoped to the right app.
- Shared platform vars keep their canonical names (`AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`, `GITHUB_APP_*`, `KV_REST_API_*`, …) — the channel/provider libraries read them by those names.
- `.env.example` lists every var the app reads, with placeholders. It is the contract; Vercel is the store ([deployment.md](./deployment.md#2-environment-variables)).
- Parse env **once**, in `agent/lib/env.ts`, into a typed config object, so misconfiguration fails loudly at boot instead of mid-session. Throw with an actionable message for required vars:

```ts title="agent/lib/env.ts"
const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. See .env.example.`);
  return value;
};

export const env = {
  slackConnectUid: required("TRIAGE_BOT_SLACK_CONNECT_UID"),
  maxBulkCount: Number.parseInt(process.env.TRIAGE_BOT_MAX_BULK_COUNT ?? "10", 10),
  rateLimitEnabled: process.env.TRIAGE_BOT_RATE_LIMIT_ENABLED !== "false",
};
```

## Imports

- Each app maps `#*` → `./agent/*` and `#evals/*` → `./evals/*` in its `package.json` `imports`. Use them for intra-app absolute imports; relative imports within a directory are fine.
- **Never import across `apps/*`.** Apps are self-contained deployables; reaching into a sibling app couples deploys and breaks the generator invariant.
- Workspace packages are imported as `@repo/<name>` and declared as `"@repo/<name>": "workspace:*"`.

## Dependency versions: the catalog

Every cross-app dependency version lives once, in the `catalog:` section of `pnpm-workspace.yaml`. Apps declare `"eve": "catalog:"`, `"zod": "catalog:"`, etc.

- Upgrading eve for the whole repo is a one-line diff in `pnpm-workspace.yaml` + `pnpm install`.
- Never write a version number in an app's `package.json`. If a dependency is genuinely app-specific (used by one app only), a direct version there is acceptable — move it to the catalog the moment a second app needs it.
- After an eve bump, re-validate `.agents/skills/eve/SKILL.md` against the new docs tree.

## When to extract a `packages/*` package

**Rule of 2+:** code stays inside the app that owns it until a second app needs it. Then extract to `packages/<name>` following the internal-package pattern `packages/typescript-config` establishes:

- `"name": "@repo/<name>"`, `"private": true`.
- **Just-in-time TypeScript:** export `.ts` source directly via `exports`; no build step — consuming apps compile it. Keep it dependency-light.
- Consumers declare `"@repo/<name>": "workspace:*"` (in `devDependencies` for types/config, `dependencies` for runtime code).
- Do not extract speculatively. Copy-paste once is cheaper than a wrong abstraction; extract on the second consumer.

## Channel auth and platform channels

Every app keeps the canonical auth stack in `agent/channels/eve.ts`:

```ts
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

export default eveChannel({
  auth: [
    localDev(),        // open on localhost for `eve dev`; ignored in production
    vercelOidc(),      // lets the eve TUI and Vercel deployments reach the deployed agent
    placeholderAuth(), // rejects production browser traffic — REPLACE before production
  ],
});
```

`placeholderAuth()` fails closed on purpose. Replace it with a real policy before production ([deployment.md](./deployment.md#3-production-checklist)).

Slack channels authenticate through Vercel Connect (`connectSlackCredentials(<connect-uid>)` — no bot token or signing secret in env). GitHub channels read `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET` / `GITHUB_APP_SLUG`. Linear channels read `LINEAR_AGENT_ACCESS_TOKEN` / `LINEAR_WEBHOOK_SECRET`. Setup recipes: [testing.md](./testing.md) and `node_modules/eve/docs/channels/`.

## Model choice

- Default new agents to `"anthropic/claude-sonnet-5"` — eve's own scaffold default. A string id routes through the Vercel AI Gateway (OIDC on Vercel, `AI_GATEWAY_API_KEY` elsewhere).
- To call a provider directly, install its AI SDK package and pass a model object (`anthropic("claude-…")`); note direct ids use hyphens while gateway ids use `provider/model.dot` form.
- Set cost/recursion guardrails explicitly on agents that see untrusted input:

```ts
import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
  reasoning: "medium", // when the model supports it
  limits: {
    maxInputTokensPerSession: 200_000,
  },
});
```

## MCP connections with approval gating

One file per connection under `agent/connections/`. Prefer an explicit `tools.allow` list, and write a custom approval policy so reads flow freely while writes gate on a human. Note `toolName` arrives qualified (`linear__save_issue`) and `toolInput` is untyped — normalize and read defensively. Trimmed from a production Linear agent:

```ts title="agent/connections/linear.ts"
import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

const READ_TOOLS = ["list_issues", "get_issue", "list_comments", "list_projects"] as const;
const WRITE_TOOLS = ["save_issue", "save_comment", "save_project"] as const;

const normalizeToolName = (toolName: string): string => toolName.split("__").at(-1) ?? toolName;

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Create a Vercel Connect connector and set the returned UID.`);
  }
  return value;
};

export default defineMcpClientConnection({
  url: "https://mcp.linear.app/mcp",
  description: "Linear workspace: read issues, comments, projects; create approved updates.",
  auth: connect(getRequiredEnv("MY_AGENT_LINEAR_CONNECT_UID")),
  tools: { allow: [...READ_TOOLS, ...WRITE_TOOLS] },
  approval: ({ toolName, toolInput }) => {
    const name = normalizeToolName(toolName);
    if (READ_TOOLS.includes(name as (typeof READ_TOOLS)[number])) return false; // no prompt
    if (name === "save_comment") return false; // low-risk write
    // Example input-sensitive gate: creating is fine, mutating existing issues asks.
    if (name === "save_issue") {
      const input = (toolInput ?? {}) as Record<string, unknown>;
      return typeof input.id === "string" && input.id.length > 0;
    }
    return true; // unknown/destructive writes always ask
  },
});
```

For blanket policies use `once()` / `always()` / `never()` from `eve/tools/approval` instead of a function. Full reference: `node_modules/eve/docs/connections/mcp.mdx`.

## Schedules

Two `defineSchedule` forms; every schedule provides `cron` plus exactly **one** of `markdown` or `run`. Cron is 5-field, evaluated in UTC on Vercel. `eve dev` never fires cron — dispatch manually while iterating ([testing.md](./testing.md#schedules)).

**Handler form** — when the output must be delivered to a channel, or arguments are computed at fire time. Hand off with `receive` and keep the task alive with `waitUntil`:

```ts title="agent/schedules/daily-triage-digest.ts"
import { defineSchedule } from "eve/schedules";
import slack from "../channels/slack.js";
import { env } from "../lib/env.js";

export default defineSchedule({
  cron: "0 7 * * 1-5",
  async run({ receive, waitUntil, appAuth }) {
    if (!env.triageChannelId) return;
    waitUntil(
      receive(slack, {
        auth: appAuth,
        target: { channelId: env.triageChannelId },
        message:
          "Run the daily triage digest in read-only mode. Highlight only issues that need attention, with concrete next steps.",
      }),
    );
  },
});
```

**Markdown form** — fire-and-forget task mode: the agent runs the prompt, may call tools, and the output is discarded. Task mode cannot park to wait for a human, so make the prompt self-sufficient, precise about tool usage, and idempotent on retry:

```ts title="agent/schedules/daily-digest.ts"
import { defineSchedule } from "eve/schedules";

export default defineSchedule({
  cron: "0 9 * * *",
  markdown: `Run the daily digest.

1. Scan the configured sources with scan_sources.
2. Compose the digest and call preview_digest_email to review recipients and content.
3. Send with send_digest_email using confirmSend=true and an idempotencyKey derived from
   today's date (digest-YYYY-MM-DD), so a retried step never duplicates the email.

If a required env var is missing, stop and report it. Never invent recipients or sources.`,
});
```

(A plain `.md` file with `cron` frontmatter is equivalent to the markdown form.) Full reference: `node_modules/eve/docs/schedules.mdx`.

## Formatting and linting

Biome, one config at the root (`biome.json`). `pnpm format` writes, `lint` tasks check. Don't add per-app lint configs or a second formatter.
