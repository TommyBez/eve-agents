import type { LanguageModelMiddleware } from "ai";
import {
  type FixtureStep,
  type FixtureToolCall,
  writeRecordedStep,
} from "./fixtures.js";

/**
 * Structural view of an AI SDK prompt (`LanguageModelV4Prompt`). Only the
 * fields the recorder reads are named, so the type stays stable across AI SDK
 * minor releases and is easy to construct in unit tests.
 */
export type PromptLike = ReadonlyArray<{
  readonly role: string;
  readonly content:
    | string
    | ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}>;

/** Structural view of one generated content part or stream part. */
interface PartLike {
  readonly type: string;
  readonly text?: string;
  readonly delta?: string;
  readonly toolName?: string;
  readonly input?: unknown;
}

/**
 * Text of the last user message, extracted the same way eve's `mockModel`
 * does (its text parts concatenated), so record-side keys line up with
 * replay-side keys. Returns null before the first user message.
 */
export function lastUserMessageText(prompt: PromptLike): string | null {
  const lastUser = [...prompt]
    .reverse()
    .find((message) => message.role === "user");
  if (lastUser === undefined) return null;
  if (typeof lastUser.content === "string") return lastUser.content;
  return lastUser.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

/**
 * Number of completed tool calls already in the prompt — the step index of
 * the model call about to happen. Matches the `toolResults` view eve's
 * `mockModel` responder receives at replay time.
 */
export function countToolResults(prompt: PromptLike): number {
  let count = 0;
  for (const message of prompt) {
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type === "tool-result") count += 1;
    }
  }
  return count;
}

/** Tool inputs cross the provider boundary as JSON strings; store them parsed. */
function parseToolInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

/** Collapses response content (or accumulated stream parts) into one step. */
function toStep(
  text: string,
  toolCalls: readonly FixtureToolCall[],
): FixtureStep | undefined {
  if (text === "" && toolCalls.length === 0) return undefined;
  return {
    ...(text === "" ? {} : { text }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
  };
}

function record(
  fixturesPath: string,
  prompt: PromptLike,
  step: FixtureStep | undefined,
): void {
  const lastUserMessage = lastUserMessageText(prompt);
  if (step === undefined || lastUserMessage === null) return;
  writeRecordedStep(fixturesPath, {
    lastUserMessage,
    step,
    stepIndex: countToolResults(prompt),
  });
}

/**
 * AI SDK middleware (`wrapLanguageModel`) that serializes every completed
 * model response — streamed or not — into the recordings file, keyed so the
 * fixture replayer finds it again. The response itself passes through
 * untouched.
 */
export function recordingMiddleware(options: {
  readonly fixturesPath: string;
}): LanguageModelMiddleware {
  return {
    async wrapGenerate({ doGenerate, params }) {
      const result = await doGenerate();
      let text = "";
      const toolCalls: FixtureToolCall[] = [];
      for (const part of result.content as readonly PartLike[]) {
        if (part.type === "text" && typeof part.text === "string") {
          text += part.text;
        }
        if (part.type === "tool-call" && typeof part.toolName === "string") {
          toolCalls.push({
            input: parseToolInput(part.input),
            name: part.toolName,
          });
        }
      }
      record(
        options.fixturesPath,
        params.prompt as PromptLike,
        toStep(text, toolCalls),
      );
      return result;
    },

    async wrapStream({ doStream, params }) {
      const result = await doStream();
      let text = "";
      const toolCalls: FixtureToolCall[] = [];
      const stream = result.stream.pipeThrough(
        new TransformStream<PartLike, PartLike>({
          flush() {
            record(
              options.fixturesPath,
              params.prompt as PromptLike,
              toStep(text, toolCalls),
            );
          },
          transform(part, controller) {
            if (part.type === "text-delta" && typeof part.delta === "string") {
              text += part.delta;
            }
            if (
              part.type === "tool-call" &&
              typeof part.toolName === "string"
            ) {
              toolCalls.push({
                input: parseToolInput(part.input),
                name: part.toolName,
              });
            }
            controller.enqueue(part);
          },
        }),
      ) as typeof result.stream;
      return { ...result, stream };
    },
  };
}
