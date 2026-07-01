import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  fixtureKey,
  readRecordings,
  recordingMiddleware,
} from "../src/index.js";

const tempDirs: string[] = [];

function tempRecordingsPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eval-fixtures-test-"));
  tempDirs.push(dir);
  return path.join(dir, "recordings.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const MESSAGE = "Review this diff for the recording test.";

// Minimal structural stand-ins for the AI SDK call options and results; the
// middleware only reads prompt/content/stream, so everything else is omitted.
const params = {
  prompt: [
    { content: "Be terse.", role: "system" },
    { content: [{ text: MESSAGE, type: "text" }], role: "user" },
  ],
} as never;

type Middleware = ReturnType<typeof recordingMiddleware>;
type GenerateOptions = Parameters<NonNullable<Middleware["wrapGenerate"]>>[0];
type StreamOptions = Parameters<NonNullable<Middleware["wrapStream"]>>[0];

describe("recordingMiddleware", () => {
  it("records a doGenerate response and returns it untouched", async () => {
    const file = tempRecordingsPath();
    const middleware = recordingMiddleware({ fixturesPath: file });
    const generated = {
      content: [
        { text: "Submitting a review.", type: "text" },
        {
          input: '{"summary":"One finding."}',
          toolCallId: "call-1",
          toolName: "submit_pr_review",
          type: "tool-call",
        },
      ],
    };

    const result = await middleware.wrapGenerate?.({
      doGenerate: async () => generated,
      params,
    } as unknown as GenerateOptions);

    expect(result).toBe(generated);
    expect(readRecordings(file)[fixtureKey(MESSAGE)]?.steps[0]).toEqual({
      text: "Submitting a review.",
      toolCalls: [
        { input: { summary: "One finding." }, name: "submit_pr_review" },
      ],
    });
  });

  it("accumulates a doStream response and records it on finish", async () => {
    const file = tempRecordingsPath();
    const middleware = recordingMiddleware({ fixturesPath: file });
    const parts = [
      { id: "t1", type: "text-start" },
      { delta: "Streamed ", id: "t1", type: "text-delta" },
      { delta: "reply.", id: "t1", type: "text-delta" },
      { id: "t1", type: "text-end" },
      { type: "finish" },
    ];

    const result = await middleware.wrapStream?.({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      }),
      params,
    } as unknown as StreamOptions);

    // The consumer sees every part unchanged...
    const seen = [];
    const reader = result?.stream.getReader();
    for (;;) {
      const { done, value } = (await reader?.read()) ?? { done: true };
      if (done) break;
      seen.push(value);
    }
    expect(seen).toEqual(parts);

    // ...and the accumulated text lands in the recordings file.
    expect(readRecordings(file)[fixtureKey(MESSAGE)]?.steps[0]).toEqual({
      text: "Streamed reply.",
    });
  });
});
