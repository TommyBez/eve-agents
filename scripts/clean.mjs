#!/usr/bin/env node
/**
 * Remove generated artifacts across the workspace.
 *
 *   pnpm clean             # build/dev output: .turbo, .eve, .next, .output,
 *                          # .source, .nitro, .workflow-data, dist, *.tsbuildinfo
 *   pnpm clean --modules   # …plus every node_modules (follow with `pnpm install`)
 *
 * Deliberately NOT `git clean -xdf`: that would also delete .env files and
 * anything else gitignored-but-precious. This only removes the known
 * generated directories, so local env files and eval fixtures survive.
 *
 * Dependency-free (node:* only) so it works even when node_modules is broken —
 * which is exactly when you need it.
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GENERATED_DIRS = [
  ".turbo",
  ".eve",
  ".next",
  ".output",
  ".source",
  ".nitro",
  ".workflow-data",
  "dist",
];

const { values: flags } = parseArgs({
  options: { modules: { type: "boolean", default: false } },
});

/** Workspace roots: repo root + every directory under apps/ and packages/. */
function workspaceDirs() {
  const dirs = [ROOT];
  for (const group of ["apps", "packages"]) {
    const groupDir = path.join(ROOT, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir)) {
      const dir = path.join(groupDir, entry);
      try {
        if (statSync(dir).isDirectory()) dirs.push(dir);
      } catch {
        // Race with concurrent deletion; skip.
      }
    }
  }
  return dirs;
}

let removed = 0;

function remove(target) {
  if (!existsSync(target)) return;
  rmSync(target, { recursive: true, force: true });
  removed += 1;
  console.log(`  ✗ ${path.relative(ROOT, target)}`);
}

const targets = [...GENERATED_DIRS, ...(flags.modules ? ["node_modules"] : [])];

for (const dir of workspaceDirs()) {
  for (const name of targets) {
    remove(path.join(dir, name));
  }
  // TypeScript incremental-build state (repo-wide gitignore: *.tsbuildinfo).
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".tsbuildinfo")) remove(path.join(dir, entry));
    }
  } catch {
    // Directory vanished mid-run; skip.
  }
}

if (removed === 0) {
  console.log("Nothing to clean.");
} else {
  console.log(
    `\nRemoved ${removed} generated ${removed === 1 ? "path" : "paths"}.`,
  );
  console.log(
    flags.modules
      ? "Run `pnpm install` to reinstall dependencies."
      : "Run `pnpm install` to restore postinstall output (e.g. apps/docs/.source) before `pnpm verify`.",
  );
}
