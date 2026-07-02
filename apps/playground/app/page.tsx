import { AlertTriangleIcon, ArrowRightIcon, BotIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isDanglingLocalAgent, loadAgentsConfig } from "@/lib/agents";
import { HealthBadge } from "./_components/health-badge";

// The grid reflects agents.config.json and live health; never prerender it.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const config = loadAgentsConfig();

  if (!config.ok) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <PageIntro />
        <ConfigErrorCard error={config.error} />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <PageIntro />
      {config.agents.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No agents configured. Add one to{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            apps/playground/agents.config.json
          </code>
          .
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {config.agents.map((agent) => {
            const dangling = isDanglingLocalAgent(agent);
            return (
              <Card
                className="gap-4 transition-colors hover:border-ring/40"
                data-testid={`agent-card-${agent.id}`}
                key={agent.id}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BotIcon className="size-4 text-muted-foreground" />
                      {agent.title}
                    </CardTitle>
                    {agent.enabled ? (
                      <HealthBadge agentId={agent.id} />
                    ) : (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                  </div>
                  <CardDescription>{agent.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex flex-col gap-3">
                  {dangling ? (
                    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-amber-700 text-xs dark:text-amber-300">
                      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                      Local target, but no <code>apps/{agent.id}</code>{" "}
                      directory exists — this entry looks dangling.
                    </p>
                  ) : null}
                  <div className="flex items-center justify-between text-muted-foreground text-xs">
                    <span className="font-mono">
                      {agent.target.kind === "local"
                        ? `local :${agent.target.port}`
                        : "remote url"}
                    </span>
                    {agent.enabled ? (
                      <Link
                        className="inline-flex items-center gap-1 font-medium text-foreground text-sm hover:underline"
                        href={`/agents/${agent.id}`}
                      >
                        Open
                        <ArrowRightIcon className="size-3.5" />
                      </Link>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}

function PageIntro() {
  return (
    <div className="mb-8">
      <h1 className="font-semibold text-2xl tracking-tight">Agents</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        Every agent from <code className="font-mono">agents.config.json</code>,
        with live health. Open one to chat, inspect diagnostics, or watch its
        event stream.
      </p>
    </div>
  );
}

function ConfigErrorCard({ error }: { readonly error: string }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangleIcon className="size-4 text-destructive" />
          agents.config.json is invalid
        </CardTitle>
        <CardDescription>
          Fix the config and reload — the playground never crashes on a bad
          config, it just shows you this.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
          {error}
        </pre>
      </CardContent>
    </Card>
  );
}
