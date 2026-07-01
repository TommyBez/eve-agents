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

      // Final action: print next steps instead of mutating anything else.
      actions.push((data) => {
        const { name } = data as { name: string };
        return [
          `Scaffolded apps/${name}. Next steps:`,
          "  pnpm install",
          `  pnpm --filter ${name} run dev       # local TUI (needs AI_GATEWAY_API_KEY)`,
          `  pnpm --filter ${name} run eval:ci   # deterministic evals — no keys needed`,
          `  pnpm --filter ${name} run test      # unit tests`,
        ].join("\n");
      });

      return actions;
    },
  });
}
