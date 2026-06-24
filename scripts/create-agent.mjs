#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS_DIR = path.join(ROOT, "apps");
const DEFAULT_DEPENDENCIES = {
  ai: "7.0.0-beta.178",
  eve: "^0.13.3",
  zod: "4.3.6",
};
const DEFAULT_DEV_DEPENDENCIES = {
  "@types/node": "24.x",
  "@typescript/native-preview": "7.0.0-dev.20260523.1",
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const rawName =
      args.name ??
      (await rl.question("Agent name (e.g. customer-support): "));
    const agentName = toPackageName(rawName);

    if (!agentName) {
      throw new Error("Agent name is required.");
    }

    const targetDir = path.join(APPS_DIR, agentName);
    if (existsSync(targetDir)) {
      throw new Error(`apps/${agentName} already exists.`);
    }

    const shouldCreate = args.yes
      ? true
      : await confirm(rl, `Create bare eve agent at apps/${agentName}?`, true);

    if (!shouldCreate) {
      console.log("Cancelled.");
      return;
    }

    if (args.dryRun) {
      console.log(`Would create bare eve agent at apps/${agentName}.`);
      return;
    }

    mkdirSync(targetDir, { recursive: true });
    writeJson(path.join(targetDir, "package.json"), createPackageJson(agentName));

    const provider = findEveProviderPackage();
    if (provider) {
      run("pnpm", ["--filter", provider.name, "exec", "eve", "init", targetDir]);
    } else {
      const eveVersion = DEFAULT_DEPENDENCIES.eve.replace(/^[~^]/, "");
      run("pnpm", ["dlx", `eve@${eveVersion}`, "init", targetDir]);
    }

    normalizeAgentPackage(targetDir, agentName);
    ensureMonorepoFiles(targetDir);

    const shouldInstall = args.install ?? (args.yes || (await confirm(rl, "Run pnpm install?", true)));
    if (shouldInstall) {
      run("pnpm", ["install"]);
    }

    const shouldVerify =
      args.verify ?? (args.yes || (await confirm(rl, `Run eve info for ${agentName}?`, true)));
    if (shouldVerify) {
      run("pnpm", ["--filter", agentName, "run", "info"]);
    }

    console.log(`\nCreated apps/${agentName}.`);
    console.log(`Next: pnpm --filter ${agentName} run dev`);
  } finally {
    rl.close();
  }
}

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    help: false,
    install: undefined,
    name: undefined,
    verify: undefined,
    yes: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      parsed.yes = true;
    } else if (arg === "--no-install") {
      parsed.install = false;
    } else if (arg === "--install") {
      parsed.install = true;
    } else if (arg === "--no-verify") {
      parsed.verify = false;
    } else if (arg === "--verify") {
      parsed.verify = true;
    } else if (arg === "--name") {
      parsed.name = args[++index];
    } else if (arg.startsWith("--name=")) {
      parsed.name = arg.slice("--name=".length);
    } else if (!parsed.name) {
      parsed.name = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Create a bare eve agent app in this Turborepo.

Usage:
  pnpm agent:new
  pnpm agent:new -- customer-support
  pnpm agent:new -- --name customer-support --yes

Options:
  --name <name>   Agent/package name. Converted to kebab-case.
  -y, --yes       Accept defaults.
  --dry-run       Print the target path without writing files.
  --no-install    Skip pnpm install after scaffolding.
  --no-verify     Skip eve info after scaffolding.
  -h, --help      Show this help.
`);
}

function createPackageJson(agentName) {
  return {
    name: agentName,
    version: "0.0.0",
    private: true,
    type: "module",
    imports: {
      "#*": "./agent/*",
      "#evals/*": "./evals/*",
    },
    scripts: {
      build: "eve build",
      dev: "eve dev",
      eval: "eve eval",
      info: "eve info",
      start: "eve start",
      typecheck: "tsgo",
    },
    dependencies: DEFAULT_DEPENDENCIES,
    devDependencies: DEFAULT_DEV_DEPENDENCIES,
    engines: {
      node: "24.x",
    },
  };
}

function normalizeAgentPackage(targetDir, agentName) {
  const packagePath = path.join(targetDir, "package.json");
  const existing = readJson(packagePath);
  const normalized = {
    ...existing,
    ...createPackageJson(agentName),
    dependencies: {
      ...DEFAULT_DEPENDENCIES,
      ...existing.dependencies,
    },
    devDependencies: {
      ...DEFAULT_DEV_DEPENDENCIES,
      ...existing.devDependencies,
    },
  };

  writeJson(packagePath, normalized);
}

function ensureMonorepoFiles(targetDir) {
  writeJson(path.join(targetDir, "tsconfig.json"), {
    extends: "../../tsconfig.base.json",
    include: ["agent/**/*.ts", "evals/**/*.ts", ".eve/**/*.d.ts"],
  });

  writeJson(path.join(targetDir, "turbo.json"), {
    extends: ["//"],
    tasks: {
      build: {
        dependsOn: ["^build"],
        env: ["NODE_ENV", "VERCEL", "VERCEL_ENV"],
        inputs: ["$TURBO_DEFAULT$", ".env*", "$TURBO_ROOT$/tsconfig.base.json"],
        outputs: [".eve/**", ".output/**"],
      },
      dev: {
        cache: false,
        passThroughEnv: ["AI_GATEWAY_API_KEY", "PORT", "VERCEL_OIDC_TOKEN"],
        persistent: true,
      },
      eval: {
        cache: false,
        passThroughEnv: ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"],
      },
      info: {
        cache: false,
      },
      start: {
        dependsOn: ["build"],
        cache: false,
        passThroughEnv: ["AI_GATEWAY_API_KEY", "PORT", "VERCEL_OIDC_TOKEN"],
        persistent: true,
      },
      typecheck: {
        dependsOn: ["^build"],
        inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/tsconfig.base.json"],
        outputs: [],
      },
    },
  });
}

function findEveProviderPackage() {
  for (const workspaceDir of [APPS_DIR, path.join(ROOT, "packages")]) {
    if (!existsSync(workspaceDir)) {
      continue;
    }

    for (const entry of readdirSync(workspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packagePath = path.join(workspaceDir, entry.name, "package.json");
      if (!existsSync(packagePath)) {
        continue;
      }

      const pkg = readJson(packagePath);
      if (pkg.dependencies?.eve || pkg.devDependencies?.eve) {
        return { name: pkg.name, version: pkg.dependencies?.eve ?? pkg.devDependencies?.eve };
      }
    }
  }

  return null;
}

function toPackageName(value) {
  return value
    ?.trim()
    .replace(/^@[^/]+\//, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/_+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

async function confirm(rl, question, defaultValue) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} [${suffix}] `)).trim().toLowerCase();

  if (!answer) {
    return defaultValue;
  }

  return answer === "y" || answer === "yes";
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
