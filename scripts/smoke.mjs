#!/usr/bin/env node
// Smoke-test an eve agent's /eve/v1 HTTP surface (docs/deployment.md §3).
//
//   node scripts/smoke.mjs <url> [--session] [--header "Name: value"]...
//
// Always probes GET /eve/v1/health (public, skips route auth). With
// --session it also starts a session (POST /eve/v1/session) and asserts the
// NDJSON stream (GET /eve/v1/session/:id/stream) starts responding; it does
// NOT wait for the turn to finish. Routes per eve docs: channels/eve.mdx.
// If VERCEL_AUTOMATION_BYPASS_SECRET is set it is sent as the
// x-vercel-protection-bypass header, so protected Vercel deployments work.
//
// Exit codes: 0 = all checks passed, 1 = a check failed, 2 = usage error.

const TOTAL_BUDGET_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const STREAM_FIRST_BYTES_MS = 10_000;

function parseArgs(argv) {
  const args = { headers: {}, session: false, url: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--session") {
      args.session = true;
    } else if (arg === "--header") {
      const raw = argv[++i] ?? "";
      const colon = raw.indexOf(":");
      if (colon < 1)
        throw new Error(`--header expects "Name: value", got "${raw}"`);
      args.headers[raw.slice(0, colon).trim()] = raw.slice(colon + 1).trim();
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown flag ${arg}`);
    } else if (args.url) {
      throw new Error(`unexpected extra argument ${arg}`);
    } else {
      args.url = arg;
    }
  }
  if (!args.url) throw new Error("missing <url>");
  return args;
}

let failed = false;
const pass = (label) => console.log(`✓ ${label}`);
const fail = (label, hint) => {
  failed = true;
  console.error(`✗ ${label}`);
  if (hint) console.error(`  hint: ${hint}`);
};

function hintFor(status) {
  if (status === 401 || status === 403) {
    return (
      "deployment protection or channel auth rejected the request; pass " +
      '--header "Name: value" or set VERCEL_AUTOMATION_BYPASS_SECRET — see docs/deployment.md'
    );
  }
  if (status === 404)
    return "route not found; pass the app's base URL without a path suffix";
  if (status >= 500) return "server error; check the deployment's runtime logs";
  return undefined;
}

async function checkHealth(base, headers) {
  const route = "GET /eve/v1/health";
  try {
    const res = await fetch(`${base}/eve/v1/health`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 200) pass(`${route} → 200`);
    else fail(`${route} → ${res.status} (expected 200)`, hintFor(res.status));
    return res.status === 200;
  } catch (error) {
    fail(
      `${route} → ${error.message}`,
      "is the server up and the URL reachable?",
    );
    return false;
  }
}

async function checkSession(base, headers) {
  const route = "POST /eve/v1/session";
  let sessionId;
  try {
    const res = await fetch(`${base}/eve/v1/session`, {
      body: JSON.stringify({
        message: "Smoke test: reply with the single word ok.",
      }),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    sessionId = body?.sessionId;
    if (res.ok && sessionId)
      pass(`${route} → ${res.status} (sessionId ${sessionId})`);
    else
      fail(
        `${route} → ${res.status}, sessionId ${sessionId ?? "missing"}`,
        hintFor(res.status),
      );
  } catch (error) {
    fail(`${route} → ${error.message}`, hintFor(undefined));
  }
  if (!sessionId) return;

  const streamRoute = `GET /eve/v1/session/${sessionId}/stream`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STREAM_FIRST_BYTES_MS);
  try {
    const res = await fetch(`${base}/eve/v1/session/${sessionId}/stream`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      fail(
        `${streamRoute} → ${res.status} (expected 200)`,
        hintFor(res.status),
      );
      return;
    }
    const { value } = await res.body.getReader().read();
    if (value?.length)
      pass(
        `${streamRoute} → ${res.status}, streaming (${value.length} first bytes)`,
      );
    else
      fail(`${streamRoute} → ${res.status} but the stream ended without data`);
  } catch {
    fail(`${streamRoute} → no bytes within ${STREAM_FIRST_BYTES_MS / 1000}s`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(
      'Usage: node scripts/smoke.mjs <url> [--session] [--header "Name: value"]...',
    );
    process.exit(2);
  }
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass && !args.headers["x-vercel-protection-bypass"]) {
    args.headers["x-vercel-protection-bypass"] = bypass;
  }
  const guard = setTimeout(() => {
    console.error(
      `✗ smoke test exceeded the ${TOTAL_BUDGET_MS / 1000}s total budget`,
    );
    process.exit(1);
  }, TOTAL_BUDGET_MS);
  guard.unref();

  const base = args.url.replace(/\/+$/, "");
  const healthy = await checkHealth(base, args.headers);
  if (args.session) {
    if (healthy) await checkSession(base, args.headers);
    else console.error("- session checks skipped (health check failed)");
  }
  process.exit(failed ? 1 : 0);
}

main();
