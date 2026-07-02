import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  checkCodeReviewRateLimit,
  claimReviewPublication,
  readRateLimitConfig,
  shouldPostCooldownReply,
} from "../agent/lib/review-rate-limit.js";

const ENV_KEYS = [
  "CODE_REVIEWER_COOLDOWN_REPLY",
  "CODE_REVIEWER_COOLDOWN_REPLY_SECONDS",
  "CODE_REVIEWER_PR_COOLDOWN_SECONDS",
  "CODE_REVIEWER_PRIVATE_REPO_DAILY_LIMIT",
  "CODE_REVIEWER_PUBLIC_REPO_DAILY_LIMIT",
  "CODE_REVIEWER_RATE_LIMIT_ENABLED",
  "CODE_REVIEWER_RATE_LIMIT_FAILURE_MODE",
  "CODE_REVIEWER_RATE_LIMIT_PREFIX",
  "CODE_REVIEWER_USER_PR_COOLDOWN_SECONDS",
  "KV_REST_API_TOKEN",
  "KV_REST_API_URL",
] as const;

const savedEnv = new Map<string, string | undefined>();

function reviewInput(overrides: { isPrivateRepository?: boolean } = {}) {
  return {
    installationId: 1,
    isPrivateRepository: overrides.isPrivateRepository ?? false,
    pullRequestNumber: 42,
    repositoryId: 100,
    senderId: 7,
    senderLogin: "octocat",
  };
}

beforeAll(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

beforeEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("readRateLimitConfig", () => {
  it("applies the documented defaults when no env vars are set", () => {
    expect(readRateLimitConfig()).toEqual({
      cooldownReply: true,
      cooldownReplySeconds: 900,
      enabled: true,
      failureMode: "public_closed",
      prefix: "evex:code-reviewer",
      privateRepoDailyLimit: 25,
      prCooldownSeconds: 900,
      publicRepoDailyLimit: 10,
      userPrCooldownSeconds: 1800,
    });
  });

  it("parses boolean flags case-insensitively with whitespace", () => {
    process.env.CODE_REVIEWER_RATE_LIMIT_ENABLED = " OFF ";
    process.env.CODE_REVIEWER_COOLDOWN_REPLY = "No";

    const config = readRateLimitConfig();

    expect(config.enabled).toBe(false);
    expect(config.cooldownReply).toBe(false);
  });

  it("falls back to defaults for unparseable values", () => {
    process.env.CODE_REVIEWER_RATE_LIMIT_ENABLED = "maybe";
    process.env.CODE_REVIEWER_PR_COOLDOWN_SECONDS = "not-a-number";
    process.env.CODE_REVIEWER_PUBLIC_REPO_DAILY_LIMIT = "-3";
    process.env.CODE_REVIEWER_RATE_LIMIT_FAILURE_MODE = "explode";
    process.env.CODE_REVIEWER_RATE_LIMIT_PREFIX = "   ";

    const config = readRateLimitConfig();

    expect(config.enabled).toBe(true);
    expect(config.prCooldownSeconds).toBe(900);
    expect(config.publicRepoDailyLimit).toBe(10);
    expect(config.failureMode).toBe("public_closed");
    expect(config.prefix).toBe("evex:code-reviewer");
  });

  it("reads custom cooldowns, limits, and failure mode", () => {
    process.env.CODE_REVIEWER_PR_COOLDOWN_SECONDS = "60";
    process.env.CODE_REVIEWER_USER_PR_COOLDOWN_SECONDS = "120";
    process.env.CODE_REVIEWER_PUBLIC_REPO_DAILY_LIMIT = "0";
    process.env.CODE_REVIEWER_RATE_LIMIT_FAILURE_MODE = "open";
    process.env.CODE_REVIEWER_RATE_LIMIT_PREFIX = "custom:prefix";

    const config = readRateLimitConfig();

    expect(config.prCooldownSeconds).toBe(60);
    expect(config.userPrCooldownSeconds).toBe(120);
    expect(config.publicRepoDailyLimit).toBe(0);
    expect(config.failureMode).toBe("open");
    expect(config.prefix).toBe("custom:prefix");
  });
});

describe("checkCodeReviewRateLimit (no Upstash configured)", () => {
  it("allows everything when rate limiting is disabled", async () => {
    process.env.CODE_REVIEWER_RATE_LIMIT_ENABLED = "false";

    await expect(checkCodeReviewRateLimit(reviewInput())).resolves.toEqual({
      allowed: true,
    });
  });

  it("blocks public repositories under the default public_closed mode", async () => {
    await expect(
      checkCodeReviewRateLimit(reviewInput({ isPrivateRepository: false })),
    ).resolves.toEqual({
      allowed: false,
      reason: "rate_limit_unavailable",
    });
  });

  it("allows private repositories under the default public_closed mode", async () => {
    await expect(
      checkCodeReviewRateLimit(reviewInput({ isPrivateRepository: true })),
    ).resolves.toEqual({ allowed: true });
  });

  it("fails open for public repositories when failure mode is open", async () => {
    process.env.CODE_REVIEWER_RATE_LIMIT_FAILURE_MODE = "open";

    await expect(
      checkCodeReviewRateLimit(reviewInput({ isPrivateRepository: false })),
    ).resolves.toEqual({ allowed: true });
  });

  it("fails closed for private repositories when failure mode is closed", async () => {
    process.env.CODE_REVIEWER_RATE_LIMIT_FAILURE_MODE = "closed";

    await expect(
      checkCodeReviewRateLimit(reviewInput({ isPrivateRepository: true })),
    ).resolves.toEqual({
      allowed: false,
      reason: "rate_limit_unavailable",
    });
  });
});

describe("cooldown replies and publication claims (no Upstash configured)", () => {
  it("never posts a cooldown reply without Upstash", async () => {
    await expect(
      shouldPostCooldownReply({
        installationId: 1,
        pullRequestNumber: 42,
        repositoryId: 100,
      }),
    ).resolves.toBe(false);
  });

  it("claims review publication optimistically without Upstash", async () => {
    await expect(
      claimReviewPublication({
        headSha: "abc123",
        installationId: 1,
        pullRequestNumber: 42,
        repositoryId: 100,
        toolCallId: "call_1",
      }),
    ).resolves.toBe(true);
  });
});
