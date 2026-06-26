# Supabase Data Analyst

An Eve-native Slack analyst for a single Supabase project. It answers Slack
mentions and DMs, inspects schema metadata, and runs bounded read-only SQL
through the Supabase MCP server. No custom Postgres tooling is included; every
database action goes through one MCP connection.

## What You Are Setting Up

This agent has two integration points. They are intentionally separate:

| Part | File | Runtime route or server | Credentials |
| --- | --- | --- | --- |
| Slack channel | `agent/channels/slack.ts` | `POST /eve/v1/slack` | Vercel Connect Slack UID in `SUPABASE_ANALYST_SLACK_CONNECT_UID` |
| Supabase MCP connection | `agent/connections/supabase.ts` | `https://mcp.supabase.com/mcp` | Vercel Connect Supabase OAuth UID in `SUPABASE_CONNECT_UID` |

The Slack channel is how users mention or DM the agent in Slack. The Supabase
MCP connection is how the agent inspects schema and executes SQL on the
configured Supabase project from any surface, including Slack.

Do not replace the Supabase MCP connection with custom `pg` tools for this
agent. The connection exposes the allowed Supabase MCP tools, scopes requests
to a single project, defaults to read-only mode, and applies the dynamic
approval policy in one place.

## Capabilities

- Slack mention and DM intake for ad-hoc analytics questions.
- Schema inspection through the Supabase MCP `list_tables`, `list_extensions`,
  and `list_migrations` tools.
- Read-only analytical SQL through the Supabase MCP `execute_sql` tool.
- One Supabase MCP connection with a read-only default and a write-tool
  approval gate. No custom Postgres tools are included.

## Prerequisites

- Node.js 24 or newer.
- An Eve deployment URL that Slack can reach over HTTPS.
- A Supabase project the agent should analyze. Use a development project or a
  project with non-production data; do not point this agent at production.
- Access to Vercel Connect for the Slack channel and the Supabase MCP OAuth
  connection.
- A Slack workspace where the agent app can be installed.

For local webhook testing, expose the local Eve server through a public HTTPS
tunnel and use that public URL in Slack.

## Install

Install this registry item into an existing Eve app:

```bash
npx shadcn@latest add @evex/supabase-data-analyst
```

Then install the public runtime dependencies listed by the registry item.

## Deploy Or Expose The Eve App

The Slack channel needs an HTTPS URL. Slack sends Connect-triggered Slack
events to `/eve/v1/slack`.

For production on Vercel, Eve's Slack channel docs use:

```bash
VERCEL_USE_EXPERIMENTAL_FRAMEWORKS=1 vercel deploy --prod
```

For local testing, expose the Eve dev server through a public HTTPS tunnel and
use that tunnel URL in Slack. Do not configure Slack with a plain `localhost`
URL.

## Start using it in Slack

This agent uses Eve's documented Slack channel path through Vercel Connect. Do
not create or manage `SLACK_BOT_TOKEN` or `SLACK_SIGNING_SECRET` variables.

Before connecting Slack, make sure the Eve app that installed this registry item
is deployed on Vercel or otherwise reachable through HTTPS. Slack events must be
able to reach the Eve Slack route:

```text
/eve/v1/slack
```

Create the Slack Connect client from the Vercel project used by the Eve app:

```bash
npm install -g vercel@latest
vercel connect create slack --triggers
```

This command is the Slack installation step. It creates the Vercel Connect
connector and opens the Slack authorization flow. Choose the Slack workspace
where the agent should live and approve the app installation there. If the CLI
prints an authorization URL instead of opening a browser, open that URL and
complete the Slack install.

After authorization succeeds, copy the UID printed by the command. Then attach
that Slack client to Eve's Slack route:

```bash
vercel connect detach <uid> --yes
vercel connect attach <uid> --triggers --trigger-path /eve/v1/slack --yes
```

Set the same UID in the Eve app environment and redeploy the app:

```env
SUPABASE_ANALYST_SLACK_CONNECT_UID=<uid>
```

The default UID used by the agent is `slack/supabase-data-analyst`.

After the app is deployed:

1. Open the same Slack workspace that you authorized during
   `vercel connect create slack --triggers`.
2. Find the Slack app that was installed during that authorization flow.
3. Add the app to every channel where it should answer.
4. In a channel, mention the app and ask a Supabase question.
5. In a DM, message the app directly.

Good first prompts:

```text
What tables can you see in the project?
```

```text
Show total signups by month for the last 6 months.
```

## Configure The Supabase MCP Connection

This setup is for reading Supabase data through MCP tools. It is separate from
the Slack Connect client.

The MCP connection is defined in `agent/connections/supabase.ts`:

```ts
defineMcpClientConnection({
  url: "https://mcp.supabase.com/mcp?project_ref=<ref>&read_only=true",
  auth: connect(getRequiredEnv("SUPABASE_CONNECT_UID")),
});
```

Create a Vercel Connect connector for Supabase OAuth:

```bash
vercel connect create supabase --name supabase-data-analyst --format=json
```

Then set the returned `uid`:

