#!/usr/bin/env node
/**
 * Manage the playground's agent registry (apps/playground/agents.config.json).
 *
 *   pnpm playground:agents add <app> --port <n|auto> [--title "..."]
 *   pnpm playground:agents add <name> --url <url> [--auth-env <VAR>] [--title "..."]
 *   pnpm playground:agents remove <app>
 *   pnpm playground:agents list
 *
 * The config file is the single source of truth for what the playground
 * serves — registration is always explicit, there is no auto-discovery.
 * Each entry becomes a chat page at /agents/<id>. Targets are either
 * { kind: "local", port } — an app in this repo, started by
 * `pnpm playground:dev` — or { kind: "url", url, authHeaderEnv } for an
 * agent hosted elsewhere (authHeaderEnv names the env var holding the
 * Authorization header value; default PLAYGROUND_<ID>_AUTH).
 *
 * `add` is idempotent: adding an already-registered id updates it in place
 * (only the fields you pass). Ports are never guessed — pass `--port <n>`,
 * or `--port auto` to take max(registered local ports, 2000) + 1.
 * `--config <path>` overrides the config location (used by tests).
 *
 * Exit codes: 0 = success, 1 = expected failure (bad input, missing config),
 * 2 = unexpected error.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS_DIR = path.join(ROOT, "apps");
const DEFAULT_CONFIG_PATH = path.join(
  APPS_DIR,
  "playground",
  "agents.config.json",
);
const BASE_PORT = 2000;
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Expected failure: report the message and exit 1 (no stack trace). */
class UserError extends Error {}

function usage() {
  return [
    "Usage: pnpm playground:agents <add|remove|list> [app] [options]",
    "",
    "Commands:",
    "  add <app>      register apps/<app> (or update it, if already registered)",
    "  remove <app>   drop the entry from the config",
    "  list           show every registered agent and whether apps/<id> exists",
    "",
    "Options (add):",
    '  --port <n|auto>   local target port ("auto" = next free port, starting at 2001)',
    "  --url <url>       register an externally hosted agent instead of a local app",
    "  --auth-env <VAR>  env var holding the auth header for a --url target",
    "                    (default PLAYGROUND_<ID>_AUTH)",
    '  --title "..."     display title (default: title-cased app name)',
    "",
    "Options (all commands):",
    "  --config <path>   config file override (default apps/playground/agents.config.json)",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Config IO — parse/serialize keeps key order and 2-space indentation stable,
// so an add followed by a remove round-trips to a byte-identical file.

function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new UserError(
      configPath === DEFAULT_CONFIG_PATH
        ? "playground not found — is apps/playground present? (expected apps/playground/agents.config.json)"
        : `Config file not found: ${configPath}`,
    );
  }
  const text = readFileSync(configPath, "utf8");
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new UserError(`${configPath} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(config?.agents)) {
    throw new UserError(`${configPath} is missing the "agents" array.`);
  }
  return { config, trailingNewline: text.endsWith("\n") };
}

/** `{ kind: "local", port: 2000 }` -> `{ "kind": "local", "port": 2000 }`. */
function inlineJson(object) {
  const parts = Object.entries(object)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{ ${parts.join(", ")} }`;
}

function saveConfig(configPath, config, trailingNewline) {
  // The config file keeps each entry's `target` on one line (the style the
  // playground's own file uses). Targets are swapped for unique string
  // tokens before JSON.stringify, then substituted back inline — this keeps
  // key order and 2-space indentation stable so an add followed by a remove
  // round-trips to a byte-identical file.
  const tokens = [];
  const clone = {
    ...config,
    agents: config.agents.map((agent) => {
      if (agent?.target === undefined || typeof agent.target !== "object") {
        return agent;
      }
      const token = `@@playground-target-${tokens.length}@@`;
      tokens.push({ target: agent.target, token });
      return { ...agent, target: token };
    }),
  };
  let text = JSON.stringify(clone, null, 2);
  for (const { target, token } of tokens) {
    text = text.replace(JSON.stringify(token), inlineJson(target));
  }
  writeFileSync(configPath, text + (trailingNewline ? "\n" : ""));
}

// ---------------------------------------------------------------------------
// Helpers

/** "code-reviewer" -> "Code Reviewer". */
function titleCase(id) {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** "code-reviewer" -> "CODE_REVIEWER". */
function constantCase(id) {
  return id.replace(/-/g, "_").toUpperCase();
}

function localPortEntries(config, excludeId) {
  return config.agents.filter(
    (agent) =>
      agent?.id !== excludeId &&
      agent?.target?.kind === "local" &&
      Number.isInteger(agent.target.port),
  );
}

/** Next free local port: max(registered local ports, 2000) + 1. */
function nextFreePort(config, excludeId) {
  return (
    Math.max(
      BASE_PORT,
      ...localPortEntries(config, excludeId).map((agent) => agent.target.port),
    ) + 1
  );
}

function takenPortsSummary(config, excludeId) {
  const taken = localPortEntries(config, excludeId);
  if (taken.length === 0) return "No local ports are registered yet.";
  const list = taken
    .map((agent) => `${agent.target.port} (${agent.id})`)
    .join(", ");
  return `Ports already taken in the config: ${list}.`;
}

/** Validates `--port <n|auto>` against the other entries' local ports. */
function resolvePort(config, rawPort, excludeId) {
  if (rawPort === "auto") return nextFreePort(config, excludeId);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UserError(
      `Invalid --port "${rawPort}" — expected an integer (1-65535) or "auto".`,
    );
  }
  const owner = localPortEntries(config, excludeId).find(
    (agent) => agent.target.port === port,
  );
  if (owner) {
    throw new UserError(
      `Port ${port} is already taken by "${owner.id}". ` +
        `${takenPortsSummary(config, excludeId)} ` +
        `Try --port ${nextFreePort(config, excludeId)} (or --port auto).`,
    );
  }
  return port;
}

/**
 * Best-effort description for a local app: package.json "description",
 * falling back to the first paragraph of the app's AGENTS.md.
 */
function harvestDescription(appDir) {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(appDir, "package.json"), "utf8"),
    );
    if (typeof pkg.description === "string" && pkg.description.trim() !== "") {
      return pkg.description.trim();
    }
  } catch {
    // Best effort — fall through to AGENTS.md.
  }
  try {
    const lines = readFileSync(path.join(appDir, "AGENTS.md"), "utf8").split(
      "\n",
    );
    const paragraph = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("#") || line === "") {
        if (paragraph.length > 0) break;
        continue;
      }
      paragraph.push(line);
    }
    if (paragraph.length > 0) return paragraph.join(" ");
  } catch {
    // Best effort — the caller falls back to the title.
  }
  return undefined;
}

