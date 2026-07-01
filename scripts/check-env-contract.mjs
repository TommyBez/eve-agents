#!/usr/bin/env node
/**
 * Enforces AGENTS.md hard rule 3: every environment variable an app reads
 * must be listed in that app's .env.example.
 *
 * For each app under apps/*, this collects the variable names read in source
 * (`process.env.X`, `process.env["X"]`, `requireEnv("X")`, and the zod schema
 * keys in agent/lib/env.ts — the schema keys ARE the contract there) and
 * compares them against the uncommented `KEY=` lines of the app's
 * .env.example. Vars that are documented but never read are fine
 * (.env.example may list optional platform vars); vars that are read but
 * undocumented are violations.
 *
 * Exit codes: 0 = clean, 1 = violations found, 2 = unexpected error.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS_DIR = path.join(ROOT, "apps");

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".js",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".eve",
  ".output",
  ".vercel",
  ".turbo",
  ".workflow-data",
  "dist",
]);

/**
 * Framework/platform vars that eve, Vercel, or the toolchain inject and apps
 * may read without declaring in .env.example. Every entry needs a reason.
 * Entries ending in "*" match by prefix.
 */
const ALLOWLIST = [
  // Set by `pnpm run eval:ci` / the eve eval harness to swap in the mock
  // model; documented as a commented-out line in .env.example by convention
  // ("never set this in production"), so it is intentionally not a KEY= line.
  "EVE_MOCK_MODEL",
  // Set by `pnpm run eval:record` to record model responses into committed
  // eval fixtures (see @repo/eval-fixtures). Mirrors EVE_MOCK_MODEL: also a
  // commented-out .env.example line by convention, never set in production.
  "EVE_RECORD_FIXTURES",
  // Standard Node runtime mode; set by the platform, never by developers.
  "NODE_ENV",
  // Set by CI providers (GitHub Actions et al.), not user-configurable.
  "CI",
  // Injected by Vercel on deployments ("1" when running on Vercel).
  "VERCEL",
  // Injected by Vercel: production | preview | development.
  "VERCEL_ENV",
  // Injected by Vercel for OIDC auth to the AI Gateway (no key needed there).
  "VERCEL_OIDC_TOKEN",
  // Injected by the hosting platform to tell the server where to listen.
  "PORT",
  // Turborepo's own configuration/cache vars, set by the build system.
  "TURBO_*",
];

// process.env.SOMETHING (SCREAMING_SNAKE only; lowercase props are not env
// contract material) and process.env["SOMETHING"] / process.env['SOMETHING'].
const READ_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]+)\b/g,
  /process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g,
  /\brequireEnv\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g,
];

// Quoted-or-bare SCREAMING_SNAKE zod object keys in agent/lib/env.ts, e.g.
// `GITHUB_APP_ID: z.string().optional(),`.
const ENV_SCHEMA_KEY_PATTERN = /^\s*"?([A-Z][A-Z0-9_]+)"?:\s*z\./gm;

function listApps() {
  return readdirSync(APPS_DIR).filter((entry) => {
    try {
      return statSync(path.join(APPS_DIR, entry, "package.json")).isFile();
    } catch {
      return false;
    }
  });
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

function isAllowlisted(name) {
  return ALLOWLIST.some((entry) =>
    entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : name === entry,
  );
}

/** Uncommented KEY=... variable names declared in .env.example. */
function declaredVars(app) {
  const declared = new Set();
  let lines;
  try {
    lines = readFileSync(
      path.join(APPS_DIR, app, ".env.example"),
      "utf8",
    ).split("\n");
  } catch {
    return declared; // No .env.example: every read var is a violation.
  }
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]+)\s*=/.exec(line);
    if (match) declared.add(match[1]);
  }
  return declared;
}

/** Map of var name -> first `file:line` where the app reads it. */
function readVars(app) {
  const appDir = path.join(APPS_DIR, app);
  const reads = new Map();

  const record = (name, file, index, source) => {
    if (reads.has(name)) return;
    const line = source.slice(0, index).split("\n").length;
    reads.set(name, `${path.relative(ROOT, file)}:${line}`);
  };

  for (const file of walk(appDir)) {
    const source = readFileSync(file, "utf8");
    for (const pattern of READ_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        record(match[1], file, match.index, source);
      }
    }
    // The zod schema in agent/lib/env.ts is the app's env contract: every key
    // is readable through env()/requireEnv() even without a literal
    // process.env.X access elsewhere.
    if (file === path.join(appDir, "agent", "lib", "env.ts")) {
      for (const match of source.matchAll(ENV_SCHEMA_KEY_PATTERN)) {
        record(match[1], file, match.index, source);
      }
    }
  }

  return reads;
}

function findViolations(app) {
  const declared = declaredVars(app);
  const violations = [];
  for (const [name, at] of readVars(app)) {
    if (!declared.has(name) && !isAllowlisted(name)) {
      violations.push(
        `${at} reads "${name}" which is not declared in apps/${app}/.env.example`,
      );
    }
  }
  return violations;
}

try {
  const apps = listApps();
  const violations = apps.flatMap((app) => findViolations(app));

  if (violations.length > 0) {
    console.error("Env contract violations found:\n");
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
      "\nEvery env var an app reads must be listed in its .env.example (AGENTS.md" +
        "\nhard rule 3). Add the variable there with a comment, or — only for vars the" +
        "\nplatform injects — add it to ALLOWLIST in scripts/check-env-contract.mjs" +
        "\nwith a reason.",
    );
    process.exit(1);
  }

  console.log(`Env contract check passed (${apps.length} apps).`);
} catch (error) {
  console.error("check-env-contract failed unexpectedly:", error);
  process.exit(2);
}
