import {
  type AgentEntry,
  resolveAuthHeader,
  resolveBaseUrl,
} from "@/lib/agents";

/**
 * Server-side fetchers for the read-only eve inspection routes
 * (`/eve/v1/health`, `/eve/v1/info`), plus loose types for the parts of the
 * `/eve/v1/info` payload the diagnostics tab renders. The payload is
 * intentionally typed defensively — eve is pre-1.0 and fields move.
 */

type AgentInfo = {
  readonly agent?: {
    readonly name?: string;
    readonly model?: {
      readonly id?: string;
      readonly contextWindowTokens?: number;
      readonly routing?: {
        readonly kind?: string;
        readonly target?: string;
        readonly provider?: string;
      };
    };
  };
  readonly tools?: {
    readonly available?: readonly {
      readonly name: string;
      readonly description?: string;
      readonly origin?: string;
      readonly requiresApproval?: boolean;
    }[];
  };
  readonly channels?: {
    readonly authored?: readonly ChannelRoute[];
    readonly available?: readonly ChannelRoute[];
    readonly framework?: readonly ChannelRoute[];
  };
  readonly skills?: {
    readonly static?: readonly {
      readonly logicalPath?: string;
      readonly description?: string;
    }[];
  };
  readonly connections?: readonly { readonly name?: string }[];
  readonly schedules?: readonly {
    readonly logicalPath?: string;
    readonly cron?: string;
    readonly description?: string;
  }[];
  readonly subagents?: { readonly total?: number };
  readonly instructions?: {
    readonly static?: { readonly markdown?: string };
  };
  readonly diagnostics?: {
    readonly discoveryErrors?: number | readonly unknown[];
    readonly discoveryWarnings?: number | readonly unknown[];
  };
  readonly mode?: string;
};

type ChannelRoute = {
  readonly name?: string;
  readonly method?: string;
  readonly urlPath?: string;
  readonly origin?: string;
};

export type InfoResult =
  | { readonly ok: true; readonly info: AgentInfo }
  | {
      readonly ok: false;
      readonly kind: "unauthorized" | "unreachable" | "error";
      readonly detail: string;
    };

/**
 * Fetches `/eve/v1/info` directly from the agent, attaching the same
 * server-held credentials the proxy route uses. Runs only on the server.
 */
export async function fetchAgentInfo(agent: AgentEntry): Promise<InfoResult> {
  const base = resolveBaseUrl(agent.target);
  const headers = new Headers({ accept: "application/json" });
  const auth = resolveAuthHeader(agent.target);
  if (auth) headers.set("authorization", auth);

  let response: Response;
  try {
    response = await fetch(`${base}/eve/v1/info`, {
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    return {
      ok: false,
      kind: "unreachable",
      detail: `Could not reach ${base}: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      kind: "unauthorized",
      detail: `${base}/eve/v1/info answered ${response.status}.`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      kind: "error",
      detail: `${base}/eve/v1/info answered ${response.status} ${response.statusText}.`,
    };
  }

  try {
    return { ok: true, info: (await response.json()) as AgentInfo };
  } catch {
    return {
      ok: false,
      kind: "error",
      detail: `${base}/eve/v1/info did not return JSON.`,
    };
  }
}

/** Count out of either shape eve has used for discovery diagnostics. */
export function diagnosticCount(
  value: number | readonly unknown[] | undefined,
): number {
  if (typeof value === "number") return value;
  return value?.length ?? 0;
}
