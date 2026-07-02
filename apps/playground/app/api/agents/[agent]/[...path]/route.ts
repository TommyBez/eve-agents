import type { NextRequest } from "next/server";
import {
  findAgent,
  isUnavailableInDeployment,
  loadAgentsConfig,
  resolveAuthHeader,
  resolveBaseUrl,
  urlOverrideEnvName,
} from "@/lib/agents";

/**
 * Same-origin reverse proxy in front of every configured eve agent.
 *
 * eve channels emit no CORS headers (OPTIONS 404s), so the browser can never
 * talk to an agent directly. `useEveAgent({ host: "/api/agents/<id>" })`
 * sends everything here instead; we forward it to the agent's baseUrl and
 * stream the response body straight through (NDJSON event streams included).
 * Credentials stay server-side: the proxy attaches the Authorization header
 * from the env var named by `authHeaderEnv` in agents.config.json, or the
 * conventional PLAYGROUND_<ID>_AUTH.
 */

// Always resolve the config and stream at request time; never prerender.
export const dynamic = "force-dynamic";

type RouteContext = {
  readonly params: Promise<{ agent: string; path: string[] }>;
};

/** Request headers worth forwarding to the agent. */
const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "last-event-id"];

/** Response headers worth forwarding back to the browser. */
const FORWARDED_RESPONSE_HEADERS = ["content-type", "cache-control"];

export function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

async function proxy(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { agent: agentId, path } = await context.params;

  const config = loadAgentsConfig();
  if (!config.ok) {
    return Response.json({ ok: false, error: config.error }, { status: 500 });
  }

  const agent = findAgent(agentId);
  if (!agent?.enabled) {
    // Unknown ids and disabled agents look the same on purpose: this route
    // must never become a generic forwarder for arbitrary hosts.
    return Response.json(
      {
        ok: false,
        error: `No enabled agent "${agentId}" in agents.config.json`,
      },
      { status: 404 },
    );
  }

  // Only the eve API surface is proxied — nothing else on the agent origin.
  if (path[0] !== "eve") {
    return Response.json(
      { ok: false, error: "Only /eve/* paths are proxied" },
      { status: 404 },
    );
  }

  // A deployed playground cannot reach an agent that only exists on a dev
  // machine (loopback target, no env override). Say so instead of timing out.
  if (isUnavailableInDeployment(agent)) {
    return Response.json(
      {
        ok: false,
        error: `Agent "${agentId}" is not available in this deployment: its target resolves to a loopback address on the server. Set ${urlOverrideEnvName(agentId)} to a reachable base URL.`,
      },
      { status: 503 },
    );
  }

  const base = resolveBaseUrl(agent);
  const search = request.nextUrl.search;
  const url = `${base}/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const auth = resolveAuthHeader(agent);
  if (auth) headers.set("authorization", auth);

  // Buffer the (small JSON) request body instead of streaming it, so we do
  // not need half-duplex fetch support. Responses still stream through.
  const body =
    request.method === "POST" ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
    });
  } catch (cause) {
    return Response.json(
      {
        ok: false,
        error: `Agent "${agentId}" is unreachable at ${base}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
