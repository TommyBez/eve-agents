import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

import { supabaseDataAnalystConfig } from "../lib/supabase-data-analyst-config.js";

const READ_TOOLS = [
  "list_tables",
  "list_extensions",
  "list_migrations",
  "execute_sql",
  "get_logs",
  "get_advisors",
  "get_project_url",
  "get_publishable_keys",
  "generate_typescript_types",
  "list_edge_functions",
  "get_edge_function",
  "search_docs",
] as const;

const WRITE_TOOLS = [
  "apply_migration",
  "deploy_edge_function",
] as const;

const normalizeToolName = (toolName: string): string =>
  toolName.split("__").at(-1) ?? toolName;

const isWriteTool = (toolName: string): boolean =>
  (WRITE_TOOLS as readonly string[]).includes(toolName);

const buildMcpUrl = (): string => {
  const base = supabaseDataAnalystConfig.mcpUrl;
  const params = new URLSearchParams();
  if (supabaseDataAnalystConfig.projectRef) {
    params.set("project_ref", supabaseDataAnalystConfig.projectRef);
  }
  if (supabaseDataAnalystConfig.readOnly) {
    params.set("read_only", "true");
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
};

export default defineMcpClientConnection({
  url: buildMcpUrl(),
  description:
    "Supabase project analytics: list tables and extensions, inspect migrations, and run read-only SQL through the Supabase MCP server.",
  auth: connect(supabaseDataAnalystConfig.connectUid),
  tools: {
    allow: [...READ_TOOLS, ...WRITE_TOOLS],
  },
  approval: ({ toolName }) => {
    const normalized = normalizeToolName(toolName);
    if (isWriteTool(normalized)) {
      return true;
    }
    return false;
  },
});
