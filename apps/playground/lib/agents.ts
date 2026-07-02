import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Loader for agents.config.json — the playground's source of truth for which
 * eve agents it can reach. Server-only (uses node:fs); the proxy route and
 * the server components both go through it, so the browser never sees agent
 * URLs or credentials.
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

export type AgentTarget = z.output<typeof agentSchema>["target"];
export type AgentEntry = z.output<typeof agentSchema>;

export type AgentsConfig =
  | { readonly ok: true; readonly agents: readonly AgentEntry[] }
  | { readonly ok: false; readonly error: string };

const CONFIG_FILE = "agents.config.json";

function configPath(): string {
  // The turbopackIgnore hint keeps Next's output-file tracing from treating
  // this runtime read as "trace the whole project".
  return path.join(/*turbopackIgnore: true*/ process.cwd(), CONFIG_FILE);
}

/**
 * Reads and validates agents.config.json. Never throws: an unreadable or
 * invalid config comes back as `{ ok: false, error }` so pages can render
 * the problem instead of crashing the app.
 */
export function loadAgentsConfig(): AgentsConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath(), "utf8");
  } catch (cause) {
    return {
      ok: false,
      error: `Could not read ${CONFIG_FILE} (looked in ${process.cwd()}): ${message(cause)}`,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    return {
      ok: false,
      error: `${CONFIG_FILE} is not valid JSON: ${message(cause)}`,
    };
  }

  const parsed = configSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: `${CONFIG_FILE} failed validation:\n${z.prettifyError(parsed.error)}`,
    };
  }

  const seen = new Set<string>();
  for (const agent of parsed.data.agents) {
    if (seen.has(agent.id)) {
      return {
        ok: false,
        error: `${CONFIG_FILE} failed validation: duplicate agent id "${agent.id}"`,
      };
    }
    seen.add(agent.id);
  }

  return { ok: true, agents: parsed.data.agents };
}

/** Finds one agent by id. `null` when unknown (or when the config is broken). */
export function findAgent(id: string): AgentEntry | null {
  const config = loadAgentsConfig();
  if (!config.ok) return null;
  return config.agents.find((agent) => agent.id === id) ?? null;
}

/** Origin where the agent's /eve/v1/* routes live (no trailing slash). */
export function resolveBaseUrl(target: AgentTarget): string {
  if (target.kind === "local") return `http://127.0.0.1:${target.port}`;
  return target.url.replace(/\/+$/, "");
}

/**
 * Full Authorization header value for a target, read from the env var the
 * config names. The var name is dynamic (comes from agents.config.json), so
 * the read is necessarily `process.env[name]` — see .env.example.
 */
export function resolveAuthHeader(target: AgentTarget): string | null {
  if (target.kind !== "url" || !target.authHeaderEnv) return null;
  return process.env[target.authHeaderEnv] ?? null;
}

/**
 * True when a local target's id has no matching app directory under apps/*
 * — a "dangling" config entry (e.g. the app was deleted or renamed).
 */
export function isDanglingLocalAgent(agent: AgentEntry): boolean {
  if (agent.target.kind !== "local") return false;
  const appDir = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "..",
    agent.id,
  );
  return !existsSync(appDir);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
