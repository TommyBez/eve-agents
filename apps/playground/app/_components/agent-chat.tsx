"use client";

import { AlertCircleIcon, SparklesIcon } from "lucide-react";
import { useMemo } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { AgentMessage, type TurnUsage } from "./agent-message";
import type { AgentHandle } from "./agent-view";

/**
 * The chat tab: conversation + composer, driven by the `useEveAgent` handle
 * lifted into AgentView (so the session survives tab switches).
 */
export function AgentChat({
  agent,
  agentId,
  description,
}: {
  readonly agent: AgentHandle;
  readonly agentId: string;
  readonly description: string;
}) {
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  // Per-turn token usage, summed from `step.completed` events. Rendered as a
  // small mono footer under each finished assistant turn (absent → skipped).
  const usageByTurn = useMemo(() => {
    const usage = new Map<string, TurnUsage>();
    for (const event of agent.events) {
      if (event.type !== "step.completed" || !event.data.usage) continue;
      const current = usage.get(event.data.turnId) ?? {
        inputTokens: 0,
        outputTokens: 0,
      };
      usage.set(event.data.turnId, {
        inputTokens: current.inputTokens + (event.data.usage.inputTokens ?? 0),
        outputTokens:
          current.outputTokens + (event.data.usage.outputTokens ?? 0),
      });
    }
    return usage;
  }, [agent.events]);

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;

    await agent.send({ message: text });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {agent.error ? (
        <div className="mx-auto w-full max-w-[46rem] shrink-0 px-4 pt-3">
          <div
            className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2.5 text-sm pg-enter"
            role="alert"
          >
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" />
            <div>
              <p className="font-medium">Request failed</p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {agent.error.message}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? (
        <EmptyState
          agentId={agentId}
          description={description}
          disabled={isBusy}
          onPick={(prompt) => void agent.send({ message: prompt })}
        />
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-[46rem] gap-5 px-4 py-6">
            {agent.data.messages.map((message, index) => (
              <AgentMessage
                canRespond={!isBusy}
                isStreaming={
                  agent.status === "streaming" &&
                  index === agent.data.messages.length - 1
                }
                key={message.id}
                message={message}
                onInputResponses={(inputResponses) =>
                  agent.send({ inputResponses })
                }
                usage={
                  message.role === "assistant" &&
                  message.metadata?.status === "complete" &&
                  message.metadata.turnId
                    ? usageByTurn.get(message.metadata.turnId)
                    : undefined
                }
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div className="mx-auto w-full max-w-[46rem] shrink-0 px-4 pb-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea placeholder={`Message ${agentId}…`} />
          <PromptInputSubmit onStop={agent.stop} status={agent.status} />
        </PromptInput>
        <p className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-muted-foreground/70">
          <span>
            <kbd className="rounded border bg-card px-1 font-mono text-[10px]">
              Enter
            </kbd>{" "}
            to send ·{" "}
            <kbd className="rounded border bg-card px-1 font-mono text-[10px]">
              Shift+Enter
            </kbd>{" "}
            for a new line
          </span>
          <span className="hidden font-mono sm:inline">{agentId}</span>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state with suggested prompts                                 */
/* ------------------------------------------------------------------ */

const SAMPLE_DIFF_PROMPT = `Review this diff and publish the review with submit_pr_review:

\`\`\`diff
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,8 +1,6 @@
 export async function getUserData(session: Session, requestedUserId: string) {
-  if (session.userId !== requestedUserId) {
-    throw new ForbiddenError("cannot read another user's data");
-  }
   return db.users.findById(requestedUserId);
 }
\`\`\``;

function suggestionsFor(
  agentId: string,
  description: string,
): readonly { readonly label: string; readonly prompt: string }[] {
  const haystack = `${agentId} ${description}`.toLowerCase();
  const suggestions: { label: string; prompt: string }[] = [];

  if (/review|pull request|\bpr\b|diff|code/.test(haystack)) {
    suggestions.push({
      label: "Review a sample diff",
      prompt: SAMPLE_DIFF_PROMPT,
    });
  }
  suggestions.push(
    {
      label: "What can you do?",
      prompt:
        "Introduce yourself: what do you do, and what should I ask you first?",
    },
    {
      label: "Walk me through your tools",
      prompt: "List your tools and give one example of when you'd use each.",
    },
  );
  return suggestions.slice(0, 3);
}

function EmptyState({
  agentId,
  description,
  disabled,
  onPick,
}: {
  readonly agentId: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onPick: (prompt: string) => void;
}) {
  const suggestions = suggestionsFor(agentId, description);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="flex size-10 items-center justify-center rounded-lg border bg-card text-brand">
          <SparklesIcon className="size-4.5" />
        </span>
        <p className="font-medium text-sm">
          {description || "Start a conversation"}
        </p>
        <p className="text-muted-foreground text-xs">
          Streams straight from the agent — every raw event lands in the Events
          tab.
        </p>
      </div>
      <div className="flex max-w-xl flex-wrap items-center justify-center gap-2">
        {suggestions.map((suggestion) => (
          <button
            className="rounded-full border bg-card px-3.5 py-1.5 text-muted-foreground text-xs transition-colors duration-150 hover:border-brand/50 hover:text-foreground disabled:opacity-50"
            disabled={disabled}
            key={suggestion.label}
            onClick={() => onPick(suggestion.prompt)}
            type="button"
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}
