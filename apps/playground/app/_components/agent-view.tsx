"use client";

import type { EveMessageData, UseEveAgentHelpers } from "eve/react";
import { useEveAgent } from "eve/react";
import { RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AgentChat } from "./agent-chat";
import { EventsPanel } from "./events-panel";

export type AgentHandle = UseEveAgentHelpers<EveMessageData>;

/**
 * Client shell for the agent detail page. The `useEveAgent` hook lives here —
 * above the tabs — and every tab keeps its content mounted (`forceMount`), so
 * the chat session, its event log, and scroll positions all survive tab
 * switches. The diagnostics tab body is a server component streamed in as a
 * ReactNode.
 */
export function AgentView({
  agentId,
  title,
  description,
  diagnostics,
}: {
  readonly agentId: string;
  readonly title: string;
  readonly description: string;
  readonly diagnostics: ReactNode;
}) {
  const agent = useEveAgent({ host: `/api/agents/${agentId}` });
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const sessionId = agent.session.sessionId;

  return (
    <Tabs className="flex min-h-0 flex-1 flex-col gap-0" defaultValue="chat">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b pb-3">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-lg tracking-tight">
            {title}
          </h1>
          <p className="truncate text-muted-foreground text-xs">
            {description}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span
            className="flex items-center gap-2 text-muted-foreground text-xs"
            data-testid="session-indicator"
          >
            <StatusDot status={agent.status} />
            {agent.status}
            {sessionId ? (
              <code className="hidden rounded bg-muted px-1.5 py-0.5 font-mono sm:inline">
                {sessionId}
              </code>
            ) : (
              <span className="hidden sm:inline">no session</span>
            )}
          </span>
          <Button
            disabled={
              isBusy || (!sessionId && agent.data.messages.length === 0)
            }
            onClick={() => agent.reset()}
            size="sm"
            type="button"
            variant="outline"
          >
            <RotateCcwIcon className="size-3.5" />
            New session
          </Button>
          <TabsList>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
            <TabsTrigger value="events">
              Events
              {agent.events.length > 0 ? (
                <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
                  {agent.events.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>
      </div>

      <TabsContent
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        forceMount
        value="chat"
      >
        <AgentChat agent={agent} />
      </TabsContent>

      <TabsContent
        className="min-h-0 flex-1 overflow-y-auto pt-4 data-[state=inactive]:hidden"
        forceMount
        value="diagnostics"
      >
        {diagnostics}
      </TabsContent>

      <TabsContent
        className="flex min-h-0 flex-1 flex-col pt-4 data-[state=inactive]:hidden"
        forceMount
        value="events"
      >
        <EventsPanel events={agent.events} />
      </TabsContent>
    </Tabs>
  );
}

function StatusDot({ status }: { readonly status: AgentHandle["status"] }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone =
    status === "error"
      ? "bg-destructive"
      : isLive
        ? "bg-emerald-500"
        : "bg-muted-foreground";

  return (
    <span className="relative flex size-1.5">
      {isLive ? (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            tone,
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-1.5 rounded-full transition-colors",
          tone,
        )}
      />
    </span>
  );
}
