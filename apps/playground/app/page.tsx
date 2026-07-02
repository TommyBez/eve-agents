import { AlertTriangleIcon } from "lucide-react";
import type { ShellAgent } from "@/components/shell/health";
import {
  type AgentEntry,
  isDanglingLocalAgent,
  isUnavailableInDeployment,
  loadAgentsConfig,
} from "@/lib/agents";
import { HomeOverview } from "./_components/home-overview";

// The grid reflects agents.config.json and live health; never prerender it.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const config = loadAgentsConfig();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6">
        <h1 className="font-semibold text-xl tracking-tight">Overview</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Every agent from{" "}
          <code className="font-mono text-xs">agents.config.json</code>, with
          live health from this browser.
        </p>
      </div>

      {config.ok ? (
        <HomeOverview agents={toShellAgents(config.agents)} />
      ) : (
        <ConfigErrorCallout error={config.error} />
      )}
    </main>
  );
}

function toShellAgents(agents: readonly AgentEntry[]): readonly ShellAgent[] {
  return agents.map((agent) => ({
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

function ConfigErrorCallout({ error }: { readonly error: string }) {
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-4">
      <p className="flex items-center gap-2 font-medium text-danger text-sm">
        <AlertTriangleIcon className="size-4" />
        agents.config.json is invalid
      </p>
      <p className="mt-1 text-muted-foreground text-sm">
        Fix the config and reload — the playground never crashes on a bad
        config, it just shows you this.
      </p>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md border bg-background p-3 font-mono text-xs">
        {error}
      </pre>
    </div>
  );
}
