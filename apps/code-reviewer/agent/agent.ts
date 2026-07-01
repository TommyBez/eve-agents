import { evalModel, isEvalModelActive } from "@repo/eval-fixtures";
import { defineAgent } from "eve";
import type { MockModelRequest, MockModelResponse } from "eve/evals";

const PRODUCTION_MODEL = "anthropic/claude-sonnet-5";

/**
 * Hand-written deterministic behavior for the `ci`-tagged evals. It exercises
 * the real eve runtime (channel routing, tool wiring, assertions) without a
 * provider call: when the prompt asks for a review, it calls submit_pr_review
 * once, then closes with text.
 *
 * `evalModel` uses this two ways: as the replay fallback for prompts with no
 * recorded fixture (EVE_MOCK_MODEL=1), and as the model being recorded when
 * bootstrapping fixtures offline (EVE_RECORD_FIXTURES=1 + EVE_MOCK_MODEL=1).
 */
function reviewMock({
  lastUserMessage,
  toolResults,
}: MockModelRequest): MockModelResponse | string {
  const wantsReview = Boolean(lastUserMessage?.includes("submit_pr_review"));

  if (!wantsReview) {
    return "Mock reviewer ready. Send a pull request diff and ask for a review with submit_pr_review.";
  }

  const alreadySubmitted = toolResults.some(
    (result) => result.name === "submit_pr_review",
  );

  if (!alreadySubmitted) {
    return {
      toolCalls: [
        {
          input: {
            comments: [
              {
                body: "The ownership check on requestedUserId was removed; any signed-in user can now read other users' data.",
                line: 4,
                path: "src/auth.ts",
                severity: "blocking",
                side: "RIGHT",
              },
            ],
            summary:
              "One blocking finding: the authorization check comparing session.userId to requestedUserId was dropped.",
          },
          name: "submit_pr_review",
        },
      ],
    };
  }

  return "Published the review with submit_pr_review: one blocking inline finding on src/auth.ts.";
}

export default defineAgent({
  limits: {
    maxInputTokensPerSession: 10_000_000,
  },
  // Production: the gateway model id. EVE_MOCK_MODEL=1 (eval:ci): recorded
  // fixtures from evals/fixtures/recordings.json, falling back to reviewMock.
  // EVE_RECORD_FIXTURES=1 (eval:record): records model responses into that
  // file. See @repo/eval-fixtures.
  model: evalModel({
    mock: reviewMock,
    modelId: "code-reviewer-fixture",
    production: PRODUCTION_MODEL,
  }),
  // Mock/recording models are not resolved through the AI Gateway model
  // catalog, so eve cannot look up their context window; supply one.
  ...(isEvalModelActive() ? { modelContextWindowTokens: 200_000 } : {}),
});
