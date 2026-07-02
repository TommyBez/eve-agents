#!/usr/bin/env node
/**
 * Environment diagnostics with fix-it commands. Run it when something feels
 * off (or right after cloning) to see what your machine is missing before
 * `pnpm verify` or `pnpm --filter <app> dev`.
 *
 * Failures are things `pnpm verify` needs (Node 24, pnpm 10, install state,
 * turbo). Warnings are things only dev / live evals need (per-app .env files,
 * AI_GATEWAY_API_KEY, gateway reachability) — verify is deterministic and
 * secret-free by design, so warnings never fail the run.
 *
 * Dependency-free on purpose (node:* only) so it works before `pnpm install`.
 *
 * Exit codes: 0 = no failures (warnings allowed), 1 = failures, 2 = error.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS_DIR = path.join(ROOT, "apps");
const GATEWAY_URL = "https://ai-gateway.vercel.sh";
const NETWORK_TIMEOUT_MS = 3_000;

let passed = 0;
let warnings = 0;
let failures = 0;

function pass(message) {
  passed += 1;
  console.log(`  ✓ ${message}`);
}

function warn(message, note) {
  warnings += 1;
  console.log(`  ! ${message}`);
  if (note) console.log(`      ${note}`);
}

function fail(message, fix) {
  failures += 1;
  console.log(`  ✗ ${message}`);
  if (fix) console.log(`      fix: ${fix}`);
}

/** Runs a command defensively; never throws (missing binaries return null). */
function run(command, args, timeout = 60_000) {
  try {
    const result = spawnSync(command, args, {
      cwd: ROOT,
      encoding: "utf8",
      timeout,
    });
    if (result.error) return null;
    return result;
  } catch {
    return null;
  }
}

function readRootPackageJson() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function listApps() {
  let entries;
  try {
    entries = readdirSync(APPS_DIR);
  } catch {
    return [];
  }
  return entries.filter((entry) => {
    try {
      return statSync(path.join(APPS_DIR, entry, "package.json")).isFile();
    } catch {
      return false;
    }
  });
}

/** Names of uncommented KEY=... assignments in a dotenv-style file. */
function dotenvKeys(file) {
  try {
    const keys = [];
    for (const rawLine of readFileSync(file, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) keys.push(match[1]);
    }
    return keys;
  } catch {
    return [];
  }
}

/** True when a dotenv-style file assigns the variable a non-empty value. */
function dotenvHasValue(file, name) {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .some((rawLine) => {
        const line = rawLine.trim();
        if (line.startsWith("#")) return false;
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        return match?.[1] === name && match[2].trim() !== "";
      });
  } catch {
    return false;
  }
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (Number.isInteger(major) && major >= 24) {
    pass(`Node ${process.versions.node} (>= 24)`);
  } else {
    fail(
      `Node ${process.versions.node} is too old (this repo requires Node 24)`,
      "nvm use (the repo pins the version in .nvmrc) or install Node 24 from https://nodejs.org",
    );
  }
}

function checkPnpm() {
  const pinned = readRootPackageJson().packageManager ?? "pnpm@10";
  const fix = `corepack enable (or install the pinned version: npm install -g ${pinned})`;
  const result = run("pnpm", ["--version"], 15_000);
  const version = result?.status === 0 ? result.stdout.trim() : null;
  if (!version) {
    fail("pnpm is not installed or not on PATH", fix);
    return false;
  }
  const major = Number.parseInt(version.split(".")[0], 10);
  if (major !== 10) {
    fail(`pnpm ${version} found, but this repo requires pnpm 10`, fix);
    return false;
  }
  pass(`pnpm ${version} (major 10)`);
  return true;
}

function checkInstallState(pnpmOk) {
  if (!existsSync(path.join(ROOT, "node_modules"))) {
    fail(
      "node_modules is missing (dependencies not installed)",
      "pnpm install",
    );
    return;
  }
  if (!pnpmOk) {
    warn(
      "Skipped lockfile sync probe (no working pnpm 10)",
      "Re-run `node scripts/doctor.mjs` after fixing pnpm.",
    );
    return;
  }
  // Cheap probe: validates pnpm-lock.yaml against every package.json without
  // touching node_modules or the network (~0.5s on this repo).
  const result = run(
    "pnpm",
    ["install", "--frozen-lockfile", "--lockfile-only"],
    120_000,
  );
  if (result?.status === 0) {
    pass("node_modules present and pnpm-lock.yaml is in sync");
  } else {
    fail(
      "pnpm-lock.yaml is out of sync with package.json files",
      "pnpm install",
    );
  }
}

