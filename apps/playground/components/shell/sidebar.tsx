"use client";

import { CommandIcon, MenuIcon, TerminalIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type AgentHealth, type ShellAgent, useHealth } from "./health";
import { ThemeToggle } from "./theme";

/**
 * The app shell's left rail: wordmark, live agent list, and a footer with the
 * theme toggle, the ⌘K hint, and the installed eve version. Collapses to a
 * hamburger drawer below `lg`.
 */
export function Sidebar({
  agents,
  eveVersion,
}: {
  readonly agents: readonly ShellAgent[];
  readonly eveVersion: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur lg:hidden">
        <Button
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <MenuIcon className="size-4" />
        </Button>
        <Wordmark />
      </header>

      {/* Mobile drawer + scrim */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-sidebar pg-enter">
            <div className="flex h-12 items-center justify-between px-4">
              <Wordmark />
              <Button
                aria-label="Close navigation"
                onClick={() => setMobileOpen(false)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
            <SidebarBody agents={agents} eveVersion={eveVersion} />
          </div>
        </div>
      ) : null}

      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center px-4">
          <Wordmark />
        </div>
        <SidebarBody agents={agents} eveVersion={eveVersion} />
      </aside>
    </>
  );
}

function Wordmark() {
  return (
    <Link
      className="flex items-center gap-2 font-semibold text-sm tracking-tight"
      href="/"
    >
      <span className="flex size-6 items-center justify-center rounded-md border bg-card text-brand">
        <TerminalIcon className="size-3.5" />
      </span>
      Eve Playground
    </Link>
  );
}

function SidebarBody({
  agents,
  eveVersion,
}: {
  readonly agents: readonly ShellAgent[];
  readonly eveVersion: string;
}) {
  const pathname = usePathname();
  const health = useHealth();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <p className="px-2 pt-1 pb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Agents
        </p>
        <ul className="flex flex-col gap-0.5">
          {agents.map((agent) => {
            const active = pathname === `/agents/${agent.id}`;
            return (
              <li key={agent.id}>
                {agent.enabled ? (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150",
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                    href={`/agents/${agent.id}`}
                  >
                    <HealthDot health={health.get(agent.id)} />
                    <span className="min-w-0 flex-1 truncate">
                      {agent.title}
                    </span>
                    <HealthLatency health={health.get(agent.id)} />
                  </Link>
                ) : (
                  <span className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-muted-foreground/50 text-sm">
                    <span className="size-1.5 shrink-0 rounded-full border border-muted-foreground/40" />
                    <span className="min-w-0 flex-1 truncate">
                      {agent.title}
                    </span>
                    <span className="rounded border px-1 py-px font-mono text-[10px] uppercase">
                      off
                    </span>
                  </span>
                )}
              </li>
            );
          })}
          {agents.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground text-xs">
              No agents configured.
            </li>
          ) : null}
        </ul>
      </nav>

      <div className="shrink-0 border-t px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            className="flex flex-1 items-center justify-between gap-2 rounded-md border bg-card px-2 py-1.5 text-muted-foreground text-xs transition-colors hover:border-brand/40 hover:text-foreground"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("playground:palette"))
            }
            type="button"
          >
            <span>Commands</span>
            <kbd className="flex items-center gap-0.5 rounded border bg-muted/60 px-1 py-px font-mono text-[10px]">
              <CommandIcon className="size-2.5" />K
            </kbd>
          </button>
          <ThemeToggle />
        </div>
        <p className="mt-2 px-0.5 font-mono text-[10px] text-muted-foreground/70">
          eve {eveVersion}
        </p>
      </div>
    </div>
  );
}

export function HealthDot({
  health,
  className,
}: {
  readonly health: AgentHealth | undefined;
  readonly className?: string;
}) {
  const state = health?.state ?? "checking";
  return (
    <span
      className={cn("relative flex size-1.5 shrink-0", className)}
      data-health={state}
    >
      {state === "healthy" ? (
        <span className="absolute inline-flex size-full animate-[ping_2.5s_ease-out_infinite] rounded-full bg-ok/60" />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-1.5 rounded-full",
          state === "checking" && "animate-pulse bg-muted-foreground/60",
          state === "healthy" && "bg-ok",
          state === "unhealthy" && "bg-danger",
        )}
      />
    </span>
  );
}

function HealthLatency({
  health,
}: {
  readonly health: AgentHealth | undefined;
}) {
  if (health?.state !== "healthy") return null;
  return (
    <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
      {health.latencyMs}ms
    </span>
  );
}
