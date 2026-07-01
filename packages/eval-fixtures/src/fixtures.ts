import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One tool call recorded from (or replayed into) a model response. */
export interface FixtureToolCall {
  readonly name: string;
  readonly input?: unknown;
}

/**
 * One model response within a tool loop. `steps[0]` answers the prompt with
 * zero tool results present, `steps[1]` answers after the first tool result,
 * and so on. Mirrors eve's `MockModelResponse` (`text` and/or `toolCalls`).
 */
export interface FixtureStep {
  readonly text?: string;
  readonly toolCalls?: readonly FixtureToolCall[];
}

/** All recorded responses for one distinct user message. */
export interface FixtureEntry {
  /** Human-readable excerpt of the message behind the hash key, for diffs. */
  messagePreview: string;
  /** Responses indexed by tool-result count at call time. */
  steps: (FixtureStep | null)[];
}

/** The whole recordings file: fixture key -> recorded entry. */
export type FixtureRecordings = Record<string, FixtureEntry>;

/** Where recordings live, relative to the app root (`process.cwd()`). */
export const DEFAULT_FIXTURES_PATH = "evals/fixtures/recordings.json";

const PREVIEW_LENGTH = 120;

/**
 * Derives the fixture key for a prompt: a short sha256 of the trimmed last
 * user message. Both the recorder (middleware side) and the replayer
 * (mockModel side) hash the same normalized text, so a recording made against
 * the real model is found again under mock replay.
 */
export function fixtureKey(lastUserMessage: string): string {
  return createHash("sha256")
    .update(lastUserMessage.trim())
    .digest("hex")
    .slice(0, 12);
}

/** Whitespace-collapsed excerpt of the message, stored next to its hash. */
export function messagePreview(lastUserMessage: string): string {
  const collapsed = lastUserMessage.trim().replace(/\s+/g, " ");
  return collapsed.length > PREVIEW_LENGTH
    ? `${collapsed.slice(0, PREVIEW_LENGTH - 1)}…`
    : collapsed;
}

/** Reads the recordings file; a missing file is an empty recording set. */
export function readRecordings(filePath: string): FixtureRecordings {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return JSON.parse(raw) as FixtureRecordings;
}

/**
 * Records one model response: read-modify-write of the recordings file, with
 * keys sorted so the committed JSON stays stable and diffable. Re-recording
 * the same key/step overwrites in place.
 */
export function writeRecordedStep(
  filePath: string,
  options: {
    readonly lastUserMessage: string;
    readonly stepIndex: number;
    readonly step: FixtureStep;
  },
): void {
  const recordings = readRecordings(filePath);
  const key = fixtureKey(options.lastUserMessage);
  const entry = recordings[key] ?? { messagePreview: "", steps: [] };
  entry.messagePreview = messagePreview(options.lastUserMessage);
  while (entry.steps.length < options.stepIndex) entry.steps.push(null);
  entry.steps[options.stepIndex] = options.step;
  recordings[key] = entry;

  const sorted = Object.fromEntries(
    Object.keys(recordings)
      .sort()
      .map((k) => [k, recordings[k]]),
  );
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * Looks up the recorded response for a prompt: key by last-user-message hash,
 * step by the number of tool results already in the prompt. Returns undefined
 * on a miss so the caller can fall back or fail loudly.
 */
export function findRecordedStep(
  recordings: FixtureRecordings,
  options: {
    readonly lastUserMessage: string;
    readonly toolResultCount: number;
  },
): FixtureStep | undefined {
  const entry = recordings[fixtureKey(options.lastUserMessage)];
  return entry?.steps[options.toolResultCount] ?? undefined;
}
