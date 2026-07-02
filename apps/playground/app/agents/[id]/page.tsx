import { AlertTriangleIcon, ArrowLeftIcon, PowerOffIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AgentView } from "@/app/_components/agent-view";
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
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <BackLink />
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4">
          <p className="flex items-center gap-2 font-medium text-danger text-sm">
            <AlertTriangleIcon className="size-4" />
            agents.config.json is invalid
          </p>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-md border bg-background p-3 font-mono text-xs">
            {config.error}
          </pre>
        </div>
      </main>
    );
  }

  const agent = config.agents.find((entry) => entry.id === id);
  if (!agent) notFound();

  if (!agent.enabled) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <BackLink />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg border bg-card">
            <PowerOffIcon className="size-4.5 text-muted-foreground/60" />
          </span>
          <div>
            <p className="font-medium text-sm">{agent.title} is disabled</p>
            <p className="mt-1 text-muted-foreground text-sm">
              Set <code className="font-mono">"enabled": true</code> for{" "}
              <code className="font-mono">{agent.id}</code> in
              agents.config.json to chat with it.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-[calc(100dvh-3rem)] w-full flex-col lg:h-dvh">
      <AgentView
        agentId={agent.id}
        description={agent.description}
        diagnostics={
          <Suspense fallback={<DiagnosticsSkeleton />}>
            <DiagnosticsPanel agent={agent} />
          </Suspense>
        }
        title={agent.title}
      />
    </main>
  );
}

function BackLink() {
  return (
    <Link
      className="mb-4 inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
      href="/"
    >
      <ArrowLeftIcon className="size-3.5" />
      All agents
    </Link>
  );
}

/** Layout-matching skeleton shown while `/eve/v1/info` streams in. */
function DiagnosticsSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-1 gap-3 pb-8 lg:grid-cols-2">
      <div className="h-44 animate-pulse rounded-lg border bg-card lg:col-span-2" />
      <div className="h-72 animate-pulse rounded-lg border bg-card lg:col-span-2" />
      <div className="h-36 animate-pulse rounded-lg border bg-card" />
      <div className="h-36 animate-pulse rounded-lg border bg-card" />
    </div>
  );
}
