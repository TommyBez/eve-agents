"use client";

import type { HandleMessageStreamEvent } from "eve/client";
import type { EveMessageData, UseEveAgentHelpers } from "eve/react";
import { useEveAgent } from "eve/react";
import { RotateCcwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AgentChat } from "./agent-chat";
import { EventsPanel } from "./events-panel";

export type AgentHandle = UseEveAgentHelpers<EveMessageData>;

/**
 * Live event stream for the current session, exposed as context so leaf
 * client components inside the server-rendered diagnostics tree (e.g. the
 * context-window meter) can read it.
 */
const AgentEventsContext = createContext<
  readonly HandleMessageStreamEvent[] | null
>(null);

export function useAgentEvents(): readonly HandleMessageStreamEvent[] {
  return useContext(AgentEventsContext) ?? [];
}

const TAB_IDS = new Set(["chat", "diagnostics", "events"]);

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
  const [tab, setTab] = useState("chat");
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const sessionId = agent.session.sessionId;
  const canReset = !isBusy && (sessionId || agent.data.messages.length > 0);

  // Command palette integration (⌘K → switch tab / new session).
  useEffect(() => {
    const onTab = (event: Event) => {
      const requested = (event as CustomEvent<string>).detail;
      if (TAB_IDS.has(requested)) setTab(requested);
    };
    const onNewSession = () => agent.reset();
    window.addEventListener("playground:tab", onTab);
    window.addEventListener("playground:new-session", onNewSession);
    return () => {
      window.removeEventListener("playground:tab", onTab);
      window.removeEventListener("playground:new-session", onNewSession);
    };
  }, [agent.reset]);

  return (
    <AgentEventsContext.Provider value={agent.events}>
      <Tabs
        className="flex min-h-0 flex-1 flex-col gap-0"
        onValueChange={setTab}
        value={tab}
      >
        <div className="sticky top-0 z-30 shrink-0 border-b bg-background/90 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
            <div className="min-w-0">
              <h1 className="truncate font-semibold text-[15px] tracking-tight">
                {title}
              </h1>
              <p className="truncate text-muted-foreground text-xs">
                {description}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span
                className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-xs"
                data-testid="session-indicator"
              >
                <StatusDot status={agent.status} />
                <span
                  className={cn(
                    "font-mono",
                    agent.status === "error"
                      ? "text-danger"
                      : isBusy
                        ? "text-brand"
                        : "text-muted-foreground",
                  )}
                >
                  {agent.status}
                </span>
                {sessionId ? (
                  <code
                    className="hidden max-w-44 truncate border-l pl-2 font-mono text-[11px] text-muted-foreground xl:inline"
                    title={sessionId}
                  >
                    {sessionId}
                  </code>
                ) : (
                  <span className="hidden border-l pl-2 text-muted-foreground/70 xl:inline">
                    no session
                  </span>
                )}
              </span>
              <Button
                disabled={!canReset}
                onClick={() => agent.reset()}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCcwIcon className="size-3.5" />
                New session
              </Button>
              <TabsList className="h-8 bg-muted/60">
                <TabsTrigger className="text-xs" value="chat">
                  Chat
                </TabsTrigger>
                <TabsTrigger className="text-xs" value="diagnostics">
                  Diagnostics
                </TabsTrigger>
                <TabsTrigger className="text-xs" value="events">
                  Events
                  {agent.events.length > 0 ? (
                    <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground tabular-nums">
                      {agent.events.length}
                    </span>
                  ) : null}
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
        </div>

        <TabsContent
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          forceMount
          value="chat"
        >
          <AgentChat
            agent={agent}
            agentId={agentId}
            description={description}
          />
        </TabsContent>

        <TabsContent
          className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          forceMount
          value="diagnostics"
        >
          <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6">
            {diagnostics}
          </div>
        </TabsContent>

        <TabsContent
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          forceMount
          value="events"
        >
          <EventsPanel events={agent.events} />
        </TabsContent>
      </Tabs>
    </AgentEventsContext.Provider>
  );
}

function StatusDot({ status }: { readonly status: AgentHandle["status"] }) {
  const isLive = status === "submitted" || status === "streaming";
  const tone = status === "error" ? "bg-danger" : isLive ? "bg-brand" : "bg-ok";

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
