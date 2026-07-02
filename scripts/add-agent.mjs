#!/usr/bin/env node
/**
 * Scaffold a new app from a registry-published eve agent.
 *
 *   pnpm agent:add <spec> [name] [--yes] [--no-env-prefix]
 *   pnpm agent:add --from-file <path> [name] [--yes] [--no-env-prefix]
 *
 * <spec> is `@evex/<item>`, a bare `<item>` (defaults to the @evex registry),
 * or a full registry-item URL. `--from-file` reads the item JSON from disk
 * instead (useful for offline/private items). [name] overrides the app name.
 *
 * What it does, in order:
 *   1. Fetches the shadcn-style registry item JSON.
 *   2. Scaffolds the base app with the repo generator (`turbo gen agent`).
 *   3. Overlays the item's files into apps/<name> (registry wins on
 *      collisions, except package.json/tsconfig.json/turbo.json), adding
 *      `.js` to extensionless relative imports (this repo resolves modules
 *      with nodenext; some registry items were authored bundler-style).
 *   4. Renames app-specific env vars to the `<APP>_` prefix (AGENTS.md hard
 *      rule 3) across the overlaid files, replacing detected legacy prefixes
 *      instead of double-prefixing. Shared platform vars are never renamed;
 *      opt out entirely with --no-env-prefix.
 *   5. Merges the item's dependencies (catalog-managed packages stay
 *      `catalog:`; version-drift against the catalog is warned about).
 *   6. Rewires the overlaid agent.ts model through @repo/eval-fixtures'
 *      `evalModel` so the ci-tagged smoke eval stays deterministic.
 *   7. Appends any env vars the overlaid code reads (but .env.example does
 *      not declare) so `pnpm check:env-contract` stays green.
 *   8. Runs pnpm install, adds `@types/<pkg>` for merged deps that ship no
 *      type declarations, strips unused exports (knip --fix), then Biome
 *      auto-fix and lint + typecheck + eval:ci for the new app.
 *
 * Exit codes: 0 = success, 1 = expected failure (bad input, checks failed),
 * 2 = unexpected error.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS_DIR = path.join(ROOT, "apps");
const FETCH_TIMEOUT_MS = 10_000;
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Known registries: `@handle` -> item URL template ({name} is the item name).
 * The registry index is assumed to live at the template with name=registry
 * (shadcn convention: .../r/registry.json). Add entries here to support
 * other registries, e.g. `"@acme": "https://agents.acme.dev/r/{name}.json"`.
 */
const REGISTRIES = {
  "@evex": "https://evex.sh/r/{name}.json",
};
const DEFAULT_REGISTRY = "@evex";

/** Scaffold files the registry must never overwrite (deps merge separately). */
const PROTECTED_TARGETS = new Set([
  "package.json",
  "tsconfig.json",
  "turbo.json",
]);

/** Expected failure: report the message and exit 1 (no stack trace). */
class UserError extends Error {}

// ---------------------------------------------------------------------------
// Registry fetching

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = error?.cause?.message ?? error?.message ?? String(error);
    throw new UserError(
      `Could not reach ${url} (${cause}). Check your network and try again.`,
    );
  }
  if (!response.ok) {
    return { status: response.status, json: undefined };
  }
  try {
    return { status: response.status, json: await response.json() };
  } catch {
    throw new UserError(`${url} did not return valid JSON.`);
  }
}

/** `@evex/<item>`, bare `<item>`, or a full item URL -> { url, itemName, indexUrl }. */
function parseSpec(spec) {
  if (/^https?:\/\//.test(spec)) {
    const itemName = path
      .basename(new URL(spec).pathname)
      .replace(/\.json$/, "");
    return { indexUrl: undefined, itemName, url: spec };
  }
  let registry = DEFAULT_REGISTRY;
  let itemName = spec;
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash === -1) {
      throw new UserError(
        `Invalid spec "${spec}" — expected @registry/<item>, <item>, or a URL.`,
      );
    }
    registry = spec.slice(0, slash);
    itemName = spec.slice(slash + 1);
  }
  const template = REGISTRIES[registry];
  if (!template) {
    const known = Object.keys(REGISTRIES).join(", ");
    throw new UserError(`Unknown registry "${registry}" (known: ${known}).`);
  }
  return {
    indexUrl: template.replace("{name}", "registry"),
    itemName,
    url: template.replace("{name}", itemName),
  };
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(
        dist[i - 1][j] + 1,
        dist[i][j - 1] + 1,
        dist[i - 1][j - 1] + substitution,
      );
    }
  }
  return dist[rows - 1][cols - 1];
}

