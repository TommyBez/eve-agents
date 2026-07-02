"use client";

import { AlertCircleIcon, MessageCircleIcon } from "lucide-react";
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
import { AgentMessage } from "./agent-message";
import type { AgentHandle } from "./agent-view";

/**
 * The chat tab: conversation + composer, driven by the `useEveAgent` handle
 * lifted into AgentView (so the session survives tab switches).
 */
export function AgentChat({ agent }: { readonly agent: AgentHandle }) {
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.data.messages.length === 0;

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isBusy) return;

    await agent.send({ message: text });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {agent.error ? (
        <div className="shrink-0 pt-3">
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Request failed</p>
              <p className="mt-0.5 text-muted-foreground">
                {agent.error.message}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <MessageCircleIcon className="size-8 text-muted-foreground/50" />
          <p className="text-muted-foreground text-sm">
            Start a conversation — it streams straight from the agent.
          </p>
        </div>
      ) : (
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-1 py-6">
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
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      <div className="mx-auto w-full max-w-3xl shrink-0 pb-4">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea placeholder="Send a message…" />
          <PromptInputSubmit onStop={agent.stop} status={agent.status} />
        </PromptInput>
      </div>
    </div>
  );
}
