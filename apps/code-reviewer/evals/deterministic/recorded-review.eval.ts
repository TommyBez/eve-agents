import { defineEval } from "eve/evals";

// Recorded eval: in CI (tag `ci`, EVE_MOCK_MODEL=1) the model responses replay
// from evals/fixtures/recordings.json; `pnpm run eval:record` (tag `recorded`,
// EVE_RECORD_FIXTURES=1) re-records them — from the live model with
// AI_GATEWAY_API_KEY set, or from the hand-written mock with EVE_MOCK_MODEL=1
// also set. The prompt is intentionally distinct from the other deterministic
// evals so its fixture key never collides with theirs.
export default defineEval({
  description:
    "Replays a recorded submit_pr_review exchange from committed fixtures.",
  tags: ["ci", "recorded"],
  async test(t) {
    await t.send(`
<github_context>
repository: example/widget
pull_request_number: 12
sender: maintainer
head_sha: def456
</github_context>

Pull request diff:

diff --git a/src/db.ts b/src/db.ts
@@
- const rows = await sql\`SELECT * FROM users WHERE id = \${userId}\`;
+ const rows = await db.query("SELECT * FROM users WHERE id = " + userId);

Review this diff and publish the PR review with submit_pr_review.
`);

    t.succeeded();
    t.calledTool("submit_pr_review", { count: 1 });
    // This text comes from the recorded fixture step, not the live mock — see
    // docs/testing.md ("Recorded evals") for the record → commit → replay loop.
    t.messageIncludes("Published the review");
  },
});
