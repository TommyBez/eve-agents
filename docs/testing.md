# Testing

Every agent is testable at three tiers, and every surface (HTTP, GitHub, Slack, Linear, schedules) has a recipe below. The canonical loop is `pnpm verify` — it runs tiers 1 and 2 across the workspace with **no secrets**.

## The three tiers

| Tier | Lives in | Tool | When it runs | Needs API keys? |
| --- | --- | --- | --- | --- |
| Unit tests | `apps/<app>/tests/` | vitest (`pnpm --filter <app> test`) | every PR, cached by turbo | no |
| Deterministic evals | `apps/<app>/evals/deterministic/`, tag `ci` | `eve eval --tag ci --strict` with a `mockModel` fixture | every PR (`pnpm verify`) | no |
| Live evals | `apps/<app>/evals/live/`, tag `live` | `eve eval --tag live --strict` against the real model | nightly + on demand | yes (`AI_GATEWAY_API_KEY`) |

- **Unit tests** cover pure logic in `agent/lib/*` and tool `execute` bodies — they are plain functions, import and call them. Reference: `apps/code-reviewer/tests/`.
- **Deterministic evals** exercise eve's real runtime — boot, channel routing, tool wiring, assertions — without a provider call. They are what makes `pnpm verify` runnable by anyone (human or coding agent) with zero setup.
- **Live evals** catch prompt and model regressions that a fixture can't. The two tiers are complementary, not redundant.

## How deterministic evals work

`mockModel` (from `eve/evals`) is a fixture model that replaces the provider call while keeping everything else real. It goes in the agent definition, so this repo's convention is an env switch in `agent/agent.ts`: when `EVE_MOCK_MODEL` is set, the app exports a `mockModel(...)` fixture instead of the real model, and the `eval:ci` script sets that variable. See `apps/code-reviewer/agent/agent.ts` for the wiring and `apps/code-reviewer/node_modules/eve/docs/evals/overview.mdx` ("Deterministic fixture models") for the API.

A fixture can be a static string, a callback over the conversation, or a scripted tool loop:

```ts
import { mockModel } from "eve/evals";

model: mockModel({
  respond: ({ toolResults }) =>
    toolResults.length === 0
      ? { toolCalls: [{ name: "submit_pr_review", input: { /* … */ } }] }
      : "Review submitted.",
});
```

Tag the eval `ci` and assert like any other eval:

```ts
import { defineEval } from "eve/evals";

export default defineEval({
  tags: ["ci"],
  async test(t) {
    await t.send("…");
    t.succeeded();
    t.calledTool("submit_pr_review");
  },
});
```

Run and report:

```bash
eve eval --tag ci --strict                    # what eval:ci / pnpm verify runs
eve eval --tag ci --strict --junit .eve/junit.xml   # CI adds JUnit output for annotations
```

`--strict` turns soft below-threshold assertions into failures. Run artifacts (per-eval event streams, `t.log` lines) land under `.eve/evals/<timestamp>/` — read those when an eval fails; the console output is intentionally terse.

Hard rule: nothing tagged `ci` may depend on a real model, network service, or secret.

## HTTP surface

The eve channel is the default HTTP session API — the same routes the TUI, evals, and `curl` all hit.

**Interactive:** `pnpm --filter <app> dev` boots the dev TUI. Chat, watch streaming, approve tool calls, answer HITL questions. `eve info` first when discovery looks wrong.

**Scripted / headless:** start the server without the UI and drive the routes directly:

```bash
pnpm --filter <app> exec eve dev --no-ui --port 3000
curl http://localhost:3000/eve/v1/health
curl -X POST http://localhost:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"Hello"}'
# → { "sessionId": "…" }; then attach to the stream:
curl http://localhost:3000/eve/v1/session/<sessionId>/stream
```

**Against a deployment:** attach the TUI to a preview or production URL — the key trick for smoke-testing deployed agents interactively:

```bash
eve dev https://<your-app>.vercel.app
eve dev https://user:pass@<host>          # HTTP Basic
eve dev https://<host> -H 'Authorization: Bearer <token>'  # custom headers
```

If the deployment has Vercel preview protection, set `VERCEL_AUTOMATION_BYPASS_SECRET` locally first, or let the TUI's `/vc:login` flow resolve a project-scoped OIDC token.

## Evals against deployments

The same eval files run against a remote target:

```bash
eve eval --tag live --strict --url https://<your-app>.vercel.app --junit .eve/junit.xml
```

Authentication, in order of preference:

- **Vercel OIDC** — eve resolves the project from `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` (or `.vercel/project.json`) and sends ambient credentials when the project matches.
- **`VERCEL_AUTOMATION_BYPASS_SECRET`** — sent as the Protection Bypass for Automation header when set.
- **`EVE_EVAL_AUTH_TOKEN`** — explicit bearer override for targets whose auth is not Vercel OIDC.

