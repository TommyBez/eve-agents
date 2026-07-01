#!/usr/bin/env node
// Eve upgrade automation (AGENTS.md hard rules 1 and 7).
//
// Bumps the `eve:` entry in the pnpm-workspace.yaml catalog (rule 1: versions
// live only there), reinstalls, prints the CHANGELOG delta since the previous
// installed version, re-validates every doc path referenced by
// .agents/skills/eve/SKILL.md against the freshly installed
// node_modules/eve/docs/ tree (rule 7), and runs the verification loop.
//
// Usage: node scripts/upgrade-eve.mjs [version] [--dry-run] [--no-verify]
//
// Exit codes: 0 = success, 1 = failure (missing skill doc paths, failed
// install, failed verify), 2 = unexpected error.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_YAML = path.join(ROOT, "pnpm-workspace.yaml");
const SKILL_MD = path.join(ROOT, ".agents/skills/eve/SKILL.md");
const PRIMARY_EVE = path.join(ROOT, "apps/code-reviewer/node_modules/eve");

// Backticked spans in SKILL.md that look like doc paths but are agent-slot
// filenames mentioned in prose (the docs ship instructions.mdx, and the
// *agent* directory holds instructions.md). Never checked against docs/.
const NON_DOC_SPANS = new Set(["instructions.md", "agent.ts", "SKILL.md"]);

/** Locate the installed eve package: code-reviewer first, then any app. */
function findInstalledEve() {
  const candidates = [PRIMARY_EVE];
  const appsDir = path.join(ROOT, "apps");
  for (const app of fs.readdirSync(appsDir)) {
    candidates.push(path.join(appsDir, app, "node_modules/eve"));
  }
  for (const dir of candidates) {
    const pkg = path.join(dir, "package.json");
    if (!fs.existsSync(pkg)) continue;
    return {
      dir,
      version: JSON.parse(fs.readFileSync(pkg, "utf8")).version,
      docsDir: path.join(dir, "docs"),
      changelog: path.join(dir, "CHANGELOG.md"),
    };
  }
  throw new Error(
    "no installed eve package found under apps/*/node_modules/eve — run `pnpm install` first",
  );
}

/** The `  eve: <range>` line inside the catalog section (exactly one). */
const CATALOG_EVE_LINE = /^( {2}eve: )(\S+)[ \t]*$/gm;

function readCatalogRange() {
  const source = fs.readFileSync(WORKSPACE_YAML, "utf8");
  const matches = [...source.matchAll(CATALOG_EVE_LINE)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one "  eve: " line in pnpm-workspace.yaml, found ${matches.length}`,
    );
  }
  return matches[0][2];
}

/** Rewrite only the catalog `eve:` line, preserving everything else. */
function rewriteCatalog(target) {
  const source = fs.readFileSync(WORKSPACE_YAML, "utf8");
  const matches = [...source.matchAll(CATALOG_EVE_LINE)];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one "  eve: " line in pnpm-workspace.yaml, found ${matches.length}`,
    );
  }
  fs.writeFileSync(
    WORKSPACE_YAML,
    source.replace(CATALOG_EVE_LINE, `$1^${target}`),
  );
}

function normalizeVersion(raw) {
  const version = raw.replace(/^[\^~]/, "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw new Error(`"${raw}" is not an exact semver version (e.g. 0.18.0)`);
  }
  return version;
}