function describeTarget(target) {
  if (target?.kind === "local") return `local port ${target.port}`;
  if (target?.kind === "url") {
    return `${target.url} (auth env: ${target.authHeaderEnv ?? "none"})`;
  }
  return "invalid target";
}

// ---------------------------------------------------------------------------
// Commands

function commandAdd(config, id, values) {
  if (!KEBAB_CASE.test(id)) {
    throw new UserError(
      `Agent id "${id}" is not kebab-case (lowercase letters, digits, single hyphens).`,
    );
  }
  if (values.url !== undefined && values.port !== undefined) {
    throw new UserError(
      "Pass --port (local target) or --url (external target), not both.",
    );
  }

  const appDir = path.join(APPS_DIR, id);
  const appExists = existsSync(appDir);
  const requireApp = () => {
    if (!appExists) {
      throw new UserError(
        `apps/${id} does not exist — scaffold it first (pnpm agent:new), or register an externally hosted agent with --url.`,
      );
    }
  };

  const existing = config.agents.find((agent) => agent?.id === id);
  if (existing) {
    // Idempotent update: only the fields explicitly passed are changed.
    const changes = [];
    if (values.title !== undefined) {
      existing.title = values.title;
      changes.push("title");
    }
    if (values.url !== undefined) {
      existing.target = {
        kind: "url",
        url: values.url,
        authHeaderEnv:
          values["auth-env"] ??
          (existing.target?.kind === "url"
            ? existing.target.authHeaderEnv
            : undefined) ??
          `PLAYGROUND_${constantCase(id)}_AUTH`,
      };
      changes.push("target");
    } else if (values.port !== undefined) {
      requireApp();
      existing.target = {
        kind: "local",
        port: resolvePort(config, values.port, id),
      };
      changes.push("target");
    } else if (values["auth-env"] !== undefined) {
      if (existing.target?.kind !== "url") {
        throw new UserError(
          `--auth-env only applies to url targets — "${id}" has a ${existing.target?.kind ?? "missing"} target.`,
        );
      }
      existing.target.authHeaderEnv = values["auth-env"];
      changes.push("target");
    }
    const note =
      changes.length > 0
        ? `note: "${id}" was already registered — updated ${changes.join(" and ")} in place.`
        : `note: "${id}" was already registered — nothing to change.`;
    return { entry: existing, note, verb: "Updated" };
  }

  let target;
  if (values.url !== undefined) {
    target = {
      kind: "url",
      url: values.url,
      authHeaderEnv:
        values["auth-env"] ?? `PLAYGROUND_${constantCase(id)}_AUTH`,
    };
  } else {
    requireApp();
    if (values.port === undefined) {
      throw new UserError(
        "--port is required for local targets — the playground never guesses ports. " +
          `${takenPortsSummary(config)} ` +
          `Next free: --port ${nextFreePort(config)} (or pass --port auto).`,
      );
    }
    target = { kind: "local", port: resolvePort(config, values.port, id) };
  }

  const title = values.title ?? titleCase(id);
  const entry = {
    id,
    title,
    description: (appExists ? harvestDescription(appDir) : undefined) ?? title,
    target,
    enabled: true,
  };
  config.agents.push(entry);
  return { entry, note: undefined, verb: "Registered" };
}

