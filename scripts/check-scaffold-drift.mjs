#!/usr/bin/env node
// Scaffold-drift guard (PLAN.md §4.3).
//
// Our `turbo gen agent` templates are checked-in copies of what `eve init`
// scaffolds. This script runs `eve init` into a temp dir with the workspace's
// eve version and compares the shape-defining content against our templates,
// so upstream scaffold changes surface as actionable drift instead of rot.
//
// Exit codes: 0 = clean, 1 = drift detected (report printed), 2 = error.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = path.join(ROOT, "turbo", "generators", "templates", "agent");

// Known, intentional differences between the eve scaffold and our templates.
// Every entry needs a reason. Anything not listed here is reported as drift.
const ALLOWED_DIFFERENCES = {
  // Repo-standard scripts the generator adds beyond the scaffold's set.
  extraScripts: ["eval", "eval:ci", "info", "lint", "test"],
  // Runtime deps we add beyond the scaffold's set (none today).
  extraDependencies: [],
  // Tooling we add: biome (lint), shared tsconfig package, vitest (tests).
  extraDevDependencies: ["@biomejs/biome", "@repo/typescript-config", "vitest"],
};

const drift = [];
const report = (section, message) => drift.push(`[${section}] ${message}`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Ordered auth factory names inside the eveChannel `auth: [...]` stack. */
function authStack(source) {
  const block = /auth:\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/(\w+)\(\)/g)].map((m) => m[1]);
}

/** Items of a top-level YAML string list, e.g. `minimumReleaseAgeExclude:`. */
function yamlList(file, key) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === `${key}:`);
  if (start === -1) return null;
  const items = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+-\s+"?([^"\s][^"]*)"?\s*$/.exec(line);
    if (!match) break;
    items.push(match[1]);
  }
  return items;
}

function compareSets(section, expected, actual, { allowedExtra = [] } = {}) {
  for (const item of expected.filter((i) => !actual.includes(i))) {
    report(
      section,
      `missing "${item}" (the eve scaffold has it, our template does not)`,
    );
  }
  const extras = actual.filter(
    (i) => !expected.includes(i) && !allowedExtra.includes(i),
  );
  for (const item of extras) {
    report(
      section,
      `unexpected "${item}" (not in the eve scaffold, not allowlisted)`,
    );
  }
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eve-scaffold-drift-"));
  const probe = path.join(tmp, "drift-probe");
  try {
    // eve is resolvable from apps/code-reviewer. `eve init` only accepts a
    // project *name* (not a path), so run it with cwd set to the temp dir —
    // outside the workspace, it scaffolds a standalone project.
    execFileSync(
      path.join(ROOT, "apps/code-reviewer/node_modules/.bin/eve"),
      ["init", "drift-probe"],
      {
        cwd: tmp,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 300_000,
      },
    );

    // 1. agent/channels/eve.ts — the auth stack must match factory-for-factory.
    const scaffoldAuth = authStack(
      fs.readFileSync(path.join(probe, "agent/channels/eve.ts"), "utf8"),
    );
    const templateAuth = authStack(
      fs.readFileSync(
        path.join(TEMPLATES, "agent/channels/eve.ts.hbs"),
        "utf8",
      ),
    );
    if (JSON.stringify(scaffoldAuth) !== JSON.stringify(templateAuth)) {
      report(
        "channels/eve.ts",
        `auth stack differs: scaffold [${scaffoldAuth}] vs template [${templateAuth}]`,
      );
    }

    // 2. tsconfig compilerOptions — ours live in @repo/typescript-config/base.json.
    const scaffoldTs =
      readJson(path.join(probe, "tsconfig.json")).compilerOptions ?? {};
    const baseTs =
      readJson(path.join(ROOT, "packages/typescript-config/base.json"))
        .compilerOptions ?? {};
    for (const key of new Set([
      ...Object.keys(scaffoldTs),
      ...Object.keys(baseTs),
    ])) {
      if (JSON.stringify(scaffoldTs[key]) !== JSON.stringify(baseTs[key])) {
        report(
          "tsconfig",
          `compilerOptions.${key}: scaffold ${JSON.stringify(scaffoldTs[key])} vs base.json ${JSON.stringify(baseTs[key])}`,
        );
      }
    }

    // 3. package.json — dependency NAMES and script NAMES (versions come from
    // the pnpm catalog by design, so values are not compared).
    const scaffoldPkg = readJson(path.join(probe, "package.json"));
    const templatePkg = readJson(path.join(TEMPLATES, "package.json.hbs"));
    compareSets(
      "package.json scripts",
      Object.keys(scaffoldPkg.scripts ?? {}),
      Object.keys(templatePkg.scripts ?? {}),
      {
        allowedExtra: ALLOWED_DIFFERENCES.extraScripts,
      },
    );
    compareSets(
      "package.json dependencies",
      Object.keys(scaffoldPkg.dependencies ?? {}),
      Object.keys(templatePkg.dependencies ?? {}),
      {
        allowedExtra: ALLOWED_DIFFERENCES.extraDependencies,
      },
    );
    compareSets(
      "package.json devDependencies",
      Object.keys(scaffoldPkg.devDependencies ?? {}),
      Object.keys(templatePkg.devDependencies ?? {}),
      {
        allowedExtra: ALLOWED_DIFFERENCES.extraDevDependencies,
      },
    );

    // 4. pnpm-workspace.yaml — the scaffold's minimumReleaseAgeExclude list
    // must match the root workspace's (we adopted it verbatim in Phase 1).
    const scaffoldExcludes =
      yamlList(
        path.join(probe, "pnpm-workspace.yaml"),
        "minimumReleaseAgeExclude",
      ) ?? [];
    const rootExcludes =
      yamlList(
        path.join(ROOT, "pnpm-workspace.yaml"),
        "minimumReleaseAgeExclude",
      ) ?? [];
    compareSets(
      "pnpm-workspace minimumReleaseAgeExclude",
      scaffoldExcludes,
      rootExcludes,
    );

    if (drift.length > 0) {
      console.error(
        `Scaffold drift detected (${drift.length} finding${drift.length === 1 ? "" : "s"}):\n`,
      );
      for (const line of drift) console.error(`  - ${line}`);
      console.error(
        "\nEither update turbo/generators/templates/agent/ (and packages/typescript-config," +
          "\npnpm-workspace.yaml where relevant) to match the new eve scaffold, or add an" +
          "\nentry to ALLOWED_DIFFERENCES in scripts/check-scaffold-drift.mjs with a reason.",
      );
      process.exitCode = 1;
    } else {
      console.log(
        "Scaffold drift check passed: templates match the eve scaffold.",
      );
    }
  } catch (error) {
    console.error("Scaffold drift check errored:", error.message ?? error);
    if (error.stderr) console.error(String(error.stderr).slice(-2000));
    process.exitCode = 2;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
