import { defineEval } from "eve/evals";

type SubmitPrReviewInput = {
  comments?: readonly { path?: string; severity?: string }[];
  summary?: string;
};

// Runs against the deterministic fixture model (EVE_MOCK_MODEL=1). Asserts
// the shape of the submit_pr_review payload: a summary plus one blocking
// inline comment anchored to the changed file, submitted exactly once.
export default defineEval({
  description:
    "submit_pr_review carries a summary and a blocking inline comment.",
  tags: ["ci"],
  async test(t) {
    await t.send(`
<github_context>
repository: example/widget
pull_request_number: 8
sender: maintainer
head_sha: abc123
</github_context>

Pull request diff:

diff --git a/src/auth.ts b/src/auth.ts
@@
- if (session.userId !== requestedUserId) {
-   throw new Error("forbidden");
- }
+ if (session.userId) {
+   return getUser(requestedUserId);
+ }

Review this diff and publish the PR review with submit_pr_review.
`);

    t.succeeded();
    t.maxToolCalls(1);
    t.calledTool("submit_pr_review", {
      count: 1,
      input: (value: unknown) => {
        const input = value as SubmitPrReviewInput;
        const [comment] = input.comments ?? [];

        return (
          Boolean(input.summary) &&
          comment?.path === "src/auth.ts" &&
          comment?.severity === "blocking"
        );
      },
    });
    t.noFailedActions();
  },
});
