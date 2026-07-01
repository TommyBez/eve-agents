import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { LanguageModel } from "ai";
import {
  type MockModelResponder,
  type MockModelResponse,
  mockModel,
} from "eve/evals";
import {
  DEFAULT_FIXTURES_PATH,
  type FixtureRecordings,
  findRecordedStep,
  fixtureKey,
  readRecordings,
} from "./fixtures.js";
import { recordingMiddleware } from "./recording.js";

export {
  DEFAULT_FIXTURES_PATH,
  type FixtureEntry,
  type FixtureRecordings,
  type FixtureStep,
  type FixtureToolCall,
  findRecordedStep,
  fixtureKey,
  messagePreview,
  readRecordings,
  writeRecordedStep,
} from "./fixtures.js";
export {
  countToolResults,
  lastUserMessageText,
  type PromptLike,
  recordingMiddleware,
} from "./recording.js";

/** Thrown at replay time when a prompt has no recorded fixture (and no fallback). */
export class FixtureMissError extends Error {}

export interface EvalModelOptions {
  /** Gateway model id used outside eval runs (e.g. "anthropic/claude-sonnet-5"). */
  readonly production: string;
  /**
   * Hand-written deterministic responder, used when replay finds no recorded
   * fixture for a prompt — and as the model being recorded when both
   * EVE_RECORD_FIXTURES and EVE_MOCK_MODEL are set.
   */
  readonly mock?: MockModelResponder;
  /** Recordings file; defaults to evals/fixtures/recordings.json in the app. */
  readonly fixturesPath?: string;
  /** Model id the mock/replay fixture reports to the eve runtime. */
  readonly modelId?: string;
}

/**
 * True when the agent is running under an eval-model mode (mock replay or
 * fixture recording). In these modes `evalModel` returns a `LanguageModel`
 * instance rather than a gateway id string, so eve cannot resolve the model's
 * context window from the AI Gateway catalog — the agent should supply
 * `modelContextWindowTokens` explicitly while this is true.
 */
export function isEvalModelActive(): boolean {
  return Boolean(process.env.EVE_RECORD_FIXTURES || process.env.EVE_MOCK_MODEL);
}

/**
 * Loads the AI SDK at runtime, resolved from the app root. This must not be a
 * static (or analyzable dynamic) import: eve bundles `agent.ts` and its
 * imports into a single chunk, and inlining `ai` forces a chunk split (its
 * gateway provider lazy-loads `@vercel/oidc`), which eve's authored-module
 * loader rejects. Only the recording modes ever call this, so normal runs and
 * mock replay never touch the AI SDK.
 */
function loadAiSdk(): typeof import("ai") {
  const requireFromApp = createRequire(
    path.join(process.cwd(), "package.json"),
  );
  return requireFromApp("ai") as typeof import("ai");
}

/** Best-effort app name for actionable error messages. */
function appName(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    ) as { name?: string };
    return pkg.name ?? "<app>";
  } catch {
    return "<app>";
  }
}

/**
 * `mockModel` responder that replays recorded fixtures: key = hash of the
 * trimmed last user message, step = number of tool results already in the
 * prompt. Falls back to `fallback` on a miss, then fails with the missing key
 * and the command that records it.
 */
export function createReplayResponder(options: {
  readonly fixturesPath: string;
  readonly fallback?: MockModelResponder;
}): MockModelResponder {
  let recordings: FixtureRecordings | undefined;
  return (request) => {
    recordings ??= readRecordings(options.fixturesPath);
    const lastUserMessage = request.lastUserMessage ?? "";
    const step = findRecordedStep(recordings, {
      lastUserMessage,
      toolResultCount: request.toolResults.length,
    });
    if (step !== undefined) return step as MockModelResponse;
    if (options.fallback !== undefined) return options.fallback(request);
    throw new FixtureMissError(
      `No recorded fixture for key "${fixtureKey(lastUserMessage)}" ` +
        `(step ${request.toolResults.length}) in ${options.fixturesPath}. ` +
        `Record it with: pnpm --filter ${appName()} run eval:record`,
    );
  };
}

/**
 * The model an agent should run with, decided by the eval env switches:
 *
 * - No switch: returns `production` (the gateway model id string) untouched.
 * - `EVE_RECORD_FIXTURES=1`: the production model as a real gateway
 *   `LanguageModel`, wrapped with recording middleware that serializes every
 *   completed response into the recordings file. Needs `AI_GATEWAY_API_KEY`.
 * - `EVE_RECORD_FIXTURES=1` + `EVE_MOCK_MODEL=1`: records the hand-written
 *   `mock` responder instead of the gateway — the offline way to bootstrap or
 *   refresh fixtures without an API key.
 * - `EVE_MOCK_MODEL=1`: a `mockModel` fixture that replays recorded fixtures
 *   first and falls back to `mock` for prompts that were never recorded.
 */
export function evalModel(options: EvalModelOptions): LanguageModel {
  const recording = Boolean(process.env.EVE_RECORD_FIXTURES);
  const mocked = Boolean(process.env.EVE_MOCK_MODEL);
  const fixturesPath = path.resolve(
    process.cwd(),
    options.fixturesPath ?? DEFAULT_FIXTURES_PATH,
  );

  if (recording) {
    const { gateway, wrapLanguageModel } = loadAiSdk();
    // `mockModel` is typed as `LanguageModel` (which admits id strings), but
    // it always returns a model instance, so it is safe to wrap.
    type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];
    const model = (
      mocked
        ? mockModel({ modelId: options.modelId, respond: options.mock })
        : gateway(options.production)
    ) as WrappableModel;
    return wrapLanguageModel({
      middleware: recordingMiddleware({ fixturesPath }),
      model,
    });
  }

  if (mocked) {
    return mockModel({
      modelId: options.modelId,
      respond: createReplayResponder({
        fallback: options.mock,
        fixturesPath,
      }),
    });
  }

  return options.production as LanguageModel;
}
