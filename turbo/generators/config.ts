import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { PlopTypes } from "@turbo/gen";

const SURFACES = ["http-only", "slack", "github", "scheduled"] as const;
type Surface = (typeof SURFACES)[number];

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Files every agent gets, regardless of surface. */
const BASE_FILES: ReadonlyArray<
  readonly [destination: string, template: string]
> = [
  ["package.json", "package.json.hbs"],
  ["tsconfig.json", "tsconfig.json.hbs"],
  ["turbo.json", "turbo.json.hbs"],
  [".gitignore", "gitignore.hbs"],
  [".env.example", "env.example.hbs"],
  ["README.md", "README.md.hbs"],
  ["AGENTS.md", "AGENTS.md.hbs"],
  ["agent/agent.ts", "agent/agent.ts.hbs"],
  ["agent/instructions.md", "agent/instructions.md.hbs"],
  ["agent/channels/eve.ts", "agent/channels/eve.ts.hbs"],
  ["agent/lib/env.ts", "agent/lib/env.ts.hbs"],
  ["evals/evals.config.ts", "evals/evals.config.ts.hbs"],
  [
    "evals/deterministic/smoke.eval.ts",
    "evals/deterministic/smoke.eval.ts.hbs",
  ],
  ["tests/smoke.test.ts", "tests/smoke.test.ts.hbs"],
];

/** Extra files per primary surface. `http-only` needs nothing beyond the base. */
const SURFACE_FILES: Record<
  Surface,
  ReadonlyArray<readonly [string, string]>
> = {
  "http-only": [],
  slack: [["agent/channels/slack.ts", "agent/channels/slack.ts.hbs"]],
  github: [["agent/channels/github.ts", "agent/channels/github.ts.hbs"]],
  scheduled: [["agent/schedules/example.ts", "agent/schedules/example.ts.hbs"]],
};

function playgroundConfigPath(plop: PlopTypes.NodePlopAPI): string {
  return path.join(
    plop.getDestBasePath(),
    "apps",
    "playground",
    "agents.config.json",
  );
}

/**
 * Registers the freshly scaffolded app with the playground by shelling out
 * to scripts/playground-agents.mjs (`--port auto` = next free local port),
 * then reads the assigned port back for the next-steps message.
 */
function registerWithPlayground(
  plop: PlopTypes.NodePlopAPI,
  name: string,
): string[] {
  const configPath = playgroundConfigPath(plop);
  if (!fs.existsSync(configPath)) {
    return [
      "Playground: skipped registration — apps/playground/agents.config.json not found.",
    ];
  }
  try {
    execFileSync(
      "node",
      ["scripts/playground-agents.mjs", "add", name, "--port", "auto"],
      { cwd: plop.getDestBasePath(), stdio: ["ignore", "pipe", "inherit"] },
    );
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      agents?: Array<{ id: string; target?: { kind: string; port?: number } }>;
    };
    const entry = config.agents?.find((agent) => agent.id === name);
    const port = entry?.target?.port;
    return [
      `Playground: registered as /agents/${name} (local port ${port}).`,
      "  pnpm playground:dev   # start every registered agent + the playground UI",
    ];
  } catch {
    return [
      "Playground: registration failed — register manually with:",
      `  pnpm playground:agents add ${name} --port auto`,
    ];
  }
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  // Handlebars equality helper for surface conditionals in templates.
  plop.setHelper("eq", (a: unknown, b: unknown) => a === b);

  plop.setGenerator("agent", {
    description: "Scaffold a new eve agent app under apps/<name>",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Agent name (kebab-case; becomes apps/<name>):",
        validate: (input: string) => {
          if (!KEBAB_CASE.test(input)) {
            return "Use kebab-case: lowercase letters, digits, and single hyphens (e.g. my-agent).";
          }
          if (fs.existsSync(path.join(plop.getDestBasePath(), "apps", input))) {
            return `apps/${input} already exists — pick another name.`;
          }
          return true;
        },
      },
      {
        type: "input",
        name: "description",
        message: "One-line description of what the agent does:",
        validate: (input: string) => {
          if (input.trim().length === 0) {
            return "Description is required.";
          }
          if (input.includes('"') || input.includes("\\")) {
            return 'Avoid `"` and `\\` — the description is written into package.json.';
          }
          return true;
        },
      },
      {
        type: "list",
        name: "surface",
        message: "Primary surface:",
        choices: [...SURFACES],
      },
      // The playground prompt only exists when the playground config does
      // (plop cannot bypass conditional prompts, so it is included
      // conditionally instead; the skipped case prints a note in the final
      // action). Non-interactive: `--args <name> "<desc>" <surface>
      // <true|false>` — plop maps positional args to prompts in order, so
      // the optional 4th positional answers this prompt.
      ...(fs.existsSync(playgroundConfigPath(plop))
        ? [
            {
              type: "confirm",
              name: "playground",
              message: "Register this agent in the playground?",
              default: true,
            },
          ]
        : []),
    ],
    actions: (answers) => {
      const surface =
        (answers as { surface?: Surface } | undefined)?.surface ?? "http-only";
      const files = [...BASE_FILES, ...SURFACE_FILES[surface]];

      const actions: PlopTypes.ActionType[] = files.map(
        ([destination, template]) => ({
          type: "add",
          path: `apps/{{name}}/${destination}`,
          templateFile: `templates/agent/${template}`,
        }),
      );

      // Final action: register with the playground (when confirmed) and
      // print next steps. Registration reuses scripts/playground-agents.mjs
      // — the single owner of the config format and port picking.
      actions.push((data) => {
        const { name, playground } = data as {
          name: string;
          playground?: boolean | string;
        };
        const lines = [
          `Scaffolded apps/${name}. Next steps:`,
          "  pnpm install",
          `  pnpm --filter ${name} run dev       # local TUI (needs AI_GATEWAY_API_KEY)`,
          `  pnpm --filter ${name} run eval:ci   # deterministic evals — no keys needed`,
          `  pnpm --filter ${name} run test      # unit tests`,
        ];
        // `playground` is a boolean when prompted, a string under `--args`,
        // and undefined when the prompt was skipped (no playground config).
        if (playground === undefined) {
          lines.push(
            "",
            "Playground: apps/playground/agents.config.json not found — skipped registration.",
          );
        } else if (playground === true || playground === "true") {
          lines.push("", ...registerWithPlayground(plop, name));
        }
        return lines.join("\n");
      });

      return actions;
    },
  });
}