An arbitrary unmatched URL is called anonymously. Details: `node_modules/eve/docs/evals/targets.mdx`.

## GitHub channel

**Deterministic (every PR):** don't fake webhooks — send synthetic `<github_context>` turns through the normal eval session, the way the exemplar does (`apps/code-reviewer/evals/`):

```ts
await t.send(`
<github_context>
repository: example/widget
pull_request_number: 42
sender: maintainer
head_sha: abc123
</github_context>

Pull request diff:
…
Review this diff and publish the PR review with submit_pr_review.
`);
t.calledTool("submit_pr_review");
```

This exercises instructions, tools, and the review-shaped output without GitHub in the loop.

**End to end (against a deployment):** GitHub App webhooks must reach `/eve/v1/github` over public HTTPS, so end-to-end tests run against a deployment, not localhost:

1. Create a *test* GitHub App (separate from production) with its own `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET`, installed on a scratch repository.
2. Point its webhook URL at the preview deployment: `https://<preview>.vercel.app/eve/v1/github`, and set the matching env vars on the Vercel project's Preview environment.
3. Comment `@<bot-name>` on a PR in the scratch repo; use GitHub's **Recent Deliveries** page to inspect and *redeliver* payloads while iterating.
4. Watch the session with `eve dev <preview-url>`.

For truly local end-to-end runs, expose the local server through a tunnel and point the test app's webhook at the tunnel URL — GitHub cannot reach localhost. Note the local sandbox backend skips repository checkout; full checkout behavior needs a Vercel deployment. Setup details (permissions, events, common webhook failures): `apps/code-reviewer/README.md` and `node_modules/eve/docs/channels/github.mdx`.

## Slack channel

Slack credentials and webhook delivery run through **Vercel Connect** — there is no `SLACK_BOT_TOKEN` to manage, and Slack events are delivered to the Connect trigger destination attached to your Vercel project. That means end-to-end Slack testing happens against a deployment (preview or production), while behavior testing stays in evals.

One-time setup (from the app directory, linked to its Vercel project):

```bash
npm install -g vercel@latest && export FF_CONNECT_ENABLED=1
vercel connect create slack --triggers
vercel connect detach <uid> --yes
vercel connect attach <uid> --triggers --trigger-path /eve/v1/slack --yes
```

Channel file (this is the minimal harvested pattern; a fuller one with thread context is in [conventions.md](./conventions.md#channel-auth-and-platform-channels)):

```ts title="agent/channels/slack.ts"
import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

export default slackChannel({
  credentials: connectSlackCredentials(process.env.MY_AGENT_SLACK_CONNECT_UID ?? "slack/my-agent"),
});
```

Then deploy, mention the bot in the connected workspace, and watch the session with `eve dev <deployment-url>`. For pre-deploy behavior checks, drive the agent through evals with the Slack-shaped prompt and assert on tool calls — same idea as the GitHub `<github_context>` recipe. Full reference: `node_modules/eve/docs/channels/slack.mdx`.

## Linear channel

Same shape as Slack: the channel (`linearChannel` from `eve/channels/linear`) takes `LINEAR_AGENT_ACCESS_TOKEN` + `LINEAR_WEBHOOK_SECRET` credentials, and Linear must reach the deployment's webhook route, so end-to-end runs go against a preview. Behavior tests stay in evals. Reference: `node_modules/eve/docs/channels/linear.mdx`.

## Schedules

**Never wait for cron.** `eve dev` never fires schedules on their cadence; only deployed/`eve start` builds do.

In an eval, dispatch the schedule and attach to the sessions it creates:

```ts
import { defineEval } from "eve/evals";

export default defineEval({
  async test(t) {
    const { sessionIds } = await t.target.dispatchSchedule("heartbeat");
    await t.target.attachSession(sessionIds[0]!);
    t.succeeded();
    t.calledTool("send_report");
  },
});
```

`dispatchSchedule` uses the dev-only dispatch route, so it works against the local server `eve eval` boots (not production). While iterating manually:

```bash
curl -X POST http://localhost:3000/eve/v1/dev/schedules/heartbeat
# → { "scheduleId": "heartbeat", "sessionIds": ["…"] }
```

Then stream the returned session ids. Nested schedule names URL-encode the `/`. Reference: `node_modules/eve/docs/schedules.mdx`.

## CI mapping

- Every PR: `pnpm verify` (equivalently `turbo run lint typecheck build test eval:ci`) — tiers 1 and 2, no secrets, `--affected` on PRs.
- Nightly / manual: `eve eval --tag live --strict --junit` per app with `AI_GATEWAY_API_KEY`; JUnit XML uploaded as an artifact.
- Failure triage starts in `.eve/evals/<timestamp>/`.
