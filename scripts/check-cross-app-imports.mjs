#!/usr/bin/env node
/**
 * Fails when one app imports from another app (by relative path or by
 * package name). Apps must stay self-contained; shared code belongs in
 * packages/* (see AGENTS.md hard rules and docs/conventions.md).
 *
 * This is the fallback for `turbo boundaries`, which cannot gate CI today:
 * it flags eve-generated build output (.eve/nitro/**) whose imports reach
 * into node_modules, and offers no way to exclude generated files.
 * Upstream report: https://github.com/vercel/turborepo/discussions/9435
 * TODO(maintainer): replace with the filed issue URL once it exists, and
 * revisit `turbo boundaries` when generated output can be excluded.
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

// import "x" / from "x" / import("x") / require("x")
const SPECIFIER_PATTERN =
  /(?:\bimport\s*\(\s*|\brequire\s*\(\s*|\bfrom\s+|\bimport\s+)["']([^"']+)["']/g;

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

function findViolations(app, apps) {
  const appDir = path.join(APPS_DIR, app);
  const otherApps = apps.filter((name) => name !== app);
  const violations = [];

  for (const file of walk(appDir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1];
      const line = source.slice(0, match.index).split("\n").length;
      const at = `${path.relative(ROOT, file)}:${line}`;

      // Bare specifier naming a sibling app package.
      const sibling = otherApps.find(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      );
      if (sibling) {
        violations.push(`${at} imports app "${sibling}" via "${specifier}"`);
        continue;
      }

      // Relative specifier escaping this app into another app's directory.
      if (specifier.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), specifier);
        if (
          !resolved.startsWith(appDir + path.sep) &&
          resolved.startsWith(APPS_DIR + path.sep)
        ) {
          violations.push(
            `${at} escapes the app via "${specifier}" (resolves to ${path.relative(ROOT, resolved)})`,
          );
        }
      }
    }
  }

  return violations;
}

try {
  const apps = listApps();
  const violations = apps.flatMap((app) => findViolations(app, apps));

  if (violations.length > 0) {
    console.error("Cross-app import violations found:\n");
    for (const violation of violations) console.error(`  ${violation}`);
    console.error(
      "\nApps must not import from other apps. Extract shared code to packages/* (docs/conventions.md).",
    );
    process.exit(1);
  }

  console.log(`Cross-app import check passed (${apps.length} apps).`);
} catch (error) {
  console.error("check-cross-app-imports failed unexpectedly:", error);
  process.exit(2);
}
