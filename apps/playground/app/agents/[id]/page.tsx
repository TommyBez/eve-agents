import { AlertTriangleIcon, ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentView } from "@/app/_components/agent-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loadAgentsConfig } from "@/lib/agents";
import { DiagnosticsPanel } from "./diagnostics-panel";

// Chat + diagnostics are per-request; never prerender.
export const dynamic = "force-dynamic";

type PageProps = {
  readonly params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const config = loadAgentsConfig();
  const agent = config.ok
    ? config.agents.find((entry) => entry.id === id)
    : undefined;
  return { title: agent?.title ?? id };
}

export default async function AgentPage({ params }: PageProps) {
  const { id } = await params;
  const config = loadAgentsConfig();

  if (!config.ok) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <BackLink />
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangleIcon className="size-4 text-destructive" />
              agents.config.json is invalid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
              {config.error}
            </pre>
          </CardContent>
        </Card>
      </main>
    );
  }

  const agent = config.agents.find((entry) => entry.id === id);
  if (!agent) notFound();

  if (!agent.enabled) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <BackLink />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {agent.title} is disabled
            </CardTitle>
            <CardDescription>
              Set <code className="font-mono">"enabled": true</code> for{" "}
              <code className="font-mono">{agent.id}</code> in
              agents.config.json to chat with it.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-6xl flex-col px-4 pt-4 sm:px-6">
      <AgentView
        agentId={agent.id}
        description={agent.description}
        diagnostics={<DiagnosticsPanel agent={agent} />}
        title={agent.title}
      />
    </main>
  );
}

function BackLink() {
  return (
    <Link
      className="mb-4 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
      href="/"
    >
      <ArrowLeftIcon className="size-3.5" />
      All agents
    </Link>
  );
}