/** On a 404, list the registry's items and suggest the closest names. */
async function unknownItemError(itemName, indexUrl) {
  let hint = "";
  if (indexUrl) {
    try {
      const { json } = await fetchJson(indexUrl);
      const names = (json?.items ?? [])
        .map((item) => item?.name)
        .filter((name) => typeof name === "string");
      const close = names
        .map((name) => ({ distance: levenshtein(itemName, name), name }))
        .filter(
          ({ distance, name }) =>
            distance <= 3 || name.includes(itemName) || itemName.includes(name),
        )
        .sort((left, right) => left.distance - right.distance)
        .slice(0, 3)
        .map(({ name }) => name);
      hint =
        close.length > 0
          ? `\nDid you mean: ${close.join(", ")}?`
          : `\nAvailable items: ${names.join(", ")}`;
    } catch {
      // Index unavailable — the 404 message alone will have to do.
    }
  }
  return new UserError(`Registry item "${itemName}" not found (404).${hint}`);
}

function validateItem(item) {
  if (typeof item?.name !== "string" || !Array.isArray(item?.files)) {
    throw new UserError(
      "Registry item JSON is missing required fields (name, files).",
    );
  }
}

// ---------------------------------------------------------------------------
// File overlay

/**
 * Resolves a registry target like `~/agent/tools/x.ts` inside apps/<name>,
 * rejecting absolute targets and anything escaping the app directory.
 */
function resolveTarget(target, appDir) {
  if (typeof target !== "string" || !target.startsWith("~/")) {
    throw new UserError(
      `Rejected registry file target "${target}" — targets must start with ~/ (project root).`,
    );
  }
  const relative = target.slice(2);
  if (relative.includes("\0") || path.isAbsolute(relative)) {
    throw new UserError(`Rejected registry file target "${target}".`);
  }
  const resolved = path.resolve(appDir, relative);
  if (resolved !== appDir && !resolved.startsWith(appDir + path.sep)) {
    throw new UserError(
      `Rejected registry file target "${target}" — it escapes apps/${path.basename(appDir)}/.`,
    );
  }
  return { relative: path.relative(appDir, resolved), resolved };
}

