import { defineEval } from "eve/evals";

// Runs against the deterministic fixture model (EVE_MOCK_MODEL=1), so it
// needs no API keys: it exercises eve's runtime, tool wiring, and the
// submit_pr_review contract end to end.
export default defineEval({
  description:
    "Fixture model publishes a PR review through submit_pr_review exactly once.",
  tags: ["ci"],
  async test(t) {
    await t.send(`
<github_context>
repository: example/widget
pull_request_number: 7
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
    t.calledTool("submit_pr_review", { count: 1 });
    t.messageIncludes("submit_pr_review");
  },
});
