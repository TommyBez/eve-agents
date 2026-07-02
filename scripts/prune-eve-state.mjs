#!/usr/bin/env node
/**
 * Self-healing guard for eve's local session store. `.workflow-data/` grows
 * with every eval/dev run and eve never garbage-collects it; once `events/`
 * outgrows the fd limit, eve's startup prune crashes with EMFILE (see
 * docs/troubleshooting.md). Partial cleanup could corrupt run state, so past
 * the threshold the whole store is removed — it is dev-only, safe-to-delete
 * state, and the sessions it held would be lost to the crash anyway.
 *
 * Runs from an app directory (before dev/eval scripts) or from the repo root
 * (all apps). Always exits 0 — a failed prune must never block the command
 * it guards; eve itself will surface any remaining problem.
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THRESHOLD = 1_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS_DIR = path.join(ROOT, "apps");

function pruneApp(appDir) {
  const store = path.join(appDir, ".workflow-data");
  const eventsDir = path.join(store, "events");
  if (!existsSync(eventsDir)) return;
  let count;
  try {
    count = readdirSync(eventsDir).length;
  } catch {
    return;
  }
  if (count <= THRESHOLD) return;
  try {
    rmSync(store, { recursive: true, force: true });
    console.log(
      `[prune-eve-state] removed ${path.relative(ROOT, store)} (${count} event files > ${THRESHOLD}; prevents EMFILE at startup)`,
    );
  } catch (error) {
    console.warn(`[prune-eve-state] could not remove ${store}: ${error}`);
  }
}

try {
  const cwd = process.cwd();
  const isApp =
    path.dirname(cwd) === APPS_DIR &&
    existsSync(path.join(cwd, "package.json"));
  const appDirs = isApp
    ? [cwd]
    : readdirSync(APPS_DIR)
        .map((entry) => path.join(APPS_DIR, entry))
        .filter((dir) => {
          try {
            return statSync(path.join(dir, "package.json")).isFile();
          } catch {
            return false;
          }
        });
  for (const dir of appDirs) pruneApp(dir);
} catch {
  // Never block the guarded command.
}
