# Deployment

Vercel-first: **one Vercel project per app**, deployed with the eve CLI or Git integration. Self-hosting is documented at the bottom as an escape hatch.

## 1. First-time setup (per app)

1. Create/link the Vercel project from the app directory:

   ```bash
   pnpm --filter <app> exec eve link
   ```

   `eve link` links the directory to a Vercel project (interactive team/project picker) and pulls the project's environment so an AI Gateway credential (`VERCEL_OIDC_TOKEN` or `AI_GATEWAY_API_KEY`) lands in `.env.local`. It is interactive-only; in CI use `vercel link --project <name> --yes --non-interactive`.

2. In the Vercel project settings, set **Root Directory = `apps/<app>`**. eve emits the Vercel Build Output bundle (`.vercel/output`) natively when `VERCEL` is set — no adapter or framework config needed.

3. Set the **Ignored Build Step** to `npx turbo-ignore` so a commit touching only other apps does not rebuild/redeploy this one.

4. First deploy:

   ```bash
   pnpm --filter <app> exec eve deploy
   ```

   `eve deploy` runs `vercel deploy --prod`, installing dependencies first and pulling env vars after. Once the project is Git-connected, pushes deploy automatically (previews on branches, production on the default branch) and `eve deploy` is only needed for manual production pushes.

## 2. Environment variables

- Vercel is the store; `.env.example` is the contract. Every var the app reads is listed there with a placeholder.
- Set real values per environment in the Vercel project (Production / Preview / Development).
- Pull them locally per app:

  ```bash
  cd apps/<app>
  vercel env pull            # writes .env.local
  ```

- Model credential: on Vercel, a linked project authenticates gateway model ids (like `anthropic/claude-sonnet-5`) through Vercel OIDC — no provider key needed. Anywhere else, set `AI_GATEWAY_API_KEY`, or use a direct provider model + that provider's key (see [Self-hosting](#self-hosting-escape-hatch)).
- Secrets (webhook secrets, private keys, route-auth passwords) go only in the Vercel env / your secret manager — never in source, never in `turbo.json`.

## 3. Production checklist

Work through this before pointing real traffic (or a real GitHub App / Slack workspace) at the deployment:

- [ ] **Replace `placeholderAuth()`** in `agent/channels/eve.ts` with a real policy (`httpBasic()`, `jwtHmac()`, `jwtEcdsa()`, `oidc()`, `vercelOidc()`, or a custom `AuthFn`). The placeholder fails closed — production browser requests are rejected until you do. See `node_modules/eve/docs/guides/auth-and-route-protection.md`.
- [ ] All credentials set in the Vercel project: model access (OIDC/`AI_GATEWAY_API_KEY`), channel credentials (`GITHUB_APP_*`, connect UIDs, …), route-auth secrets, app-prefixed vars from `.env.example`.
- [ ] `pnpm verify` green, and the app's live evals pass (`eve eval --tag live --strict`).
- [ ] Smoke-test the live routes:

  ```bash
  curl https://<your-app>/eve/v1/health

  curl -X POST https://<your-app>/eve/v1/session \
    -H 'content-type: application/json' \
    -d '{"message":"Hello from production"}'
  # → { "sessionId": "…" }

  curl https://<your-app>/eve/v1/session/<sessionId>/stream
  ```

- [ ] Or smoke-test interactively — attach the TUI to the deployment:

  ```bash
  eve dev https://<your-app>
  ```

  (Set `VERCEL_AUTOMATION_BYPASS_SECRET` locally first if the deployment uses preview protection.)
- [ ] If the app has schedules: confirm the Cron Jobs appear under the Vercel project's **Settings → Cron Jobs**. Cron expressions evaluate in UTC.
- [ ] Point webhooks (GitHub App, Connect triggers) at the production URL and confirm a delivery succeeds.

Evals can also run against the deployment as a post-deploy gate: `eve eval --tag live --strict --url https://<your-app>` — auth options in [testing.md](./testing.md#evals-against-deployments).

## Self-hosting (escape hatch)

eve also runs as a plain Node service:

```bash
pnpm --filter <app> exec eve build
PORT=3000 pnpm --filter <app> exec eve start --host 0.0.0.0
```

`eve build` writes standard Nitro output under `.output/`; `eve start` serves it and respects `PORT`/`--port`. Non-negotiables when you leave Vercel:

- **Workflow state persistence.** The default local workflow world stores run state under `.workflow-data` — put that directory on persistent storage, or select another world (e.g. `@workflow/world-postgres`) via `experimental.workflow.world` in `agent/agent.ts`, pinned to the same `@workflow/*` line as the eve release.
- **Model credential.** Set `AI_GATEWAY_API_KEY` for gateway-routed string model ids, or install the provider's AI SDK package (`@ai-sdk/anthropic`, `@ai-sdk/openai`, …), pass a provider model object in `agent.ts`, and set `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
- **Auth.** Do not rely on `vercelOidc()`; use Basic auth, JWT/OIDC for your identity provider, or a custom verifier.
- **Proxying.** Forward **both** `/eve/` and `/.well-known/workflow/` prefixes. A proxy restricted to `/eve/` lets sessions start but silently stalls runs — workflow callbacks land on `/.well-known/workflow/v1/flow`.
- **Schedules** fire via Nitro's schedule runner, which `eve start` runs. A custom HTTP-only host must run Nitro scheduled tasks or trigger the work from its own scheduler.
- **Sandbox.** Keep `defaultBackend()` (picks a local backend off-Vercel) or pin Docker/microsandbox; don't pin `vercel()`.

Full checklist: `apps/<app>/node_modules/eve/docs/guides/deployment.md`.
