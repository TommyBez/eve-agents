import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import rawConfig from "../agents.config.json";

/**
 * Loader for agents.config.json — the playground's source of truth for which
 * eve agents it can reach. The config is a build-time static import (Next
 * bundles JSON), validated once with zod. Server-only (uses node:fs); the
 * proxy route and the server components both go through it, so the browser
 * never sees agent URLs or credentials.
 *
 * Target resolution order (per agent id, all server-side):
 *   1. `PLAYGROUND_<CONSTANT_CASE_ID>_URL` env var — a full base URL that
 *      overrides the config target (how a *deployed* playground reaches
 *      agents that are `kind: "local"` on dev machines).
 *   2. The config `target` (`local` → http://127.0.0.1:<port>, `url` → url).
 *
 * Credentials: the config's `authHeaderEnv` if set, else the conventional
 * `PLAYGROUND_<CONSTANT_CASE_ID>_AUTH`.
 */

const localTargetSchema = z.strictObject({
  kind: z.literal("local"),
  port: z.int().min(1).max(65535),
});

const urlTargetSchema = z.strictObject({
  kind: z.literal("url"),
  url: z.url(),
  authHeaderEnv: z
    .string()
    .regex(
      /^[A-Z][A-Z0-9_]*$/,
      "must be a SCREAMING_SNAKE env var name (e.g. PLAYGROUND_MY_AGENT_AUTH)",
    )
    .optional(),
});

const agentSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "must be lowercase-kebab (used in URLs)"),
  title: z.string().min(1),
  description: z.string(),
  target: z.discriminatedUnion("kind", [localTargetSchema, urlTargetSchema]),
  enabled: z.boolean().default(true),
});

const configSchema = z.strictObject({
  $schema: z.string().optional(),
  agents: z.array(agentSchema),
});

export type AgentEntry = z.output<typeof agentSchema>;

export type AgentsConfig =
  | { readonly ok: true; readonly agents: readonly AgentEntry[] }
  | { readonly ok: false; readonly error: string };

const CONFIG_FILE = "agents.config.json";

/** The config is static per build; validate it once. */
let cached: AgentsConfig | null = null;

/**
 * Validates the statically imported agents.config.json. Never throws: an
 * invalid config comes back as `{ ok: false, error }` so pages can render
 * the problem instead of crashing the app.
 */
export function loadAgentsConfig(): AgentsConfig {
  if (cached) return cached;

  const parsed = configSchema.safeParse(rawConfig);
  if (!parsed.success) {
    cached = {
      ok: false,
      error: `${CONFIG_FILE} failed validation:\n${z.prettifyError(parsed.error)}`,
    };
    return cached;
  }

  const seen = new Set<string>();
  for (const agent of parsed.data.agents) {
    if (seen.has(agent.id)) {
      cached = {
        ok: false,
        error: `${CONFIG_FILE} failed validation: duplicate agent id "${agent.id}"`,
      };
      return cached;
    }
    seen.add(agent.id);
  }

  cached = { ok: true, agents: parsed.data.agents };
  return cached;
}

/** Finds one agent by id. `null` when unknown (or when the config is broken). */
export function findAgent(id: string): AgentEntry | null {
  const config = loadAgentsConfig();
  if (!config.ok) return null;
  return config.agents.find((agent) => agent.id === id) ?? null;
}

/** `code-reviewer` → `CODE_REVIEWER` (agent ids are lowercase-kebab). */
function constantCase(id: string): string {
  return id.toUpperCase().replaceAll("-", "_");
}

/** Name of the env var that overrides this agent's base URL. */
export function urlOverrideEnvName(id: string): string {
  return `PLAYGROUND_${constantCase(id)}_URL`;
}

/** Env-var override for an agent's base URL, if set (no trailing slash). */
function urlOverride(id: string): string | null {
  const value = process.env[urlOverrideEnvName(id)];
  return value ? value.replace(/\/+$/, "") : null;
}

/**
 * Origin where the agent's /eve/v1/* routes live (no trailing slash).
 * `PLAYGROUND_<CONSTANT_CASE_ID>_URL` wins over the config target.
 */
export function resolveBaseUrl(agent: AgentEntry): string {
  const override = urlOverride(agent.id);
  if (override) return override;
  if (agent.target.kind === "local") {
    return `http://127.0.0.1:${agent.target.port}`;
  }
  return agent.target.url.replace(/\/+$/, "");
}

/**
 * Full Authorization header value for an agent: the env var named by the
 * config's `authHeaderEnv` if set, else the conventional
 * `PLAYGROUND_<CONSTANT_CASE_ID>_AUTH`. Var names are dynamic (derived from
 * agents.config.json), so the reads are necessarily `process.env[name]` —
 * see .env.example.
 */
export function resolveAuthHeader(agent: AgentEntry): string | null {
  if (agent.target.kind === "url" && agent.target.authHeaderEnv) {
    const explicit = process.env[agent.target.authHeaderEnv];
    if (explicit) return explicit;
  }
  return process.env[`PLAYGROUND_${constantCase(agent.id)}_AUTH`] ?? null;
}

/**
 * True when this deployment cannot reach the agent: the server runs on
 * Vercel (`VERCEL` is injected there) but the agent — with no
 * `PLAYGROUND_<ID>_URL` override — resolves to a loopback address, i.e. a
 * dev server that only exists on someone's machine. An explicit override is
 * always honored, loopback or not. Locally this is always `false`.
 */
export function isUnavailableInDeployment(agent: AgentEntry): boolean {
  if (!process.env.VERCEL) return false;
  if (urlOverride(agent.id)) return false;
  return isLoopbackUrl(resolveBaseUrl(agent));
}

function isLoopbackUrl(base: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(base).hostname;
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

/**
 * True when a local target's id has no matching app directory under apps/*
 * — a "dangling" config entry (e.g. the app was deleted or renamed). Only
 * meaningful on a dev checkout where the playground runs from the monorepo's
 * apps/ directory; deployed servers skip the filesystem check silently.
 */
export function isDanglingLocalAgent(agent: AgentEntry): boolean {
  if (agent.target.kind !== "local") return false;
  // Dev-machine-only: `next dev` from apps/playground inside the monorepo.
  // The NODE_ENV guard also lets Turbopack drop the fs probe from production
  // builds entirely (a traced `existsSync(cwd/..)` would otherwise make
  // output-file tracing pull in the whole monorepo).
  if (process.env.NODE_ENV !== "development") return false;
  const appsDir = path.join(process.cwd(), "..");
  if (path.basename(appsDir) !== "apps" || !existsSync(appsDir)) return false;
  return !existsSync(path.join(appsDir, agent.id));
}
