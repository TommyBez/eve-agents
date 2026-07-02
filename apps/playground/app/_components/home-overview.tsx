"use client";

import {
  AlertTriangleIcon,
  ArrowUpRightIcon,
  BotIcon,
  CloudOffIcon,
  GlobeIcon,
  ServerIcon,
} from "lucide-react";
import Link from "next/link";
import { type ShellAgent, useHealth } from "@/components/shell/health";
import { HealthDot } from "@/components/shell/sidebar";
import { cn } from "@/lib/utils";

/**
 * The overview grid: live stat tiles fed by the shell's shared health poller,
 * then one card per configured agent.
 */
export function HomeOverview({
  agents,
}: {
  readonly agents: readonly ShellAgent[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <StatTiles agents={agents} />
      <section>
        <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Agents
        </h2>
        {agents.length === 0 ? (
          <EmptyRoster />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard agent={agent} key={agent.id} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tiles (KPI row)                                               */
/* ------------------------------------------------------------------ */

function StatTiles({ agents }: { readonly agents: readonly ShellAgent[] }) {
  const health = useHealth();
  const enabled = agents.filter((agent) => agent.enabled);
  // Agents unreachable from this deployment are a fact of where the
  // playground runs, not a failure — keep them out of the health math.
  const reachable = enabled.filter((agent) => !agent.unavailable);
  const unavailableCount = enabled.length - reachable.length;
  const statuses = reachable.map((agent) => health.get(agent.id));
  const checking = statuses.some((status) => status?.state === "checking");
  const healthy = statuses.filter((status) => status?.state === "healthy");
  const latencies = healthy.map((status) =>
    status?.state === "healthy" ? status.latencyMs : 0,
  );
  const avgLatency =
    latencies.length > 0
      ? Math.round(
          latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
        )
      : null;
  const lastChecked = statuses.reduce<number | null>(
    (latest, status) =>
      status && (status.state === "healthy" || status.state === "unhealthy")
        ? Math.max(latest ?? 0, status.checkedAt)
        : latest,
    null,
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatTile
        label="Agents registered"
        value={String(agents.length)}
        detail={
          enabled.length === agents.length
            ? "all enabled"
            : `${enabled.length} enabled`
        }
      />
      <StatTile
        label="Healthy now"
        loading={checking}
        value={checking ? undefined : `${healthy.length}/${reachable.length}`}
        valueClassName={
          healthy.length === reachable.length && reachable.length > 0
            ? "text-ok"
            : healthy.length < reachable.length
              ? "text-danger"
              : undefined
        }
        detail={
          checking
            ? "checking…"
            : healthy.length < reachable.length
              ? `${reachable.length - healthy.length} unreachable`
              : unavailableCount > 0
                ? `${unavailableCount} not in this deployment`
                : "all reachable"
        }
      />
      <StatTile
        label="Avg latency"
        loading={checking}
        mono
        value={
          checking ? undefined : avgLatency === null ? "—" : `${avgLatency}ms`
        }
        detail={
          lastChecked
            ? `checked ${relativeTime(lastChecked)}`
            : "health round-trip"
        }
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  detail,
  mono = false,
  loading = false,
  valueClassName,
}: {
  readonly label: string;
  readonly value?: string;
  readonly detail: string;
  readonly mono?: boolean;
  readonly loading?: boolean;
  readonly valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3.5">
      <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      {loading || value === undefined ? (
        <div className="mt-1.5 h-8 w-16 animate-pulse rounded bg-muted" />
      ) : (
        <p
          className={cn(
            "mt-0.5 font-semibold text-[28px] leading-9 tracking-tight",
            mono && "font-mono tabular-nums",
            valueClassName,
          )}
        >
          {value}
        </p>
      )}
      <p className="mt-0.5 text-muted-foreground text-xs">{detail}</p>
    </div>
  );
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

/* ------------------------------------------------------------------ */
/* Agent cards                                                        */
/* ------------------------------------------------------------------ */

function AgentCard({ agent }: { readonly agent: ShellAgent }) {
  const health = useHealth();
  const status = agent.enabled ? health.get(agent.id) : undefined;

  const card = (
    <div
      className={cn(
        "group flex h-full flex-col gap-3 rounded-lg border bg-card p-4 transition-colors duration-150",
        agent.enabled ? "hover:border-brand/40" : "opacity-60",
      )}
      data-testid={`agent-card-${agent.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground">
            <BotIcon className="size-3.5" />
          </span>
          <span className="truncate font-medium text-sm">{agent.title}</span>
        </div>
        {agent.enabled ? (
          <StatusPill agentId={agent.id} />
        ) : (
          <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">
            disabled
          </span>
        )}
      </div>

      <p className="line-clamp-2 min-h-8 text-muted-foreground text-xs leading-4">
        {agent.description || "No description."}
      </p>

      {agent.dangling ? (
        <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-warn text-xs">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Local target, but no{" "}
            <code className="font-mono">apps/{agent.id}</code> directory exists
            — this entry looks dangling.
          </span>
        </p>
      ) : null}

      {agent.unavailable ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 px-2.5 py-2 text-muted-foreground text-xs">
          <CloudOffIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Not available in this deployment — set{" "}
            <code className="font-mono">{urlOverrideEnvVar(agent.id)}</code> to
            reach it.
          </span>
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between border-t pt-3">
        <span className="flex items-center gap-1.5 font-mono text-muted-foreground text-xs">
          {agent.targetLabel === "remote" ? (
            <GlobeIcon className="size-3" />
          ) : (
            <ServerIcon className="size-3" />
          )}
          {agent.targetLabel === "remote"
            ? "remote url"
            : `local ${agent.targetLabel}`}
        </span>
        {agent.enabled ? (
          <span className="inline-flex items-center gap-1 font-medium text-brand text-xs">
            Open
            <ArrowUpRightIcon className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </span>
        ) : null}
      </div>

      {status &&
      (status.state === "healthy" || status.state === "unhealthy") ? (
        <p className="-mt-1 text-[10px] text-muted-foreground/70">
          last checked {relativeTime(status.checkedAt)}
        </p>
      ) : null}
    </div>
  );

  if (!agent.enabled) return card;
  return (
    <Link className="block h-full" href={`/agents/${agent.id}`}>
      {card}
    </Link>
  );
}

function StatusPill({ agentId }: { readonly agentId: string }) {
  const health = useHealth();
  const status = health.get(agentId);
  const state = status?.state ?? "checking";

  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px]",
        state === "healthy" && "border-ok/30 bg-ok/10 text-ok",
        state === "unhealthy" && "border-danger/30 bg-danger/10 text-danger",
        state === "checking" && "text-muted-foreground",
        // Neutral on purpose: unreachable from this deployment, not failing.
        state === "unavailable" && "border-dashed text-muted-foreground",
      )}
      data-health={state}
    >
      <HealthDot health={status} />
      {state === "checking"
        ? "checking"
        : state === "healthy" && status?.state === "healthy"
          ? `up · ${status.latencyMs}ms`
          : status?.state === "unhealthy"
            ? status.detail
            : state}
    </span>
  );
}

/** Client-side mirror of lib/agents.ts `urlOverrideEnvName` (which is server-only). */
function urlOverrideEnvVar(id: string): string {
  return `PLAYGROUND_${id.toUpperCase().replaceAll("-", "_")}_URL`;
}

function EmptyRoster() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <BotIcon className="size-8 text-muted-foreground/40" />
      <div>
        <p className="font-medium text-sm">No agents configured</p>
        <p className="mt-1 text-muted-foreground text-sm">
          Add one to{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            apps/playground/agents.config.json
          </code>{" "}
          or run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            pnpm playground:agents
          </code>
          .
        </p>
      </div>
    </div>
  );
}
