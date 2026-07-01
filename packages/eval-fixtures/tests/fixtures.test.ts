import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  countToolResults,
  createReplayResponder,
  FixtureMissError,
  findRecordedStep,
  fixtureKey,
  lastUserMessageText,
  messagePreview,
  type PromptLike,
  readRecordings,
  writeRecordedStep,
} from "../src/index.js";

const tempDirs: string[] = [];

function tempRecordingsPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "eval-fixtures-test-"));
  tempDirs.push(dir);
  return path.join(dir, "fixtures", "recordings.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("fixtureKey", () => {
  it("is a short stable hash of the trimmed message", () => {
    const key = fixtureKey("Review this diff.");
    expect(key).toMatch(/^[0-9a-f]{12}$/);
    expect(fixtureKey("Review this diff.")).toBe(key);
    // The recorder and the replayer both trim before hashing, so leading and
    // trailing whitespace (t.send template literals) never splits a key.
    expect(fixtureKey("\n  Review this diff.\n")).toBe(key);
    expect(fixtureKey("Review that diff.")).not.toBe(key);
  });
});

describe("prompt views", () => {
  const prompt: PromptLike = [
    { content: "Be terse.", role: "system" },
    { content: [{ text: "First ", type: "text" }], role: "user" },
    {
      content: [
        { text: "Calling a tool.", type: "text" },
        { type: "tool-call" },
      ],
      role: "assistant",
    },
    { content: [{ type: "tool-result" }], role: "tool" },
    {
      content: [
        { text: "Second", type: "text" },
        { text: " message", type: "text" },
      ],
      role: "user",
    },
    { content: [{ type: "tool-result" }], role: "tool" },
  ];

  it("extracts the last user message's concatenated text", () => {
    expect(lastUserMessageText(prompt)).toBe("Second message");
    expect(
      lastUserMessageText([{ content: "sys", role: "system" }]),
    ).toBeNull();
  });

  it("indexes steps by the number of tool results in the prompt", () => {
    expect(countToolResults(prompt)).toBe(2);
    expect(countToolResults(prompt.slice(0, 2))).toBe(0);
  });
});

describe("recordings file", () => {
  it("round-trips steps through write and read, sorted and diffable", () => {
    const file = tempRecordingsPath();
    expect(readRecordings(file)).toEqual({}); // missing file = empty set

    const message = "  Review this diff and publish the review.  ";
    writeRecordedStep(file, {
      lastUserMessage: message,
      step: {
        toolCalls: [
          { input: { summary: "One finding." }, name: "submit_pr_review" },
        ],
      },
      stepIndex: 0,
    });
    writeRecordedStep(file, {
      lastUserMessage: message,
      step: { text: "Review published." },
      stepIndex: 1,
    });

    const recordings = readRecordings(file);
    const entry = recordings[fixtureKey(message)];
    expect(entry?.messagePreview).toBe(
      "Review this diff and publish the review.",
    );
    expect(entry?.steps).toEqual([
      {
        toolCalls: [
          { input: { summary: "One finding." }, name: "submit_pr_review" },
        ],
      },
      { text: "Review published." },
    ]);
    expect(
      findRecordedStep(recordings, {
        lastUserMessage: message,
        toolResultCount: 1,
      }),
    ).toEqual({ text: "Review published." });

    // Re-recording overwrites in place instead of appending.
    writeRecordedStep(file, {
      lastUserMessage: message,
      step: { text: "Review re-recorded." },
      stepIndex: 1,
    });
    expect(readRecordings(file)[fixtureKey(message)]?.steps[1]).toEqual({
      text: "Review re-recorded.",
    });

    // Stable pretty-printed JSON: sorted keys, two-space indent, newline EOF.
    const raw = readFileSync(file, "utf8");
    expect(raw.endsWith("}\n")).toBe(true);
    expect(raw).toBe(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
    const keys = Object.keys(JSON.parse(raw) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
  });

  it("truncates long message previews", () => {
    expect(messagePreview(`${"x".repeat(200)}\n\ny`)).toHaveLength(120);
  });
});

describe("createReplayResponder", () => {
  const request = (lastUserMessage: string, toolResultCount = 0) => ({
    lastUserMessage,
    messages: [],
    toolResults: Array.from({ length: toolResultCount }, (_, index) => ({
      id: `call-${index}`,
      isError: false,
      name: "some_tool",
      output: "ok",
    })),
    tools: [],
    userMessageCount: 1,
    userMessages: [lastUserMessage],
  });

  it("serves the recorded step for the message hash and tool-result count", () => {
    const file = tempRecordingsPath();
    writeRecordedStep(file, {
      lastUserMessage: "ping",
      step: { toolCalls: [{ name: "get_weather" }] },
      stepIndex: 0,
    });
    writeRecordedStep(file, {
      lastUserMessage: "ping",
      step: { text: "Recorded reply." },
      stepIndex: 1,
    });

    const respond = createReplayResponder({ fixturesPath: file });
    expect(respond(request("ping"))).toEqual({
      toolCalls: [{ name: "get_weather" }],
    });
    expect(respond(request("ping", 1))).toEqual({ text: "Recorded reply." });
  });

  it("falls back to the hand-written mock on a miss", () => {
    const respond = createReplayResponder({
      fallback: ({ lastUserMessage }) => `MOCK: ${lastUserMessage}`,
      fixturesPath: tempRecordingsPath(),
    });
    expect(respond(request("never recorded"))).toBe("MOCK: never recorded");
  });

  it("throws an actionable miss error without a fallback", () => {
    const file = tempRecordingsPath();
    const respond = createReplayResponder({ fixturesPath: file });
    const act = () => respond(request("never recorded"));
    expect(act).toThrow(FixtureMissError);
    expect(act).toThrow(fixtureKey("never recorded"));
    expect(act).toThrow("run eval:record");
  });
});
