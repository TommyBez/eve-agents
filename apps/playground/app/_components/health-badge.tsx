"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 10_000;

type Health =
  | { readonly state: "checking" }
  | { readonly state: "healthy"; readonly latencyMs: number }
  | { readonly state: "unhealthy"; readonly detail: string };

/**
 * Live health pill: polls the agent's public `/eve/v1/health` through the
 * same-origin proxy and shows round-trip latency.
 */
export function HealthBadge({ agentId }: { readonly agentId: string }) {
  const [health, setHealth] = useState<Health>({ state: "checking" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const check = async () => {
      const startedAt = performance.now();
      try {
        const response = await fetch(`/api/agents/${agentId}/eve/v1/health`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const latencyMs = Math.max(
          1,
          Math.round(performance.now() - startedAt),
        );
        if (cancelled) return;
        if (response.ok) {
          setHealth({ state: "healthy", latencyMs });
        } else {
          setHealth({ state: "unhealthy", detail: `HTTP ${response.status}` });
        }
      } catch {
        if (!cancelled) setHealth({ state: "unhealthy", detail: "offline" });
      }
    };

    void check();
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [agentId]);

  return (
    <Badge
      className={cn(
        "gap-1.5 font-normal",
        health.state === "healthy" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        health.state === "unhealthy" &&
          "border-destructive/40 bg-destructive/10 text-destructive",
      )}
      data-health={health.state}
      variant="outline"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          health.state === "checking" && "animate-pulse bg-muted-foreground",
          health.state === "healthy" && "bg-emerald-500",
          health.state === "unhealthy" && "bg-destructive",
        )}
      />
      {health.state === "checking"
        ? "checking"
        : health.state === "healthy"
          ? `healthy · ${health.latencyMs}ms`
          : health.detail}
    </Badge>
  );
}
