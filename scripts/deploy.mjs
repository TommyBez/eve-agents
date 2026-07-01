#!/usr/bin/env node
// Deploy one app with the eve CLI, then smoke-test the deployment.
//
//   node scripts/deploy.mjs <app> [--prod]
//
// Thin glue over `pnpm --filter <app> exec eve deploy` (docs/deployment.md).
// Note: `eve deploy` is production-only — it runs `vercel deploy --prod` and
// takes no flags — so --prod is accepted but changes nothing. First-time
// setup (`eve link`) must be done beforehand; this script is non-interactive.
// After a successful deploy it parses the deployment URL from the output and
// runs scripts/smoke.mjs against it (health only; add --session manually for
// a full turn). If no URL is found, it prints the manual smoke command.
//
// Exit codes: 0 = deploy (+ smoke) passed, 1 = deploy or smoke failed,
// 2 = usage error.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("-"));
const positional = args.filter((a) => !a.startsWith("-"));
const unknownFlags = flags.filter((a) => a !== "--prod");
if (unknownFlags.length > 0 || positional.length !== 1) {
  if (unknownFlags.length > 0)
    console.error(`Error: unknown flag(s) ${unknownFlags.join(", ")}`);
  console.error("Usage: node scripts/deploy.mjs <app> [--prod]");
  process.exit(2);
}
const app = positional[0];
if (!fs.existsSync(path.join(ROOT, "apps", app, "package.json"))) {
  const apps = fs
    .readdirSync(path.join(ROOT, "apps"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  console.error(
    `Error: no app "${app}" under apps/. Available: ${apps.join(", ")}`,
  );
  process.exit(2);
}
if (flags.includes("--prod")) {
  console.log(
    "note: `eve deploy` always deploys to Vercel production; --prod is implied.",
  );
}

/** Run a command, streaming output while capturing it for URL parsing. */
function run(command, argv) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, {
      cwd: ROOT,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    const tee = (stream, sink) =>
      stream.on("data", (chunk) => {
        output += chunk;
        sink.write(chunk);
      });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on("close", (code) => resolve({ code, output }));
    child.on("error", (error) => {
      console.error(`Error: failed to run ${command}: ${error.message}`);
      resolve({ code: 1, output });
    });
  });
}

console.log(`Deploying ${app} (pnpm --filter ${app} exec eve deploy)...`);
const deploy = await run("pnpm", ["--filter", app, "exec", "eve", "deploy"]);
if (deploy.code !== 0) {
  console.error(`Error: eve deploy exited with code ${deploy.code}.`);
  process.exit(1);
}

// Deployment URLs surface as https://<slug>.vercel.app; take the last one
// printed (vercel prints inspect URLs earlier). Strip ANSI color sequences
// first — the ESC byte via a string escape (a control char in a regex
// literal trips the linter), then the bracketed color code remnants.
const plain = deploy.output
  .replaceAll("\u001b", "")
  .replaceAll(/\[[0-9;]*m/g, "");
const url = plain.match(/https:\/\/[\w./-]+\.vercel\.app[\w./-]*/g)?.at(-1);
if (!url) {
  console.log(
    "\nDeploy succeeded, but no deployment URL was found in the output.",
  );
  console.log(
    "Run the smoke test manually: node scripts/smoke.mjs https://<your-app>",
  );
  process.exit(0);
}

console.log(`\nSmoke-testing ${url} (health only)...`);
const smoke = await run(process.execPath, [
  path.join(ROOT, "scripts", "smoke.mjs"),
  url,
]);
if (smoke.code !== 0) {
  console.error(
    `For a full session check: node scripts/smoke.mjs ${url} --session`,
  );
}
process.exit(smoke.code === 0 ? 0 : 1);
