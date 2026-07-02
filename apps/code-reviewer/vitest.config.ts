import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the app's own tests; keeps vitest out of .eve dev-runtime
    // snapshots, which contain copies of this tree.
    include: ["tests/**/*.test.ts"],
  },
});