function overlayFiles(item, appDir) {
  const written = [];
  const overwritten = [];
  const skipped = [];
  let agentTsContent;

  for (const file of item.files) {
    if (typeof file?.content !== "string") {
      throw new UserError(
        `Registry file "${file?.target ?? file?.path}" has no inline content — cannot install.`,
      );
    }
    const { relative, resolved } = resolveTarget(file.target, appDir);
    if (PROTECTED_TARGETS.has(relative)) {
      skipped.push(relative);
      continue;
    }
    if (relative === path.join("agent", "agent.ts")) {
      // Held back: written by rewireAgentModel() after the transform.
      agentTsContent = file.content;
      continue;
    }
    if (existsSync(resolved)) overwritten.push(relative);
    else written.push(relative);
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, file.content);
  }

  return { agentTsContent, overwritten, skipped, written };
}

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts"]);
const HAS_FILE_EXTENSION = /\.(?:js|mjs|cjs|jsx|ts|mts|cts|tsx|json|node)$/;
const RELATIVE_SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(["'])(\.[^"'\n]+)\2/g;

/**
 * Adds `.js` to extensionless relative imports in registry-sourced TS files.
 * This repo's tsconfig resolves with nodenext (explicit extensions required);
 * some registry items were authored bundler-style without them. Only rewrites
 * specifiers whose `.ts` source (or `/index.ts`) actually exists on disk.
 */
function fixRelativeImportExtensions(files, appDir) {
  const fixed = [];
  for (const relative of files) {
    const filePath = path.join(appDir, relative);
    if (!TS_EXTENSIONS.has(path.extname(filePath))) continue;
    const source = readFileSync(filePath, "utf8");
    const rewritten = source.replace(
      RELATIVE_SPECIFIER,
      (whole, prefix, quote, spec) => {
        if (HAS_FILE_EXTENSION.test(spec)) return whole;
        const base = path.resolve(path.dirname(filePath), spec);
        if (existsSync(`${base}.ts`) || existsSync(`${base}.tsx`)) {
          return `${prefix}${quote}${spec}.js${quote}`;
        }
        if (existsSync(path.join(base, "index.ts"))) {
          return `${prefix}${quote}${spec}/index.js${quote}`;
        }
        return whole;
      },
    );
    if (rewritten !== source) {
      writeFileSync(filePath, rewritten);
      fixed.push(relative);
    }
  }
  return fixed;
}

// ---------------------------------------------------------------------------
// Env-prefix enforcement (AGENTS.md hard rule 3: app-specific env vars are
// prefixed with the SCREAMING_SNAKE app name). Registry items rarely follow
// this repo's convention, so nonconforming vars are renamed across the
// overlaid files. Opt out with --no-env-prefix.

/**
 * Vars agent:add must never rename: shared platform credentials and vars the
 * platform/toolchain injects keep their canonical names (AGENTS.md hard rule
 * 3 lists the shared set). Entries ending in "*" match by prefix.
 */
const SHARED_ENV_VARS = [
  // Vercel AI Gateway key — shared across every app in the fleet.
  "AI_GATEWAY_API_KEY",
  // eve runtime/eval switches (EVE_MOCK_MODEL, EVE_RECORD_FIXTURES, ...).
  "EVE_*",
  // Canonical GitHub App / Slack / Linear credentials.
  "GITHUB_*",
  "SLACK_*",
  "LINEAR_*",
  // Upstash Redis REST credentials as provisioned by Vercel marketplace.
  "KV_REST_API_*",
  // Injected by Vercel (VERCEL, VERCEL_ENV, VERCEL_OIDC_TOKEN, ...).
  "VERCEL_*",
  // Runtime/platform vars, never app-specific.
  "NODE_ENV",
  "CI",
  "PORT",
  "TURBO_*",
];

function isSharedEnvVar(name) {
  return SHARED_ENV_VARS.some((entry) =>
    entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : name === entry,
  );
}

/** kebab-case app name -> SCREAMING_SNAKE, e.g. "x-hot-topic-digest" -> "X_HOT_TOPIC_DIGEST". */
function constantCase(name) {
  return name.replace(/-/g, "_").toUpperCase();
}

/**
 * Env vars referenced by the overlaid files: process.env reads (and zod
 * schema keys when the item ships agent/lib/env.ts), plus the names declared
 * in an overlaid .env.example — those are the item's env contract even when
 * a var is documented but not yet read.
 */
function collectOverlayEnvVars(files, appDir) {
  const vars = new Set();
  for (const relative of files) {
    const filePath = path.join(appDir, relative);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    if (content.includes("\0")) continue; // binary — never scan or rename
    if (relative === ".env.example") {
      for (const rawLine of content.split("\n")) {
        const match = /^([A-Z][A-Z0-9_]+)\s*=/.exec(rawLine.trim());
        if (match) vars.add(match[1]);
      }
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) continue;
    for (const pattern of ENV_READ_PATTERNS) {
      for (const match of content.matchAll(pattern)) vars.add(match[1]);
    }
    if (relative === path.join("agent", "lib", "env.ts")) {
      for (const match of content.matchAll(ENV_SCHEMA_KEY_PATTERN)) {
        vars.add(match[1]);
      }
    }
  }
  return vars;
}

/**
 * Plans old -> new renames for app-specific vars that do not carry the
 * `<APP>_` prefix. To avoid double-prefixing, a detected legacy prefix is
 * REPLACED with the app prefix; legacy prefixes are (a) the constantCase item
 * name and (b) any leading prefix of >= 2 SCREAMING tokens shared by >= 2 of
 * the app-specific vars (e.g. DATA_ANALYST_). Everything else gets the app
 * prefix PREPENDED verbatim.
 */
function planEnvPrefixRenames({ vars, appName, itemName }) {
  const appPrefix = `${constantCase(appName)}_`;
  const appSpecific = [...vars].filter((name) => !isSharedEnvVar(name)).sort();
  const toRename = appSpecific.filter((name) => !name.startsWith(appPrefix));

  const candidates = new Set();
  const itemPrefix = `${constantCase(itemName)}_`;
  if (itemPrefix !== appPrefix) candidates.add(itemPrefix);
  const prefixCounts = new Map();
  for (const name of appSpecific) {
    const tokens = name.split("_");
    // Leading prefixes of >= 2 tokens that still leave a non-empty suffix.
    for (let i = 2; i < tokens.length; i++) {
      const prefix = `${tokens.slice(0, i).join("_")}_`;
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }
  for (const [prefix, count] of prefixCounts) {
    if (count >= 2 && prefix !== appPrefix) candidates.add(prefix);
  }
  // Candidate choice when several match a var: prefer the LONGEST candidate
  // whose tokens are a contiguous fragment of the app prefix — that is the
  // "same name, different casing/subset" case where replacement reads best
  // (X_HOT_TOPIC_HANDLES -> X_HOT_TOPIC_DIGEST_HANDLES, DATA_ANALYST_URL ->
  // POSTGRES_DATA_ANALYST_URL). Otherwise fall back to the SHORTEST match,
  // which keeps the most of the original name.
  const byLength = [...candidates].sort((a, b) => a.length - b.length);
  const appTokens = appPrefix.split("_").filter(Boolean);
  const isAppFragment = (prefix) => {
    const tokens = prefix.split("_").filter(Boolean);
    return appTokens.some(
      (_, start) =>
        tokens.length <= appTokens.length - start &&
        tokens.every((token, i) => token === appTokens[start + i]),
    );
  };

  const renames = new Map();
  const taken = new Set(appSpecific.filter((name) => !toRename.includes(name)));
  for (const name of toRename) {
    const matching = byLength.filter(
      (prefix) => name.startsWith(prefix) && name.length > prefix.length,
    );
    const legacy = matching.findLast(isAppFragment) ?? matching[0];
    let next = legacy
      ? appPrefix + name.slice(legacy.length)
      : appPrefix + name;
    if (taken.has(next)) next = appPrefix + name; // collision -> plain prepend
    renames.set(name, next);
    taken.add(next);
  }
  return renames;
}

/**
 * Applies the renames as word-boundary replacements across the given app
 * files (code, markdown, .env.example alike — env schema keys, reads, and
 * error-message strings all rename consistently). SCREAMING_SNAKE names are
 * single regex "words", so replacements never hit longer var names.
 */
function applyEnvRenames(renames, files, appDir) {
  if (renames.size === 0) return;
  for (const relative of files) {
    const filePath = path.join(appDir, relative);
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, "utf8");
    if (content.includes("\0")) continue; // binary — leave untouched
    let next = content;
    for (const [oldName, newName] of renames) {
      next = next.replace(new RegExp(`\\b${oldName}\\b`, "g"), newName);
    }
    if (next !== content) writeFileSync(filePath, next);
  }
}

// ---------------------------------------------------------------------------
// agent.ts model rewiring

/** A whole line of the form `  model: "provider/model",` (either quote style). */
const MODEL_LINE = /^([ \t]+)model:\s*(["'])([^"'\n]+)\2\s*,?[ \t]*$/m;

/**
 * Transforms a registry-authored `model: "<id>"` into the evalModel pattern
 * from apps/code-reviewer/agent/agent.ts, preserving every other property.
 * Returns the rewired source, or undefined when no safe anchor exists.
 */
function transformAgentSource(source) {
  if (!source.includes("defineAgent(")) return undefined;
  if (source.includes("evalModel(")) return source; // already wired
  const matches = [...source.matchAll(new RegExp(MODEL_LINE, "gm"))];
  if (matches.length !== 1) return undefined;

  const [line, indent, , modelId] = matches[0];
  const replacement = [
    `${indent}// Production: the gateway model id. EVE_MOCK_MODEL=1 (eval:ci): recorded`,
    `${indent}// fixtures, falling back to the deterministic mock below — the scaffold's`,
    `${indent}// ci-tagged smoke eval asserts on its exact reply. See @repo/eval-fixtures.`,
    `${indent}model: evalModel({`,
    // eslint-style escapes: this is source text for the generated file.
    `${indent}  mock: ({ lastUserMessage }) => \`MOCK_REPLY: \${lastUserMessage}\`,`,
    `${indent}  production: "${modelId}",`,
    `${indent}}),`,
    `${indent}// Fixture models are not in the AI Gateway model catalog, so eve cannot`,
    `${indent}// look up their context window; supply one while a fixture is active.`,
    `${indent}...(isEvalModelActive() ? { modelContextWindowTokens: 200_000 } : {}),`,
  ].join("\n");

  const rewired = source.replace(line, replacement);
  return `import { evalModel, isEvalModelActive } from "@repo/eval-fixtures";\n${rewired}`;
}

/**
 * Writes the (transformed) registry agent.ts. When the conservative transform
 * finds no safe anchor, the scaffold's already-wired agent.ts is kept so
 * `pnpm verify` stays green, and the registry version is saved alongside it
 * as agent/agent.ts.registry for manual merging.
 */
function rewireAgentModel(registrySource, appDir, appName) {
  if (registrySource === undefined) {
    return { mode: "scaffold" }; // item ships no agent.ts; scaffold's is fine
  }
  const agentTsPath = path.join(appDir, "agent", "agent.ts");
  const transformed = transformAgentSource(registrySource);
  if (transformed !== undefined) {
    writeFileSync(agentTsPath, transformed);
    return { mode: "rewired" };
  }

  const asidePath = path.join(appDir, "agent", "agent.ts.registry");
  writeFileSync(asidePath, registrySource);
  console.warn(
    [
      "",
      "WARNING: could not automatically rewire the registry agent.ts (no simple",
      `string \`model:\` property found). Kept the scaffold's agent/agent.ts so the`,
      "ci-tagged smoke eval and `pnpm verify` stay green, and saved the registry",
      `version to apps/${appName}/agent/agent.ts.registry.`,
      "",
      "TODO for you:",
      `  1. Merge apps/${appName}/agent/agent.ts.registry into agent/agent.ts,`,
      "     keeping the evalModel({ mock, production }) wiring for the model",
      "     property (see apps/code-reviewer/agent/agent.ts for the pattern).",
      `  2. Delete apps/${appName}/agent/agent.ts.registry.`,
      `  3. Re-run: pnpm --filter ${appName} run eval:ci`,
      "",
    ].join("\n"),
  );
  return { mode: "manual" };
}

// ---------------------------------------------------------------------------
// Dependency merging

/** The `catalog:` section of pnpm-workspace.yaml as { name: versionSpec }. */
function readCatalog() {
  const lines = readFileSync(
    path.join(ROOT, "pnpm-workspace.yaml"),
    "utf8",
  ).split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "catalog:");
  if (start === -1) return {};
  const catalog = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // dedent: section over
    const match = /^\s+"?([^\s:"]+)"?:\s*"?([^\s"]+)"?\s*$/.exec(line);
    if (match) catalog[match[1]] = match[2];
  }
  return catalog;
}

/** "pkg@range" (scoped or not) -> { name, range }. */
function parseDependency(dep) {
  const at = dep.lastIndexOf("@");
  if (at <= 0) return { name: dep, range: "*" };
  return { name: dep.slice(0, at), range: dep.slice(at + 1) };
}

/**
 * Minimal semver-range comparison, enough for catalog-drift warnings.
 * Supports exact versions, ^, ~, >=, and x-ranges (1.x / 1.2.x / bare 1).
 * Returns [min, maxExclusive|undefined] as numeric triples, or undefined
 * when the spec is not one of those forms.
 */
function rangeToInterval(spec) {
  const range = spec.trim();
  if (range === "*" || range === "x") return [[0, 0, 0], undefined];

  const parse = (text) => {
    const match = /^(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?(?:-[\w.-]+)?$/.exec(text);
    if (!match) return undefined;
    return [match[1], match[2], match[3]];
  };
  const bump = ([major, minor, patch], level) =>
    level === 0
      ? [major + 1, 0, 0]
      : level === 1
        ? [major, minor + 1, 0]
        : [major, minor, patch + 1];
  const nums = ([major, minor, patch]) => [
    Number(major),
    Number(minor ?? 0),
    Number(patch ?? 0),
  ];

  const operator = /^([\^~]|>=)?(.*)$/.exec(range);
  const parts = parse(operator[2]);
  if (!parts) return undefined;
  const [, minor, patch] = parts;
  const min = nums(parts.map((part) => (part === "x" ? "0" : part)));

  if (operator[1] === ">=") return [min, undefined];
  if (operator[1] === "^") {
    const level = min[0] > 0 ? 0 : min[1] > 0 ? 1 : 2;
    return [min, bump(min, level)];
  }
  if (operator[1] === "~") return [min, bump(min, 1)];
  // No operator: exact version or x-range (24.x, 1.2.x, bare "24").
  if (minor === undefined || minor === "x") return [min, bump(min, 0)];
  if (patch === undefined || patch === "x") return [min, bump(min, 1)];
  return [min, nums(parts)]; // exact: max inclusive == min; handled below
}

function compareTriples(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** True / false when decidable, undefined when either spec is unsupported. */
function rangesIntersect(specA, specB) {
  const a = rangeToInterval(specA);
  const b = rangeToInterval(specB);
  if (!a || !b) return undefined;
  const startsBeforeEnds = (x, y) => {
    if (y[1] === undefined) return true;
    // Exact versions carry max === min (inclusive); ranges are exclusive.
    const inclusive = compareTriples(y[0], y[1]) === 0;
    const cmp = compareTriples(x[0], y[1]);
    return inclusive ? cmp <= 0 : cmp < 0;
  };
  return startsBeforeEnds(a, b) && startsBeforeEnds(b, a);
}

/**
 * Merges item dependencies into apps/<name>/package.json. Catalog-managed
 * packages become "catalog:" (with a drift warning when the item's range
 * does not intersect the catalog version); everything else keeps the item's
 * range — app-specific deps are allowed per docs/conventions.md.
 */
function mergeDependencies(item, appDir) {
  const pkgPath = path.join(appDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const catalog = readCatalog();
  const mappings = [];
  const warnings = [];
  const appSpecific = [];

  for (const dep of item.dependencies ?? []) {
    const { name, range } = parseDependency(dep);
    if (name in catalog) {
      pkg.dependencies[name] = "catalog:";
      mappings.push(`${name}@${range} -> catalog: (${catalog[name]})`);
      const intersects = rangesIntersect(range, catalog[name]);
      if (intersects === false) {
        warnings.push(
          `${name}: the item was authored against ${name}@${range}, but the workspace ` +
            `catalog pins ${catalog[name]} (no overlap). The item's code may target ` +
            `older ${name} APIs — review it against the current docs before shipping.`,
        );
      } else if (intersects === undefined) {
        warnings.push(
          `${name}: could not compare the item's range (${range}) with the catalog ` +
            `version (${catalog[name]}) — verify compatibility manually.`,
        );
      }
    } else if (pkg.dependencies[name] === undefined) {
      pkg.dependencies[name] = range;
      mappings.push(`${name}@${range} -> kept as-is (app-specific)`);
      appSpecific.push(name);
    } else {
      mappings.push(`${name}@${range} -> already ${pkg.dependencies[name]}`);
    }
  }

  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return { appSpecific, mappings, warnings };
}

/** True when the installed package ships its own type declarations. */
function packageShipsTypes(pkgDir) {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(pkgDir, "package.json"), "utf8"),
    );
    if (pkg.types || pkg.typings) return true;
    if (pkg.exports && JSON.stringify(pkg.exports).includes('"types"')) {
      return true;
    }
    return existsSync(path.join(pkgDir, "index.d.ts"));
  } catch {
    return true; // cannot tell — do not add @types speculatively
  }
}

/**
 * For app-specific deps that ship no type declarations (typecheck would fail
 * under this repo's strict tsconfig), adds the matching `@types/<pkg>` as a
 * devDependency when one exists on npm. Returns the added package specs;
 * the caller re-runs pnpm install when the list is non-empty.
 */
async function addMissingTypePackages(appDir, depNames) {
  const pkgPath = path.join(appDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const added = [];

  for (const name of depNames) {
    const installed = path.join(appDir, "node_modules", ...name.split("/"));
    if (!existsSync(installed) || packageShipsTypes(installed)) continue;
    const typesName = `@types/${
      name.startsWith("@") ? name.slice(1).replace("/", "__") : name
    }`;
    if (pkg.devDependencies?.[typesName]) continue;
    let version;
    try {
      const { json } = await fetchJson(
        `https://registry.npmjs.org/${typesName.replace("/", "%2f")}/latest`,
      );
      version = json?.version;
    } catch {
      // npm registry unreachable — tsc will point at the gap with the same fix.
    }
    if (typeof version !== "string") {
      console.warn(
        `  WARNING: ${name} ships no type declarations and no ${typesName} was found — typecheck may fail.`,
      );
      continue;
    }
    pkg.devDependencies[typesName] = `^${version}`;
    added.push(`${typesName}@^${version}`);
  }

  if (added.length > 0) {
    pkg.devDependencies = Object.fromEntries(
      Object.entries(pkg.devDependencies).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    );
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return added;
}

// ---------------------------------------------------------------------------
// Env contract (mirrors scripts/check-env-contract.mjs — keep the shapes in
// sync; not imported so agent:add stays self-contained)

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
const ENV_ALLOWLIST = [
  "EVE_MOCK_MODEL",
  "EVE_RECORD_FIXTURES",
  "NODE_ENV",
  "CI",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_OIDC_TOKEN",
  "PORT",
  "TURBO_*",
];
const ENV_READ_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]+)\b/g,
  /process\.env\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g,
  /\brequireEnv\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g,
];
const ENV_SCHEMA_KEY_PATTERN = /^\s*"?([A-Z][A-Z0-9_]+)"?:\s*z\./gm;

function isEnvAllowlisted(name) {
  return ENV_ALLOWLIST.some((entry) =>
    entry.endsWith("*") ? name.startsWith(entry.slice(0, -1)) : name === entry,
  );
}

function* walkSources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        yield* walkSources(path.join(dir, entry.name));
      }
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