function compareVersions(a, b) {
  const parse = (v) => v.split("-")[0].split(".").map(Number);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function latestFromNpm() {
  return execFileSync("npm", ["view", "eve", "version"], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

/**
 * Extract the doc paths SKILL.md references (relative to
 * node_modules/eve/docs/): backticked `*.md`/`*.mdx` spans in the body, plus
 * any explicit `node_modules/eve/docs/...` references. Placeholders (`<...>`)
 * and globs are skipped.
 */
function skillDocPaths() {
  const body = fs
    .readFileSync(SKILL_MD, "utf8")
    .replace(/^---\n[\s\S]*?\n---\n/, "") // YAML frontmatter
    .replace(/^```[\s\S]*?^```$/gm, ""); // fenced code blocks
  const paths = new Set();
  for (const [, span] of body.matchAll(/`([^`]+)`/g)) {
    if (/[<>*\s]/.test(span)) continue;
    const prefixed = /(?:^|\/)node_modules\/eve\/docs\/(.+)$/.exec(span);
    if (prefixed) {
      paths.add(prefixed[1].replace(/\/$/, ""));
    } else if (/^[\w.][\w./-]*\.mdx?$/.test(span) && !NON_DOC_SPANS.has(span)) {
      paths.add(span);
    }
  }
  return [...paths].sort();
}

/** Missing-path report for the skill index against an installed docs dir. */
function validateSkill(docsDir) {
  const paths = skillDocPaths();
  const missing = paths.filter((p) => !fs.existsSync(path.join(docsDir, p)));
  return { checked: paths.length, missing };
}

/**
 * Everything in CHANGELOG.md above the previous version's `## <version>`
 * heading, i.e. all sections newer than what was installed.
 */
function changelogDelta(changelogPath, previousVersion) {
  const text = fs.readFileSync(changelogPath, "utf8");
  const firstHeading = text.search(/^## /m);
  if (firstHeading === -1) return { delta: null, found: false };
  const previousHeading = new RegExp(
    `^## ${previousVersion.replaceAll(".", "\\.")}\\s*$`,
    "m",
  ).exec(text);
  if (!previousHeading) {
    // Previous version not in this changelog — print the newest section only.
    const next = text.indexOf("\n## ", firstHeading + 1);
    return {
      delta: text.slice(firstHeading, next === -1 ? undefined : next).trimEnd(),
      found: false,
    };
  }
  return {
    delta: text.slice(firstHeading, previousHeading.index).trimEnd(),
    found: true,
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 2;
}

function heading(title) {
  console.log(`\n=== ${title} ===`);
}

function reportSkill(result, failures) {
  heading("Skill index validation (.agents/skills/eve/SKILL.md)");
  if (result.missing.length === 0) {
    console.log(`All ${result.checked} referenced doc paths exist.`);
  } else {
    console.error(
      `${result.missing.length} of ${result.checked} referenced doc paths are missing:`,
    );
    for (const p of result.missing) {
      console.error(`  - node_modules/eve/docs/${p}`);
    }
    console.error(
      "\nDocs moved between releases. Update .agents/skills/eve/SKILL.md against the" +
        "\nnew node_modules/eve/docs/meta.json in the same change (AGENTS.md rule 7).",
    );
    failures.push("skill index references missing doc paths");
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const noVerify = args.includes("--no-verify");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length > 1) {
    throw new Error(
      "usage: node scripts/upgrade-eve.mjs [version] [--dry-run] [--no-verify]",
    );
  }

  const installed = findInstalledEve();
  const catalogRange = readCatalogRange();
  const target = positional[0]
    ? normalizeVersion(positional[0])
    : latestFromNpm();

  console.log(`eve installed: ${installed.version} (catalog: ${catalogRange})`);
  console.log(`eve target:    ${target}`);

  const failures = [];
  const warnings = [];

  // Same version: nothing to install, but the skill index can drift
  // independently of upgrades, so still validate it.
  if (target === installed.version) {
    console.log("\neve is already up to date.");
    reportSkill(validateSkill(installed.docsDir), failures);
    if (failures.length > 0) process.exitCode = 1;
    return;
  }

  const direction =
    compareVersions(target, installed.version) < 0 ? "downgrade" : "upgrade";

  if (dryRun) {
    heading("Dry run — no changes made");
    console.log(`Would ${direction} eve ${installed.version} -> ${target}:`);
    console.log(
      `  1. rewrite the catalog \`eve:\` entry in pnpm-workspace.yaml to ^${target}`,
    );
    console.log("  2. run `pnpm install`");
    console.log(
      "  3. print the CHANGELOG delta (requires the install — npm does not" +
        "\n     expose changelogs, so the delta is only available after step 2)",
    );
    console.log(
      "  4. validate .agents/skills/eve/SKILL.md doc paths against the new docs",
    );
    console.log(
      noVerify
        ? "  5. skip `pnpm verify` and the scaffold drift check (--no-verify)"
        : "  5. run `pnpm verify` and `node scripts/check-scaffold-drift.mjs`",
    );
    return;
  }

  heading(`Rewriting catalog: eve ${catalogRange} -> ^${target}`);
  rewriteCatalog(target);
  console.log("pnpm-workspace.yaml updated.");

  heading("pnpm install");
  if (run("pnpm", ["install"]) !== 0) {
    failures.push("pnpm install failed (pnpm-workspace.yaml was rewritten)");
    console.error(
      "\npnpm install failed. Fix the install, or revert with:" +
        "\n  git checkout -- pnpm-workspace.yaml pnpm-lock.yaml && pnpm install",
    );
    process.exitCode = 1;
    return;
  }

  const upgraded = findInstalledEve();
  console.log(`Installed eve ${upgraded.version}.`);
  if (upgraded.version !== target) {
    warnings.push(
      `catalog ^${target} resolved to ${upgraded.version}, not ${target} exactly`,
    );
  }

  heading(`CHANGELOG delta (${installed.version} -> ${upgraded.version})`);
  let changelogNote = "skipped";
  if (direction === "downgrade") {
    console.log("Downgrade — no new changelog sections to show.");
  } else {
    const { delta, found } = changelogDelta(
      upgraded.changelog,
      installed.version,
    );
    if (delta === null) {
      warnings.push(
        "could not parse CHANGELOG.md — no `## <version>` headings",
      );
      changelogNote = "unparseable";
    } else {
      if (!found) {
        warnings.push(
          `previous version ${installed.version} not found in CHANGELOG.md; printed the newest section only`,
        );
      }
      console.log(delta);
      changelogNote = found ? "printed" : "partial (newest section only)";
    }
  }

  const skill = validateSkill(upgraded.docsDir);
  reportSkill(skill, failures);

  let verifyNote = "skipped (--no-verify)";
  let driftNote = "skipped (--no-verify)";
  if (!noVerify) {
    heading("pnpm verify");
    if (run("pnpm", ["verify"]) === 0) {
      verifyNote = "passed";
    } else {
      verifyNote = "FAILED";
      failures.push("pnpm verify failed");
    }

    heading("Scaffold drift check");
    const driftStatus = run("node", ["scripts/check-scaffold-drift.mjs"]);
    if (driftStatus === 0) {
      driftNote = "clean";
    } else if (driftStatus === 1) {
      driftNote = "drift detected (warning — templates are updated separately)";
      warnings.push("scaffold drift detected");
    } else {
      driftNote = "errored (warning)";
      warnings.push("scaffold drift check errored");
    }
  }

  heading("Summary");
  console.log(`  version:    eve ${installed.version} -> ${upgraded.version}`);
  console.log(`  changelog:  ${changelogNote}`);
  console.log(
    `  skill docs: ${
      skill.missing.length === 0
        ? `${skill.checked} paths ok`
        : `${skill.missing.length} of ${skill.checked} paths MISSING`
    }`,
  );
  console.log(`  verify:     ${verifyNote}`);
  console.log(`  drift:      ${driftNote}`);
  for (const w of warnings) console.log(`  warning:    ${w}`);
  for (const f of failures) console.log(`  FAILURE:    ${f}`);

  console.log("\nNext steps:");
  if (skill.missing.length > 0) {
    console.log(
      "  - update .agents/skills/eve/SKILL.md for the moved doc paths above" +
        " and include it in the bump commit (AGENTS.md rule 7)",
    );
  }
  if (warnings.includes("scaffold drift detected")) {
    console.log(
      "  - update turbo/generators/templates/agent/ per the drift report",
    );
  }
  console.log(
    `  - commit: git add pnpm-workspace.yaml pnpm-lock.yaml && git commit -m "chore: bump eve ${installed.version} -> ${upgraded.version}"`,
  );

  if (failures.length > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error("upgrade-eve errored:", error.message ?? error);
  process.exitCode = 2;
}
