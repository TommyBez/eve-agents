# playground

A Next.js web chat + diagnostics control-plane for the eve agents in this
repo (and any deployed eve agent you point it at). It is **not an eve agent**:
this is the one non-eve-agent app under `apps/`, an accepted exception to hard
rule 4 (`pnpm agent:new`) — it was not scaffolded by the generator and has no
`agent/` directory, evals, or eve build. It is a *client* of many agents, so
it deliberately does not use `withEve` from `eve/next`.

## What it does

- `/` — one card per configured agent with a live health badge
  (`/eve/v1/health` polled through the proxy, with latency).
- `/agents/[id]` — three tabs that share one chat session:
  - **Chat**: streaming conversation via `useEveAgent` (markdown, reasoning,
    tool calls with human-in-the-loop approval buttons, authorization parts).
  - **Diagnostics**: the agent's `/eve/v1/info` payload (model, tools, skills,
    channels, schedules, discovery problems, instructions), fetched
    server-side with the proxy's credentials.
  - **Events**: the raw eve stream events of the current session, filterable
    and expandable.

## Run it

```bash
pnpm --filter playground dev     # http://localhost:3000
pnpm --filter playground build && pnpm --filter playground start
```

Point it at a local agent by starting that agent on the configured port,
e.g. `pnpm --filter code-reviewer dev` (eve dev picks a port; use
`pnpm exec eve dev --port 2000` inside the app to match the config).

## Config contract: `agents.config.json`

The single source of truth for which agents exist. Zod-validated at load by
`lib/agents.ts`; an invalid config renders as an error card, never a crash.
`agents.config.schema.json` gives editors autocomplete.

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

- `target: { "kind": "local", "port": n }` → `http://127.0.0.1:<port>`. The
  `id` should match the app directory under `apps/*`; entries whose directory
  is missing render a "dangling" warning on the grid.
- `target: { "kind": "url", "url": "https://…", "authHeaderEnv": "PLAYGROUND_<ID>_AUTH" }`
  → a deployed agent. `authHeaderEnv` (optional) names a server-side env var
  holding the full `Authorization` header value the proxy attaches;
  `PLAYGROUND_<CONSTANT_CASE_ID>_AUTH` is always read as the fallback.
- `enabled` (optional, default `true`): disabled agents are listed but not
  proxied.
- Per agent, a `PLAYGROUND_<CONSTANT_CASE_ID>_URL` env var (full base URL)
  overrides the config target — resolution order is env var → config. That is
  how a deployed playground reaches `kind: "local"` agents.
- The config is a **build-time static import** (`lib/agents.ts`): changing it
  requires a rebuild/redeploy; `next dev` hot-reloads it.

## Proxy architecture

eve channels emit no CORS headers (OPTIONS 404s), so the browser can never
call an agent origin directly. Everything goes through the same-origin
catch-all route handler:

```
browser ── useEveAgent({ host: "/api/agents/<id>" })
        ──► app/api/agents/[agent]/[...path]/route.ts
        ──► <agent baseUrl>/eve/v1/…   (+ server-held Authorization header)
```

The proxy forwards GET/POST, streams response bodies through (NDJSON event
streams included), only forwards `/eve/*` paths, and 404s ids that are not
enabled in the config. Agent URLs and credentials never reach the browser —
there are intentionally **no `NEXT_PUBLIC_*` vars** in this app.

## Env vars

None are required locally. All are server-side only (see `.env.example`):

- `PLAYGROUND_<CONSTANT_CASE_ID>_URL` — per-agent base-URL override
  (beats the config target). Required on a deployed playground for agents
  whose config target is `kind: "local"`.
- `PLAYGROUND_<CONSTANT_CASE_ID>_AUTH`, or the var named by `authHeaderEnv` —
  full Authorization header value the proxy attaches for that agent. Read via
  `process.env[name]` indirection (names derive from agent ids).
- `PLAYGROUND_BASIC_AUTH` — opt-in `user:password`; when set, `proxy.ts`
  gates every route (pages and `/api/agents/*`) behind HTTP Basic auth.
  Unset = no-op (local dev unaffected).

## Deployed

The playground also deploys (own Vercel project, Root Directory
`apps/playground` — see `docs/playground.md` § "Deploying the playground").
A deployed playground is a **credential-bearing control plane**: enable
Vercel Deployment Protection and/or `PLAYGROUND_BASIC_AUTH`, never deploy it
open. On Vercel, an agent with a loopback target and no `PLAYGROUND_<ID>_URL`
override renders as a neutral "not available in this deployment" state:
health polling skips it and the proxy answers 503 with a JSON explanation.

## Layout

- `app/` — routes (`page.tsx` grid, `agents/[id]/page.tsx` tabs,
  `api/agents/[agent]/[...path]/route.ts` proxy).
- `app/_components/` — playground-specific client components (chat, events
  inspector, health badge, tab shell).
- `components/ai-elements/`, `components/ui/` — vendored AI Elements + shadcn
  primitives copied from the eve 0.18 `--channel-web-nextjs` scaffold, already
  adapted to eve's approval states and streaming status.
- `lib/agents.ts` — config loader/validator and the single target/credential
  resolution point (env overrides, unavailable-in-deployment, dangling);
  `lib/info.ts` — server-side `/eve/v1/info` fetcher.
- `proxy.ts` — opt-in Basic-auth gate for deployed playgrounds (Next 16
  proxy file, the middleware.ts successor; no-op when
  `PLAYGROUND_BASIC_AUTH` is unset).