/**
 * Appends any env vars the app's sources read but .env.example does not
 * declare, so the repo-wide env-contract gate stays green.
 */
function reconcileEnvContract(appDir, itemName) {
  const envExamplePath = path.join(appDir, ".env.example");
  const declared = new Set();
  let envExample = "";
  if (existsSync(envExamplePath)) {
    envExample = readFileSync(envExamplePath, "utf8");
    for (const rawLine of envExample.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("#")) continue;
      const match = /^([A-Z][A-Z0-9_]+)\s*=/.exec(line);
      if (match) declared.add(match[1]);
    }
  }

  const read = new Set();
  for (const file of walkSources(appDir)) {
    const source = readFileSync(file, "utf8");
    for (const pattern of ENV_READ_PATTERNS) {
      for (const match of source.matchAll(pattern)) read.add(match[1]);
    }
    if (file === path.join(appDir, "agent", "lib", "env.ts")) {
      for (const match of source.matchAll(ENV_SCHEMA_KEY_PATTERN)) {
        read.add(match[1]);
      }
    }
  }

  const missing = [...read]
    .filter((name) => !declared.has(name) && !isEnvAllowlisted(name))
    .sort();
  if (missing.length === 0) return [];

  const block = [
    `# From ${itemName} (added by agent:add — fill in real values)`,
    ...missing.map((name) => `${name}=`),
    "",
  ].join("\n");
  const separator = envExample === "" || envExample.endsWith("\n") ? "" : "\n";
  writeFileSync(envExamplePath, `${envExample}${separator}\n${block}`);
  return missing;
}

