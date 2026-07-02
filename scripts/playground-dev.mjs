#!/usr/bin/env node
/**
 * Compose-like dev orchestrator for the playground.
 *
 *   pnpm playground:dev [--mock] [--agents-only] [--config <path>]
 *
 * Reads apps/playground/agents.config.json (the single source of truth for
 * playground registration) and, for every ENABLED entry with a local target
 * whose apps/<id> exists, spawns:
 *
 *   pnpm --filter <id> exec eve dev --no-ui --port <port>
 *
 * then starts the playground UI itself (`pnpm --filter playground dev`)
 * last. Each child's output is line-prefixed with a colored [name] tag.
 *
 * --mock          sets EVE_MOCK_MODEL=1 for the agent processes, so the whole
 *                 stack runs with no API keys (mock model replies).
 * --agents-only   starts only the agent processes, not the playground UI
 *                 (useful when running the Next.js app separately).
 * --config <path> config file override (used by tests).
 *
 * Skipped with a warning: disabled entries, url-kind targets (nothing to
 * start locally), and dangling entries whose apps/<id> is missing.
 *
 * SIGINT/SIGTERM are forwarded to every child (spawned with detached: false,
 * killed explicitly, SIGKILL escalation after 5s) so Ctrl-C tears the whole
 * tree down without orphan eve processes. Exit codes: 0 = clean shutdown,
 * 1 = expected failure or a child died early, 2 = unexpected error.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
const KILL_ESCALATION_MS = 5000;

// Plain ANSI colors, cycled per child; the playground UI always gets cyan.
const AGENT_COLORS = [
  "\x1b[32m",
  "\x1b[33m",
  "\x1b[35m",
  "\x1b[34m",
  "\x1b[92m",
  "\x1b[93m",
  "\x1b[95m",
  "\x1b[94m",
];
const PLAYGROUND_COLOR = "\x1b[36m";
const RESET = "\x1b[0m";
const TAG = "\x1b[90m[playground:dev]\x1b[0m";

/** Expected failure: report the message and exit 1 (no stack trace). */
class UserError extends Error {}

// ---------------------------------------------------------------------------
// Config loading (kept in sync with scripts/playground-agents.mjs — not
// imported so each script stays a self-contained executable)

function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new UserError(
      configPath === DEFAULT_CONFIG_PATH
        ? "playground not found — is apps/playground present? (expected apps/playground/agents.config.json)"
        : `Config file not found: ${configPath}`,
    );
  }
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new UserError(`${configPath} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(config?.agents)) {
    throw new UserError(`${configPath} is missing the "agents" array.`);
  }
  return config;
}

// ---------------------------------------------------------------------------
// Child process management

/** { name, child } for every spawned process. */
const children = [];
let shuttingDown = false;
let finalExitCode = 0;

function isAlive(child) {
  return child.exitCode === null && child.signalCode === null;
}

/** Line-buffered prefixing so interleaved child output stays readable. */
function pipeWithPrefix(stream, prefix, out) {
  let carry = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (carry + chunk).split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) out.write(`${prefix}${line}\n`);
  });
  stream.on("end", () => {
    if (carry !== "") out.write(`${prefix}${carry}\n`);
  });
}

function startChild(name, color, pnpmArgs, env) {
  // detached: false — children share this process group, so a real Ctrl-C
  // reaches everyone; programmatic teardown kills each child explicitly.
  const child = spawn("pnpm", pnpmArgs, {
    cwd: ROOT,
    detached: false,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `${color}[${name}]${RESET} `;
  pipeWithPrefix(child.stdout, prefix, process.stdout);
  pipeWithPrefix(child.stderr, prefix, process.stderr);
  child.on("error", (error) => {
    shutdown(1, `${TAG} could not spawn ${name}: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      maybeFinish();
      return;
    }
    const how = signal
      ? `was killed with ${signal}`
      : `exited with code ${code}`;
    shutdown(
      code === 0 || code === null ? 1 : code,
      `${TAG} ${name} ${how} — stopping everything else.`,
    );
  });
  children.push({ child, name });
}

