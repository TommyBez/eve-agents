import { defineEval } from "eve/evals";

// Runs against the deterministic fixture model (EVE_MOCK_MODEL=1). Covers
// the plain conversational path: a turn that requests no review completes
// with a text reply and no tool calls.
export default defineEval({
  description: "Replies with plain text and no tools when no review is asked.",
  tags: ["ci"],
  async test(t) {
    await t.send("Hello! What can you do?");

    t.succeeded();
    t.usedNoTools();
    t.messageIncludes("review");
  },
});
