const DEFAULT_MCP_URL = "https://mcp.supabase.com/mcp";
const DEFAULT_SLACK_CONNECT_UID = "slack/supabase-data-analyst";
const DEFAULT_MAX_ROWS = 200;
const MIN_MAX_ROWS = 1;
const MAX_MAX_ROWS = 1_000;

export type SupabaseDataAnalystConfig = {
  readonly connectUid: string;
  readonly slackConnectUid: string;
  readonly mcpUrl: string;
  readonly projectRef: string | null;
  readonly readOnly: boolean;
  readonly allowedSchemas: readonly string[];
  readonly blockedTables: ReadonlySet<string>;
  readonly maxRows: number;
};

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const optional = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const getRequiredEnv = (name: string, message: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. ${message}`);
  }
  return value;
};

const parseIdentifierList = (value: string, envName: string): readonly string[] => {
  const identifiers = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (identifiers.length === 0) {
    throw new Error(`${envName} must include at least one schema.`);
  }

  for (const identifier of identifiers) {
    if (!IDENTIFIER_PATTERN.test(identifier)) {
      throw new Error(`${envName} contains invalid identifier "${identifier}".`);
    }
  }

  return identifiers;
};

const parseTableList = (value: string): readonly string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((entry) => {
      const pieces = entry.split(".");
      if (pieces.length > 2) {
        throw new Error(`Invalid SUPABASE_ANALYST_BLOCKED_TABLES entry "${entry}".`);
      }
      for (const piece of pieces) {
        if (!IDENTIFIER_PATTERN.test(piece)) {
          throw new Error(
            `SUPABASE_ANALYST_BLOCKED_TABLES contains invalid identifier "${entry}".`,
          );
        }
      }
      return entry.toLowerCase();
    });

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() !== "false";
};

const readIntegerEnv = (
  envName: string,
  defaultValue: number,
  min: number,
  max: number,
): number => {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return defaultValue;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${envName} must be an integer from ${min} to ${max}.`);
  }
  return value;
};

export const supabaseDataAnalystConfig: SupabaseDataAnalystConfig = {
  connectUid: getRequiredEnv(
    "SUPABASE_CONNECT_UID",
    "Create a Vercel Connect Supabase connector and set this to the returned connector UID.",
  ),
  slackConnectUid:
    process.env.SUPABASE_ANALYST_SLACK_CONNECT_UID?.trim() || DEFAULT_SLACK_CONNECT_UID,
  mcpUrl: process.env.SUPABASE_ANALYST_MCP_URL?.trim() || DEFAULT_MCP_URL,
  projectRef: optional(process.env.SUPABASE_ANALYST_PROJECT_REF),
  readOnly: parseBoolean(process.env.SUPABASE_ANALYST_READ_ONLY, true),
  allowedSchemas: parseIdentifierList(
    process.env.SUPABASE_ANALYST_ALLOWED_SCHEMAS || "public",
    "SUPABASE_ANALYST_ALLOWED_SCHEMAS",
  ),
  blockedTables: new Set(parseTableList(process.env.SUPABASE_ANALYST_BLOCKED_TABLES || "")),
  maxRows: readIntegerEnv(
    "SUPABASE_ANALYST_MAX_ROWS",
    DEFAULT_MAX_ROWS,
    MIN_MAX_ROWS,
    MAX_MAX_ROWS,
  ),
};

export const formatPolicySummary = (): string => {
  const blocked =
    [...supabaseDataAnalystConfig.blockedTables].join(", ") || "none configured";
  return [
    `Supabase MCP URL: ${supabaseDataAnalystConfig.mcpUrl}`,
    `Project ref: ${supabaseDataAnalystConfig.projectRef ?? "not scoped (org-level)"}`,
    `Read-only mode: ${supabaseDataAnalystConfig.readOnly}`,
    `Allowed schemas: ${supabaseDataAnalystConfig.allowedSchemas.join(", ")}`,
    `Blocked tables: ${blocked}`,
    `Max rows per answer: ${supabaseDataAnalystConfig.maxRows}`,
  ].join("\n");
};
