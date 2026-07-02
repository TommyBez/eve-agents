# The playground

`apps/playground` is a Next.js app that gives every registered agent a browser UI: a chat page at `/agents/<id>`, plus diagnostics and the event stream for that agent. It is a **non-agent** app in `apps/` (a sanctioned exception to the "new apps only via `pnpm agent:new`" rule, alongside `apps/docs`) — everything else about it is ordinary workspace code.

## The config is the source of truth

`apps/playground/agents.config.json` decides what the playground shows. Registration is always explicit — there is **no auto-discovery** of `apps/*`. Each entry:

```json
{
  "$schema": "./agents.config.schema.json",
  "agents": [
    {
      "id": "code-reviewer",
      "title": "Code Reviewer",
      "description": "Reviews GitHub pull requests",
      "target": { "kind": "local", "port": 2000 },
      "enabled": true
    }
  ]
}
```

- `id` — URL-safe identifier; the chat page is `/agents/<id>`. For local targets it must match the app directory under `apps/`.
- `target` — either `{ "kind": "local", "port": <n> }` (an `eve dev`/`eve start` server on this machine, started for you by `pnpm playground:dev`) or `{ "kind": "url", "url": "https://...", "authHeaderEnv": "PLAYGROUND_<ID>_AUTH" }` for an agent deployed elsewhere.
- `enabled: false` keeps the entry listed but stops the playground from proxying to it (and `playground:dev` from starting it).

Edit the file by hand if you like — but the supported way is the CLI below, which validates ports, keeps formatting stable, and harvests titles/descriptions.

## Registering agents: `pnpm playground:agents`

```bash
pnpm playground:agents add <app> --port <n|auto>   # register apps/<app> (local target)
pnpm playground:agents add <name> --url <url> [--auth-env <VAR>]   # external agent
pnpm playground:agents remove <app>
pnpm playground:agents list
```

- **Ports are never guessed.** For a new local entry, pass `--port <n>`, or `--port auto` to take the next free port (max of the registered local ports and 2000, plus one). Omitting `--port` errors with the taken ports and a suggestion.
- `add` is **idempotent**: adding an already-registered id updates it in place (only the fields you pass).
- Title defaults to the title-cased app name (`--title "..."` overrides); the description is harvested from the app's `package.json` `description` or the first paragraph of its `AGENTS.md`.
- `list` shows every entry, its target, whether it is enabled, and whether `apps/<id>` actually exists — entries whose app is gone are flagged as **dangling**; `remove` them or restore the app.

You rarely run `add` yourself: `pnpm agent:new` ends with a "Register this agent in the playground?" prompt, and `pnpm agent:add` registers by default (see [adding-an-agent.md](./adding-an-agent.md)).

## Running everything: `pnpm playground:dev`

The compose-like dev orchestrator. For every **enabled** entry with a **local** target whose `apps/<id>` exists, it spawns

```bash
pnpm --filter <id> exec eve dev --no-ui --port <port>
```

then starts the playground UI (`pnpm --filter playground dev`) last. Output is line-prefixed per process (`[code-reviewer]`, `[playground]`) in distinct colors; Ctrl-C tears the whole tree down (SIGINT/SIGTERM are forwarded to every child, with a SIGKILL escalation after 5s), and if any process dies early everything else is stopped and the command exits non-zero.

Flags:

- `--mock` — sets `EVE_MOCK_MODEL=1` for the agent processes, so the whole stack runs with **no API keys** (agents reply from the deterministic mock/fixtures, same as `eval:ci`). Perfect for poking at the playground UI itself.
- `--agents-only` — start only the agent processes, not the playground UI (useful when you run the Next.js app separately).

Skipped with a warning, never an error: disabled entries, `url`-kind targets (nothing to start locally), and dangling entries.

## External (`url`-kind) targets: proxy and credentials

