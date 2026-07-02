import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CommandPalette } from "@/components/shell/command-palette";
import { HealthProvider, type ShellAgent } from "@/components/shell/health";
import { Sidebar } from "@/components/shell/sidebar";
import { THEME_INIT_SCRIPT, ThemeProvider } from "@/components/shell/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  isDanglingLocalAgent,
  isUnavailableInDeployment,
  loadAgentsConfig,
} from "@/lib/agents";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Eve Playground",
    template: "%s · Eve Playground",
  },
  description:
    "Web chat and diagnostics control-plane for the eve agents in this repo.",
};

/** Installed eve version, for the sidebar footer. Never throws. */
function eveVersion(): string {
  try {
    const raw = readFileSync(
      path.join(
        /*turbopackIgnore: true*/ process.cwd(),
        "node_modules",
        "eve",
        "package.json",
      ),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ? `v${parsed.version}` : "";
  } catch {
    return "";
  }
}

function shellAgents(): readonly ShellAgent[] {
  const config = loadAgentsConfig();
  if (!config.ok) return [];
  return config.agents.map((agent) => ({
    dangling: isDanglingLocalAgent(agent),
    description: agent.description,
    enabled: agent.enabled,
    id: agent.id,
    targetLabel:
      agent.target.kind === "local" ? `:${agent.target.port}` : "remote",
    title: agent.title,
    unavailable: isUnavailableInDeployment(agent),
  }));
}

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const agents = shellAgents();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the persisted theme class before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-background text-foreground antialiased">
        <ThemeProvider>
          <TooltipProvider>
            <HealthProvider agents={agents}>
              <div className="flex min-h-dvh flex-col lg:flex-row">
                <Sidebar agents={agents} eveVersion={eveVersion()} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  {children}
                </div>
              </div>
              <CommandPalette agents={agents} />
            </HealthProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