/** Kill every live child explicitly; escalate to SIGKILL after 5s. */
function shutdown(exitCode, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  finalExitCode = exitCode;
  if (reason) console.error(reason);
  for (const { child } of children) {
    if (isAlive(child)) child.kill("SIGTERM");
  }
  if (children.some(({ child }) => isAlive(child))) {
    setTimeout(() => {
      for (const { child, name } of children) {
        if (isAlive(child)) {
          console.error(`${TAG} ${name} did not stop — sending SIGKILL.`);
          child.kill("SIGKILL");
        }
      }
    }, KILL_ESCALATION_MS);
  }
  maybeFinish();
}

function maybeFinish() {
  if (!shuttingDown) return;
  if (children.some(({ child }) => isAlive(child))) return;
  process.exit(finalExitCode);
}

// ---------------------------------------------------------------------------
// Main

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "agents-only": { type: "boolean" },
        config: { type: "string" },
        mock: { type: "boolean" },
      },
    });
  } catch (error) {
    throw new UserError(
      `${error.message}\n\nUsage: pnpm playground:dev [--mock] [--agents-only] [--config <path>]`,
    );
  }
  const { values } = parsed;
  const configPath = values.config
    ? path.resolve(values.config)
    : DEFAULT_CONFIG_PATH;
  const config = loadConfig(configPath);

  // Partition the registered agents into startable vs skipped.
  const startable = [];
  for (const agent of config.agents) {
    const id = String(agent?.id ?? "?");
    if (agent?.enabled === false) {
      console.warn(`${TAG} skipping ${id} — disabled in the config.`);
      continue;
    }
    if (agent?.target?.kind === "url") {
      console.warn(
        `${TAG} skipping ${id} — url target (${agent.target.url}), nothing to start locally.`,
      );
      continue;
    }
    if (
      agent?.target?.kind !== "local" ||
      !Number.isInteger(agent.target.port)
    ) {
      console.warn(`${TAG} skipping ${id} — invalid target in the config.`);
      continue;
    }
    if (!existsSync(path.join(APPS_DIR, id))) {
      console.warn(
        `${TAG} skipping ${id} — apps/${id} does not exist (dangling entry; ` +
          `run \`pnpm playground:agents remove ${id}\` or restore the app).`,
      );
      continue;
    }
    startable.push({ id, port: agent.target.port });
  }

  if (startable.length === 0 && values["agents-only"]) {
    throw new UserError(
      "Nothing to start — no enabled local agents in the config. Register one with `pnpm playground:agents add <app> --port auto`.",
    );
  }

  const agentEnv = {
    ...process.env,
    ...(values.mock ? { EVE_MOCK_MODEL: "1" } : {}),
  };
  if (values.mock) {
    console.log(`${TAG} mock mode — EVE_MOCK_MODEL=1, no API keys needed.`);
  }

  startable.forEach(({ id, port }, index) => {
    console.log(`${TAG} starting ${id} on port ${port}...`);
    startChild(
      id,
      AGENT_COLORS[index % AGENT_COLORS.length],
      ["--filter", id, "exec", "eve", "dev", "--no-ui", "--port", String(port)],
      agentEnv,
    );
  });

  if (!values["agents-only"]) {
    if (!existsSync(path.join(APPS_DIR, "playground"))) {
      shutdown(
        1,
        `${TAG} apps/playground not found — is the playground app present? ` +
          "Stopped the agent processes. Re-run once apps/playground exists, " +
          "or pass --agents-only to run just the agents.",
      );
      return;
    }
    console.log(`${TAG} starting the playground UI...`);
    startChild(
      "playground",
      PLAYGROUND_COLOR,
      ["--filter", "playground", "dev"],
      process.env,
    );
  }

  console.log(
    `${TAG} ${children.length} process(es) up — Ctrl-C stops everything.`,
  );

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      shutdown(0, `${TAG} ${signal} received — shutting down...`);
    });
  }
}

try {
  main();
} catch (error) {
  if (error instanceof UserError) {
    console.error(error.message);
    process.exit(1);
  }
  console.error("playground:dev failed unexpectedly:", error);
  process.exit(2);
}