// ---------------------------------------------------------------------------
// Shell helpers

function run(command, args, { allowFailure = false } = {}) {
  try {
    execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
    return true;
  } catch (error) {
    if (allowFailure) return false;
    throw new UserError(
      `Command failed: ${command} ${args.join(" ")}\n${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main

function usage() {
  return [
    "Usage: pnpm agent:add <spec> [name] [--yes]",
    "       pnpm agent:add --from-file <path> [name] [--yes]",
    "",
    "  <spec>           @evex/<item>, <item> (defaults to @evex), or an item URL",
    "  [name]           app name override (kebab-case; defaults to the item name)",
    "  --yes, -y        skip the confirmation prompt",
    "  --from-file      read the registry item JSON from a local file",
    "  --no-env-prefix  keep the item's env var names (skip <APP>_ prefix renames)",
  ].join("\n");
}

async function loadItem(values, positionals) {
  if (values["from-file"]) {
    const filePath = path.resolve(values["from-file"]);
    let item;
    try {
      item = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new UserError(
        `Could not read item JSON from ${filePath}: ${error.message}`,
      );
    }
    validateItem(item);
    return { item, nameOverride: positionals[0] };
  }

  const spec = positionals[0];
  if (!spec) throw new UserError(usage());
  const { url, itemName, indexUrl } = parseSpec(spec);
  const { status, json } = await fetchJson(url);
  if (status === 404) throw await unknownItemError(itemName, indexUrl);
  if (json === undefined) {
    throw new UserError(`Fetching ${url} failed with HTTP ${status}.`);
  }
  validateItem(json);
  return { item: json, nameOverride: positionals[1] };
}

async function confirm(item, appName) {
  console.log(`\n${item.title ?? item.name} -> apps/${appName}`);
  if (item.description) console.log(`  ${item.description}`);
  console.log(
    `  ${item.files.length} files, ${(item.dependencies ?? []).length} dependencies\n`,
  );
  if (!process.stdin.isTTY) {
    throw new UserError(
      "Not a TTY — pass --yes to skip the confirmation prompt.",
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Install? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    throw new UserError("Aborted.");
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "from-file": { type: "string" },
      "no-env-prefix": { type: "boolean" },
      yes: { short: "y", type: "boolean" },
    },
  });

  const { item, nameOverride } = await loadItem(values, positionals);
  const appName = nameOverride ?? item.name;

  if (!KEBAB_CASE.test(appName)) {
    throw new UserError(
      `App name "${appName}" is not kebab-case (lowercase letters, digits, single hyphens).`,
    );
  }
  const appDir = path.join(APPS_DIR, appName);
  if (existsSync(appDir)) {
    throw new UserError(
      `apps/${appName} already exists — pass a different [name], e.g. pnpm agent:add ${item.name} my-${appName}.`,
    );
  }
  // Fail fast on malicious targets before scaffolding anything.
  for (const file of item.files) resolveTarget(file.target, appDir);

  if (!values.yes) await confirm(item, appName);

  // 1. Base scaffold via the repo generator (the only blessed way to create
  // an app). The description feeds package.json, which rejects `"` and `\`.
  const description =
    (item.description ?? item.title ?? appName).replace(/["\\]/g, "").trim() ||
    appName;
  console.log(`\n[1/7] Scaffolding apps/${appName} (turbo gen agent)...`);
  run("pnpm", [
    "exec",
    "turbo",
    "gen",
    "agent",
    "--args",
    appName,
    description,
    "http-only",
  ]);

  // 2. Overlay the registry files (registry wins, protected files excepted).
  console.log("\n[2/7] Overlaying registry files...");
  const overlay = overlayFiles(item, appDir);
  console.log(
    `  ${overlay.written.length} new file(s), ${overlay.overwritten.length} scaffold file(s) replaced.`,
  );
  for (const skipped of overlay.skipped) {
    console.warn(
      `  WARNING: skipped registry ${skipped} — scaffold config files are never overwritten (dependencies are merged instead).`,
    );
  }
  const rewire = rewireAgentModel(overlay.agentTsContent, appDir, appName);
  if (rewire.mode === "rewired") {
    console.log(
      "  agent/agent.ts: rewired model through @repo/eval-fixtures' evalModel.",
    );
  }
  const extensionFixes = fixRelativeImportExtensions(
    [...overlay.written, ...overlay.overwritten],
    appDir,
  );
  if (extensionFixes.length > 0) {
    console.log(
      `  Added .js to extensionless relative imports (nodenext) in: ${extensionFixes.join(", ")}`,
    );
  }

  // 3. Env-prefix enforcement over the overlaid files (plus .env.example and
  // the agent.ts variants those steps produced). Scaffold-only files already
  // follow the convention and are left alone.
  console.log("\n[3/7] Enforcing the env-prefix convention...");
  const overlaidFiles = [
    ...new Set([
      ...overlay.written,
      ...overlay.overwritten,
      ...(overlay.agentTsContent !== undefined
        ? [path.join("agent", "agent.ts")]
        : []),
      ...(rewire.mode === "manual"
        ? [path.join("agent", "agent.ts.registry")]
        : []),
      ".env.example",
    ]),
  ];
  let envRenames = new Map();
  if (values["no-env-prefix"]) {
    console.log("  Skipped (--no-env-prefix): env var names kept as authored.");
  } else {
    envRenames = planEnvPrefixRenames({
      appName,
      itemName: item.name,
      vars: collectOverlayEnvVars(overlaidFiles, appDir),
    });
    applyEnvRenames(envRenames, overlaidFiles, appDir);
    if (envRenames.size === 0) {
      console.log(
        "  No renames needed — the item's env vars already conform (or are shared).",
      );
    } else {
      for (const [oldName, newName] of envRenames) {
        console.log(`  ${oldName} -> ${newName}`);
      }
    }
  }

  // 4. Merge dependencies.
  console.log("\n[4/7] Merging dependencies...");
  const deps = mergeDependencies(item, appDir);
  for (const mapping of deps.mappings) console.log(`  ${mapping}`);
  for (const warning of deps.warnings) console.warn(`\n  WARNING: ${warning}`);

  // 5. Env contract.
  console.log("\n[5/7] Reconciling the env contract...");
  const appendedVars = reconcileEnvContract(appDir, item.name);
  console.log(
    appendedVars.length > 0
      ? `  Appended to .env.example: ${appendedVars.join(", ")}`
      : "  .env.example already declares every env var the app reads.",
  );

  // 6. Install + format (registry content is not Biome-formatted).
  console.log("\n[6/7] pnpm install + Biome auto-fix...");
  run("pnpm", ["install"]);
  const typePackages = await addMissingTypePackages(appDir, deps.appSpecific);
  if (typePackages.length > 0) {
    console.log(
      `  Added type packages for untyped deps: ${typePackages.join(", ")}`,
    );
    run("pnpm", ["install"]);
  }
  // Registry content can export more than it uses; knip (part of pnpm verify)
  // flags that. Strip unused exports in this app only, then format.
  run(
    "pnpm",
    [
      "exec",
      "knip",
      "--workspace",
      `apps/${appName}`,
      "--fix",
      "--no-config-hints",
    ],
    { allowFailure: true }, // anything unfixable surfaces in pnpm verify
  );
  run("pnpm", ["exec", "biome", "check", "--write", `apps/${appName}`], {
    allowFailure: true, // unfixable diagnostics surface in the lint step below
  });

  // 7. Fast verify for this app (build runs via eval:ci's task dependency).
  console.log(
    `\n[7/7] Verifying (lint + typecheck + eval:ci for ${appName})...`,
  );
  const verified = run(
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "lint",
      "typecheck",
      "eval:ci",
      "--filter",
      appName,
    ],
    { allowFailure: true },
  );
  if (!verified) {
    throw new UserError(
      [
        `Verification failed for apps/${appName}. The app was left in place so you`,
        "can inspect and fix it; to undo instead:",
        `  rm -rf apps/${appName} && git checkout -- pnpm-lock.yaml && pnpm install`,
      ].join("\n"),
    );
  }

  // Summary.
  console.log(
    [
      "",
      `Installed "${item.title ?? item.name}" into apps/${appName}.`,
      "",
      ...(values["no-env-prefix"]
        ? [
            "Env-prefix enforcement was skipped (--no-env-prefix); the item's env",
            "var names were kept as authored.",
            "",
          ]
        : envRenames.size > 0
          ? [
              `Env vars renamed to the ${constantCase(appName)}_ prefix (AGENTS.md rule 3):`,
              ...[...envRenames].map(
                ([oldName, newName]) => `  ${oldName} -> ${newName}`,
              ),
              "",
            ]
          : [
              "No env vars were renamed — the item already follows the env-prefix",
              "convention (or only reads shared platform vars).",
              "",
            ]),
      "Dependency mappings:",
      ...deps.mappings.map((mapping) => `  ${mapping}`),
      ...(deps.warnings.length > 0
        ? ["", "Warnings:", ...deps.warnings.map((warning) => `  ${warning}`)]
        : []),
      ...(appendedVars.length > 0
        ? [
            "",
            "Env vars appended to .env.example (fill in real values):",
            ...appendedVars.map((name) => `  ${name}`),
          ]
        : []),
      ...(rewire.mode === "manual"
        ? [
            "",
            `TODO: merge apps/${appName}/agent/agent.ts.registry into agent/agent.ts`,
            "(see the warning above).",
          ]
        : []),
      "",
      "Next steps:",
      `  cp apps/${appName}/.env.example apps/${appName}/.env.local   # then fill in values`,
      `  pnpm --filter ${appName} dev`,
      `  pnpm verify`,
    ].join("\n"),
  );
}

main().catch((error) => {
  if (error instanceof UserError) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
  console.error("\nagent:add failed unexpectedly:", error);
  process.exit(2);
});
