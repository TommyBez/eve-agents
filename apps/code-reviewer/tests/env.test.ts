import { afterEach, describe, expect, it } from "vitest";
import { env, requireEnv } from "../agent/lib/env.js";

const originalSlug = process.env.GITHUB_APP_SLUG;

afterEach(() => {
  if (originalSlug === undefined) {
    delete process.env.GITHUB_APP_SLUG;
  } else {
    process.env.GITHUB_APP_SLUG = originalSlug;
  }
});

describe("env", () => {
  it("reflects the current process environment on each call", () => {
    delete process.env.GITHUB_APP_SLUG;
    expect(env().GITHUB_APP_SLUG).toBeUndefined();

    process.env.GITHUB_APP_SLUG = "code-reviewer";
    expect(env().GITHUB_APP_SLUG).toBe("code-reviewer");
  });
});

describe("requireEnv", () => {
  it("returns the value when the variable is set", () => {
    process.env.GITHUB_APP_SLUG = "code-reviewer";
    expect(requireEnv("GITHUB_APP_SLUG")).toBe("code-reviewer");
  });

  it("throws an error naming the missing variable", () => {
    delete process.env.GITHUB_APP_SLUG;
    expect(() => requireEnv("GITHUB_APP_SLUG")).toThrow(
      /GITHUB_APP_SLUG.*\.env\.example/,
    );
  });
});
