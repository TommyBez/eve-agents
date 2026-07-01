import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

const PRODUCTION_MODEL = "anthropic/claude-sonnet-5";

/**
 * Deterministic fixture model for the `ci`-tagged evals. It exercises the
 * real eve runtime (channel routing, tool wiring, assertions) without a
 * provider call: when the prompt asks for a review, it calls
 * submit_pr_review once, then closes with text. Activated by
 * EVE_MOCK_MODEL=1 (see the `eval:ci` script in package.json).
 */
function mockReviewModel() {
  return mockModel({
    modelId: "code-reviewer-fixture",
    respond: ({ lastUserMessage, toolResults }) => {
      const wantsReview = Boolean(
        lastUserMessage?.includes("submit_pr_review"),
      );

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
    },
  });
}

const useMockModel = Boolean(process.env.EVE_MOCK_MODEL);

export default defineAgent({
  limits: {
    maxInputTokensPerSession: 10_000_000,
  },
  model: useMockModel ? mockReviewModel() : PRODUCTION_MODEL,
  // The fixture is not in the AI Gateway model catalog, so eve cannot resolve
  // its context window; supply one explicitly for mock runs.
  ...(useMockModel ? { modelContextWindowTokens: 200_000 } : {}),
});
