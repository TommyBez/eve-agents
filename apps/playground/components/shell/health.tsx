"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * One shared health poller for the whole shell: every enabled agent's
 * `/eve/v1/health` is checked through the same-origin proxy on a single
 * interval, and the sidebar, home stat tiles, and agent cards all read from
 * the same snapshot (instead of each mounting its own poller).
 */

const POLL_INTERVAL_MS = 10_000;

export type AgentHealth =
  | { readonly state: "checking" }
  | {
      readonly state: "healthy";
      readonly latencyMs: number;
      readonly checkedAt: number;
    }
  | {
      readonly state: "unhealthy";
      readonly detail: string;
      readonly checkedAt: number;
    }
  // Not reachable from this deployment (loopback target, no env override);
  // never polled — it would only produce a misleading red badge.
  | { readonly state: "unavailable" };

/** Serializable agent descriptor passed from server components to the shell. */
export type ShellAgent = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly targetLabel: string;
  readonly dangling: boolean;
  readonly unavailable: boolean;
};

const HealthContext = createContext<ReadonlyMap<string, AgentHealth> | null>(
  null,
);

async function checkOne(agentId: string): Promise<AgentHealth> {
  const startedAt = performance.now();
  try {
    const response = await fetch(`/api/agents/${agentId}/eve/v1/health`, {
      cache: "no-store",
    });
    const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
    if (response.ok) {
      return { checkedAt: Date.now(), latencyMs, state: "healthy" };
    }
    return {
      checkedAt: Date.now(),
      detail: `HTTP ${response.status}`,
      state: "unhealthy",
    };
  } catch {
    return { checkedAt: Date.now(), detail: "offline", state: "unhealthy" };
  }
}

export function HealthProvider({
  agents,
  children,
}: {
  readonly agents: readonly ShellAgent[];
  readonly children: ReactNode;
}) {
  // Unavailable agents (unreachable from this deployment) are never polled;
  // they sit in the map with a static neutral state instead.
  const pollableIds = useMemo(
    () =>
      agents
        .filter((agent) => agent.enabled && !agent.unavailable)
        .map((agent) => agent.id),
    [agents],
  );
  const unavailableIds = useMemo(
    () =>
      agents
        .filter((agent) => agent.enabled && agent.unavailable)
        .map((agent) => agent.id),
    [agents],
  );
  const [health, setHealth] = useState<ReadonlyMap<string, AgentHealth>>(
    () =>
      new Map<string, AgentHealth>([
        ...pollableIds.map((id) => [id, { state: "checking" }] as const),
        ...unavailableIds.map((id) => [id, { state: "unavailable" }] as const),
      ]),
  );

  useEffect(() => {
    let cancelled = false;

    const sweep = async () => {
      const results = await Promise.all(
        pollableIds.map(async (id) => [id, await checkOne(id)] as const),
      );
      if (!cancelled) {
        setHealth(
          new Map<string, AgentHealth>([
            ...results,
            ...unavailableIds.map(
              (id) => [id, { state: "unavailable" }] as const,
            ),
          ]),
        );
      }
    };

    void sweep();
    const timer = setInterval(() => void sweep(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollableIds, unavailableIds]);

  return (
    <HealthContext.Provider value={health}>{children}</HealthContext.Provider>
  );
}

export function useHealth(): ReadonlyMap<string, AgentHealth> {
  const context = useContext(HealthContext);
  if (!context) throw new Error("useHealth must be used within HealthProvider");
  return context;
}