```bash
SUPABASE_CONNECT_UID=<uid returned by Vercel>
```

The first tool call that needs the Supabase MCP connection can trigger an Eve
authorization challenge. The user follows the sign-in URL, Vercel Connect
stores and refreshes the Supabase OAuth credential, and Eve retries the tool
call. The token is not shown to the model or serialized into conversation
history.

The connection allow-list is:

- read tools: `list_tables`, `list_extensions`, `list_migrations`,
  `execute_sql`, `get_logs`, `get_advisors`, `get_project_url`,
  `get_publishable_keys`, `generate_typescript_types`, `list_edge_functions`,
  `get_edge_function`, `search_docs`;
- write tools: `apply_migration`, `deploy_edge_function`. These require
  approval; the analyst flow never requests it, so they are effectively
  unavailable in normal analytics runs.

## Environment Variables

```env
SUPABASE_CONNECT_UID=<vercel connect supabase uid>
SUPABASE_ANALYST_SLACK_CONNECT_UID=slack/supabase-data-analyst
SUPABASE_ANALYST_MCP_URL=https://mcp.supabase.com/mcp
SUPABASE_ANALYST_PROJECT_REF=<project ref>
SUPABASE_ANALYST_READ_ONLY=true
SUPABASE_ANALYST_ALLOWED_SCHEMAS=public
SUPABASE_ANALYST_BLOCKED_TABLES=
SUPABASE_ANALYST_MAX_ROWS=200
```

Notes:

- `SUPABASE_CONNECT_UID` is the `uid` returned by
  `vercel connect create supabase`. It authorizes Supabase MCP reads.
- `SUPABASE_ANALYST_MCP_URL` defaults to `https://mcp.supabase.com/mcp`.
  Override it to point at a local Supabase CLI MCP server
  (`http://localhost:54321/mcp`) or a private gateway.
- `SUPABASE_ANALYST_PROJECT_REF` scopes the connection to one project. Leaving
  it empty enables account-level tools (`list_projects`, `list_organizations`)
  which are intentionally not in the allow-list.
- `SUPABASE_ANALYST_READ_ONLY` defaults to `true`. Set it to `false` only if
  the Supabase role you authorize should be able to write; the agent still
  never requests approval for write tools in normal analytics flow.
- `SUPABASE_ANALYST_BLOCKED_TABLES` accepts comma-separated table names such as
  `users,public.accounts`.

## Supabase project setup

Supabase MCP runs queries under the permissions of the OAuth-authenticated
user. To keep this agent read-only:

1. Use a dedicated Supabase project for analytics, or a development project
   with non-production data.
2. Prefer `SUPABASE_ANALYST_READ_ONLY=true` so the MCP server wraps every
   query in a read-only Postgres role.
3. Limit the OAuth user's role to the schemas the Slack audience is allowed to
   inspect. Keep `SUPABASE_ANALYST_ALLOWED_SCHEMAS` limited to those schemas.
4. Do not grant the OAuth user access to PII tables unless the Slack workspace
   and channel audience are allowed to see that data.

## Approval Policy

The approval policy is implemented on the single Supabase MCP connection.

No approval is required for:

- read tools, including `execute_sql` when `SUPABASE_ANALYST_READ_ONLY=true`;

Approval is required for:

- `apply_migration`;
- `deploy_edge_function`.

The analyst flow never requests write-tool approval, so write tools are
effectively unavailable unless an operator explicitly enables them through a
different surface.

## Smoke Tests

After deployment and env setup:

1. In Slack, mention the agent:

```text
@agent what tables can you see in the project?
```

Expected: if the caller has not authorized the Supabase MCP connection yet,
Eve surfaces a Supabase Connect authorization challenge. After authorization,
the agent calls `list_tables` through the Supabase MCP connection and replies
with the table list.

2. Ask a read-only analytics question:

```text
@agent show total signups by month for the last 6 months
```

Expected: the agent calls `execute_sql` with a read-only aggregate query and
replies with a concise summary.

## Troubleshooting

If Slack mentions do nothing, check that the Slack Connect client is attached
with `--triggers` and `--trigger-path /eve/v1/slack`, and that
`SUPABASE_ANALYST_SLACK_CONNECT_UID` matches the created connector UID.

If Slack-triggered Supabase reads fail with authorization required, complete
the Supabase MCP Connect sign-in flow for the caller. `SUPABASE_CONNECT_UID`
must match the Supabase Connect OAuth connector, not the Slack connector.

If `execute_sql` fails, confirm `SUPABASE_ANALYST_PROJECT_REF` points to the
intended project and that the OAuth user has access to it. Confirm
`SUPABASE_ANALYST_READ_ONLY=true` unless you intentionally granted write
access.

If schema inspection returns unexpected tables, narrow
`SUPABASE_ANALYST_ALLOWED_SCHEMAS` and add sensitive tables to
`SUPABASE_ANALYST_BLOCKED_TABLES`.

## Runtime contract

Read-only access can still expose sensitive data. Do not grant this agent
access to PII tables unless the Slack workspace and channel audience are
allowed to see that data.