For `{ "kind": "url", ... }` targets the playground proxies chat traffic server-side to the deployed agent. If the deployment requires auth (it should — see `docs/deployment.md` on replacing `placeholderAuth()`), set `authHeaderEnv` to the name of an env var and give the playground that var (e.g. in `apps/playground/.env.local`). Its value is the **full Authorization header value** (e.g. `Bearer xyz`), attached by the proxy on every request; it never reaches the browser. The conventional name is `PLAYGROUND_<CONSTANT_CASE_ID>_AUTH`, which `playground:agents add --url` defaults to (`--auth-env <VAR>` overrides) — and which the proxy always reads as a fallback even when `authHeaderEnv` is not set.

### Env-var target overrides

Every agent's base URL can be overridden per environment without touching the config: if `PLAYGROUND_<CONSTANT_CASE_ID>_URL` is set (a full base URL, e.g. `PLAYGROUND_CODE_REVIEWER_URL=https://code-reviewer.example.com`), it wins over the config `target`; otherwise the config target is used (`local` → `http://127.0.0.1:<port>`, `url` → the URL). An explicit override is always honored. Credentials follow the agent either way: `authHeaderEnv` if configured, else `PLAYGROUND_<CONSTANT_CASE_ID>_AUTH`. This is how a **deployed** playground reaches agents that are `kind: "local"` on dev machines.

## Deploying the playground

The playground is intended to be used locally **and** deployed. It is an ordinary Next.js app, so it gets its own Vercel project — it does not use eve's build output like the agent apps in [deployment.md](./deployment.md).

> ⚠️ **A deployed playground is a credential-bearing control plane.** It holds the Authorization header for every registered agent and will proxy chat traffic to all of them for anyone who can reach it. **Never deploy it open.** Enable [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection) (the recommended primary lock) and/or set `PLAYGROUND_BASIC_AUTH` — ideally both for production.

Setup:

1. Create a Vercel project for the repo with **Root Directory = `apps/playground`** (framework preset: Next.js).
2. Set the **Ignored Build Step** to `npx turbo-ignore` so commits touching only other apps do not redeploy the playground.
3. Set env vars in the Vercel project (`<ID>` is the CONSTANT_CASE agent id — `code-reviewer` → `CODE_REVIEWER`):

   | Var | Meaning |
   | --- | --- |
   | `PLAYGROUND_<ID>_URL` | Full base URL where **this deployment** reaches agent `<id>`. Overrides the config target; required for agents whose config target is `kind: "local"`. |
   | `PLAYGROUND_<ID>_AUTH` (or the var named by `authHeaderEnv`) | Full Authorization header value the proxy attaches for that agent. |
   | `PLAYGROUND_BASIC_AUTH` | Opt-in `user:password`. When set, **every** route — pages and `/api/agents/*` — requires HTTP Basic auth; when unset, the app is open (fine locally, never fine deployed without Deployment Protection). |

Semantics of the **"not available in this deployment"** state: when the playground runs on Vercel and an agent — with no `PLAYGROUND_<ID>_URL` override — resolves to a loopback address (i.e. a `kind: "local"` dev target), the playground marks it *unavailable* rather than pretending it is failing. The home card and sidebar show a neutral state naming the env var to set, health polling skips the agent (no red badge), and the proxy answers `503` with a JSON explanation. Locally nothing changes.

Note that `agents.config.json` is imported **at build time** (the roster is part of the deploy), so changing the config means redeploying; `next dev` hot-reloads it as before.

## Troubleshooting

- **An agent's card shows as unhealthy / chat fails** — the agent is not running on the configured port. Local targets are only alive while `pnpm playground:dev` (or a manual `eve dev --port <n>`) is running; check the port in `agents.config.json` matches, and check the `[<id>]`-prefixed output for a crash.
- **`playground not found — is apps/playground present?`** — `playground:agents`/`playground:dev` could not find `apps/playground/agents.config.json`. You are probably on a branch without the playground app.
- **`Port <n> is already taken by "<id>"`** — two entries may not share a local port; use the suggested port or `--port auto`.
- **`skipping <id> — apps/<id> does not exist (dangling entry)`** — the app was deleted or renamed after registration; `pnpm playground:agents remove <id>` or restore the app.
- **A registered agent starts but replies with errors about model credentials** — run with `--mock`, or give the agent an `AI_GATEWAY_API_KEY` in its `.env.local` (see [adding-an-agent.md](./adding-an-agent.md#4-env-setup)).
