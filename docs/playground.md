# The playground

`apps/playground` is a Next.js app that gives every registered agent a browser UI: a chat page at `/agents/<id>`, plus diagnostics and the event stream for that agent. It is the one **non-agent** app in `apps/` (the sanctioned exception to the "new apps only via `pnpm agent:new`" rule) — everything else about it is ordinary workspace code.

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

For `{ "kind": "url", ... }` targets the playground proxies chat traffic server-side to the deployed agent. If the deployment requires auth (it should — see `docs/deployment.md` on replacing `placeholderAuth()`), set `authHeaderEnv` to the name of an env var and give the playground that var (e.g. in `apps/playground/.env.local`). Its value is the **full Authorization header value** (e.g. `Bearer xyz`), attached by the proxy on every request; it never reaches the browser. The conventional name is `PLAYGROUND_<SCREAMING_SNAKE_ID>_AUTH`, which `playground:agents add --url` defaults to (`--auth-env <VAR>` overrides).

## Troubleshooting

- **An agent's card shows as unhealthy / chat fails** — the agent is not running on the configured port. Local targets are only alive while `pnpm playground:dev` (or a manual `eve dev --port <n>`) is running; check the port in `agents.config.json` matches, and check the `[<id>]`-prefixed output for a crash.
- **`playground not found — is apps/playground present?`** — `playground:agents`/`playground:dev` could not find `apps/playground/agents.config.json`. You are probably on a branch without the playground app.
- **`Port <n> is already taken by "<id>"`** — two entries may not share a local port; use the suggested port or `--port auto`.
- **`skipping <id> — apps/<id> does not exist (dangling entry)`** — the app was deleted or renamed after registration; `pnpm playground:agents remove <id>` or restore the app.
- **A registered agent starts but replies with errors about model credentials** — run with `--mock`, or give the agent an `AI_GATEWAY_API_KEY` in its `.env.local` (see [adding-an-agent.md](./adding-an-agent.md#4-env-setup)).
