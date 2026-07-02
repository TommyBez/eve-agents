import { z } from "zod";

/**
 * Every environment variable this app reads, in one place. All variables are
 * optional at parse time because the app has working defaults for each one
 * (see .env.example); call `requireEnv` in code paths that cannot proceed
 * without a value.
 */
const envSchema = z.object({
  CODE_REVIEWER_COOLDOWN_REPLY: z.string().optional(),
  CODE_REVIEWER_COOLDOWN_REPLY_SECONDS: z.string().optional(),
  CODE_REVIEWER_PR_COOLDOWN_SECONDS: z.string().optional(),
  CODE_REVIEWER_PRIVATE_REPO_DAILY_LIMIT: z.string().optional(),
  CODE_REVIEWER_PUBLIC_REPO_DAILY_LIMIT: z.string().optional(),
  CODE_REVIEWER_RATE_LIMIT_ENABLED: z.string().optional(),
  CODE_REVIEWER_RATE_LIMIT_FAILURE_MODE: z.string().optional(),
  CODE_REVIEWER_RATE_LIMIT_PREFIX: z.string().optional(),
  CODE_REVIEWER_USER_PR_COOLDOWN_SECONDS: z.string().optional(),
  EVE_MOCK_MODEL: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  KV_REST_API_TOKEN: z.string().optional(),
  KV_REST_API_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Lazily parsed, typed view of `process.env`. Parsed on each call (never at
 * module load) so tests and long-lived processes always see current values.
 */
export function env(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}

/** Returns a variable's value or throws a clear error naming the missing var. */
export function requireEnv(name: keyof Env): string {
  const value = env()[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See apps/code-reviewer/.env.example for the expected configuration.`,
    );
  }

  return value;
}