function commandRemove(config, id) {
  const index = config.agents.findIndex((agent) => agent?.id === id);
  if (index === -1) {
    const known = config.agents.map((agent) => agent?.id).join(", ") || "none";
    throw new UserError(
      `"${id}" is not registered in the playground (registered: ${known}).`,
    );
  }
  config.agents.splice(index, 1);
}

function commandList(config) {
  if (config.agents.length === 0) {
    console.log("No agents registered.");
    return;
  }
  const rows = config.agents.map((agent) => {
    const id = String(agent?.id ?? "?");
    const target =
      agent?.target?.kind === "local"
        ? `local:${agent.target.port}`
        : agent?.target?.kind === "url"
          ? `url:${agent.target.url}`
          : "invalid";
    const enabled = agent?.enabled === false ? "no" : "yes";
    const app =
      agent?.target?.kind === "url"
        ? "(external)"
        : existsSync(path.join(APPS_DIR, id))
          ? `apps/${id}`
          : `apps/${id} MISSING (dangling entry)`;
    return [id, target, enabled, app];
  });
  const header = ["ID", "TARGET", "ENABLED", "APP"];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  for (const row of [header, ...rows]) {
    console.log(
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column]),
        )
        .join("  "),
    );
  }
}

// ---------------------------------------------------------------------------
// Main

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        "auth-env": { type: "string" },
        config: { type: "string" },
        port: { type: "string" },
        title: { type: "string" },
        url: { type: "string" },
      },
    });
  } catch (error) {
    throw new UserError(`${error.message}\n\n${usage()}`);
  }
  const { values, positionals } = parsed;
  const [command, id] = positionals;
  const configPath = values.config
    ? path.resolve(values.config)
    : DEFAULT_CONFIG_PATH;

  if (command === undefined) throw new UserError(usage());
  if (!["add", "remove", "list"].includes(command)) {
    throw new UserError(`Unknown command "${command}".\n\n${usage()}`);
  }

  const { config, trailingNewline } = loadConfig(configPath);

  if (command === "list") {
    commandList(config);
    return;
  }
  if (!id) {
    throw new UserError(
      `Usage: pnpm playground:agents ${command} <app>\n\n${usage()}`,
    );
  }

  if (command === "add") {
    const { entry, note, verb } = commandAdd(config, id, values);
    saveConfig(configPath, config, trailingNewline);
    if (note) console.log(note);
    console.log(
      `${verb} "${id}" -> ${describeTarget(entry.target)} — chat at /agents/${id}.`,
    );
  } else {
    commandRemove(config, id);
    saveConfig(configPath, config, trailingNewline);
    console.log(`Removed "${id}" from the playground config.`);
  }
}

try {
  main();
} catch (error) {
  if (error instanceof UserError) {
    console.error(error.message);
    process.exit(1);
  }
  console.error("playground:agents failed unexpectedly:", error);
  process.exit(2);
}