function checkTurbo(pnpmOk) {
  if (!pnpmOk) {
    fail(
      "Cannot resolve turbo without a working pnpm",
      "fix pnpm first, then: pnpm install",
    );
    return;
  }
  const result = run("pnpm", ["exec", "turbo", "--version"], 60_000);
  if (result?.status === 0) {
    pass(`turbo ${result.stdout.trim()} resolvable via \`pnpm exec turbo\``);
  } else {
    fail(
      "turbo binary is not resolvable (`pnpm exec turbo --version` failed)",
      "pnpm install",
    );
  }
}

function checkAppEnvFiles(apps) {
  for (const app of apps) {
    const appDir = path.join(APPS_DIR, app);
    const example = path.join(appDir, ".env.example");
    if (!existsSync(example)) continue;
    const hasLocal =
      existsSync(path.join(appDir, ".env")) ||
      existsSync(path.join(appDir, ".env.local"));
    if (hasLocal) {
      pass(`apps/${app}: local env file present (.env or .env.local)`);
    } else {
      const count = dotenvKeys(example).length;
      warn(
        `apps/${app}: .env.example exists but no .env or .env.local (${count} vars undeclared locally)`,
        `Only \`pnpm --filter ${app} dev\` and live evals need it — \`pnpm verify\` runs without env vars. fix: cp apps/${app}/.env.example apps/${app}/.env.local`,
      );
    }
  }
}

// eve never garbage-collects .workflow-data; once events/ outgrows the fd
// limit (ulimit -n), eve's startup prune crashes with EMFILE. Warn early.
function checkWorkflowDataGrowth(apps) {
  for (const app of apps) {
    const eventsDir = path.join(APPS_DIR, app, ".workflow-data", "events");
    if (!existsSync(eventsDir)) continue;
    const count = readdirSync(eventsDir).length;
    if (count > 1_500) {
      warn(
        `apps/${app}: .workflow-data/events has ${count} files — eve eval will start failing with EMFILE`,
        `Local dev-only session state; safe to delete. fix: rm -rf apps/${app}/.workflow-data`,
      );
    } else {
      pass(`apps/${app}: .workflow-data size OK (${count} event files)`);
    }
  }
}

function checkGatewayKey(apps) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: doctor probes the machine's environment directly; it is not a turbo task input.
  if (process.env.AI_GATEWAY_API_KEY) {
    pass("AI_GATEWAY_API_KEY is set in the environment");
    return;
  }
  for (const app of apps) {
    for (const file of [".env", ".env.local"]) {
      if (
        dotenvHasValue(path.join(APPS_DIR, app, file), "AI_GATEWAY_API_KEY")
      ) {
        pass(`AI_GATEWAY_API_KEY is set in apps/${app}/${file}`);
        return;
      }
    }
  }
  warn(
    "AI_GATEWAY_API_KEY is not set (environment or any app .env/.env.local)",
    "Needed for real-model dev and live evals only — deterministic `pnpm verify` does not need it.",
  );
}

async function checkNetwork() {
  try {
    await fetch(GATEWAY_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    // Any HTTP response (even 4xx) means the gateway is reachable.
    pass(`${GATEWAY_URL} is reachable`);
  } catch {
    warn(
      `${GATEWAY_URL} is not reachable (timeout ${NETWORK_TIMEOUT_MS / 1000}s)`,
      "Offline is fine for `pnpm verify`; real-model dev and live evals need network access.",
    );
  }
}

try {
  console.log("eve-agents doctor\n");
  const apps = listApps();

  checkNodeVersion();
  const pnpmOk = checkPnpm();
  checkInstallState(pnpmOk);
  checkTurbo(pnpmOk);
  checkAppEnvFiles(apps);
  checkWorkflowDataGrowth(apps);
  checkGatewayKey(apps);
  await checkNetwork();

  console.log(
    `\n${passed} checks passed, ${warnings} warnings, ${failures} failures`,
  );
  if (failures > 0) process.exit(1);
} catch (error) {
  console.error("doctor failed unexpectedly:", error);
  process.exit(2);
}
