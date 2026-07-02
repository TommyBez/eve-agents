"use client";

import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessagePart,
} from "eve/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

/** Token totals for one turn, summed from `step.completed` events. */
export type TurnUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export function AgentMessage({
  canRespond,
  isStreaming,
  message,
  onInputResponses,
  usage,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: (
    responses: readonly AgentInputResponse[],
  ) => void | Promise<void>;
  readonly usage?: TurnUsage;
}) {
  const lastTextIndex = message.parts.reduce(
    (last, part, index) => (part.type === "text" ? index : last),
    -1,
  );

  return (
    <Message
      className="pg-enter"
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent>
        {message.parts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            key={partKey(part, index)}
            onInputResponses={onInputResponses}
            part={part}
            showCaret={
              isStreaming &&
              message.role === "assistant" &&
              index === lastTextIndex
            }
          />
        ))}
      </MessageContent>
      {usage && (usage.inputTokens > 0 || usage.outputTokens > 0) ? (
        <p
          className="flex items-center gap-2.5 font-mono text-[10px] text-muted-foreground/70 tabular-nums"
          data-testid="turn-usage"
        >
          <span className="flex items-center gap-0.5">
            <ArrowUpIcon className="size-2.5" />
            {formatTokens(usage.inputTokens)} in
          </span>
          <span className="flex items-center gap-0.5">
            <ArrowDownIcon className="size-2.5" />
            {formatTokens(usage.outputTokens)} out
          </span>
        </p>
      ) : null}
    </Message>
  );
}

function formatTokens(count: number): string {
  if (count >= 10_000) return `${(count / 1000).toFixed(1)}k`;
  return count.toLocaleString("en-US");
}

function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  showCaret,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (
    responses: readonly AgentInputResponse[],
  ) => void | Promise<void>;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning
          defaultOpen={part.state === "streaming"}
          isStreaming={part.state === "streaming"}
        >
          <ReasoningTrigger
            getThinkingMessage={(isStreaming, duration) =>
              isStreaming || duration === 0 ? (
                <Shimmer className="text-xs" duration={1.5}>
                  Thinking…
                </Shimmer>
              ) : (
                <span className="text-xs">
                  Thinking
                  {duration === undefined ? "" : ` · ${duration}s`}
                </span>
              )
            }
          />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool":
      return (
        <Tool
          defaultOpen={
            part.state === "approval-requested" ||
            part.state === "approval-responded"
          }
        >
          <ToolHeader
            state={part.state}
            title={part.toolName}
            toolName={part.toolName}
            type="dynamic-tool"
          />
          <ToolContent>
            <ToolInput input={part.input} />
            <InputRequestActions
              canRespond={canRespond}
              part={part}
              onInputResponses={onInputResponses}
            />
            <ToolOutput errorText={part.errorText} output={part.output} />
          </ToolContent>
        </Tool>
      );
  }
}

function AuthorizationPrompt({
  part,
}: {
  readonly part: EveAuthorizationPart;
}) {
  const isAuthorized =
    part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized
    ? CheckCircleIcon
    : isCompleted
      ? XCircleIcon
      : KeyRoundIcon;
  const instructions = part.authorization?.instructions;
  const shouldShowInstructions =
    instructions !== undefined && instructions !== part.description;

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-3",
        isAuthorized
          ? "border-ok/30 bg-ok/5"
          : isCompleted
            ? "border-danger/30 bg-danger/5"
            : "border-warn/40 bg-warn/5",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-ok/10 text-ok"
              : isCompleted
                ? "bg-danger/10 text-danger"
                : "bg-warn/10 text-warn",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-sm">{authorizationTitle(part)}</p>
          <p className="text-muted-foreground text-sm">
            {authorizationDescription(part)}
          </p>
          {shouldShowInstructions ? (
            <p className="text-muted-foreground text-sm">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md border bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return `Connect ${part.displayName}`;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected`;
  }
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") {
    return part.description;
  }
  if (part.outcome === "authorized") {
    return `${part.displayName} connected.`;
  }
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(
  outcome: NonNullable<EveAuthorizationPart["outcome"]>,
): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
}

function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: (
    responses: readonly AgentInputResponse[],
  ) => void | Promise<void>;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  if (!inputRequest) {
    return null;
  }

  const inputResponse = part.toolMetadata?.eve?.inputResponse;
  const selectedOption = inputRequest.options?.find(
    (option) => option.id === inputResponse?.optionId,
  );

  return (
    <div className="space-y-3 rounded-lg border border-warn/40 bg-warn/5 p-3">
      <p className="text-sm">
        <span className="mr-2 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 font-medium font-mono text-[10px] text-warn uppercase">
          input needed
        </span>
        {inputRequest.prompt}
      </p>
      {inputResponse ? (
        <p className="font-medium text-sm">
          Responded:{" "}
          {selectedOption?.label ??
            inputResponse.text ??
            inputResponse.optionId}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {inputRequest.options?.map((option) => (
            <Button
              disabled={!canRespond}
              key={option.id}
              onClick={() => {
                void onInputResponses([
                  {
                    optionId: option.id,
                    requestId: inputRequest.requestId,
                  },
                ]);
              }}
              size="sm"
              type="button"
              variant={option.style === "danger" ? "destructive" : "default"}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
