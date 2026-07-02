"use client";

import type { HandleMessageStreamEvent } from "eve/client";
import {
  ArrowDownToLineIcon,
  BanIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  InboxIcon,
  SearchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Raw event inspector for the current chat session: a dense mono table with
 * one row per eve stream event — category-colored type badge, relative time,
 * one-line payload preview — expandable to the pretty-printed JSON.
 */

type Category = "lifecycle" | "message" | "tool" | "hitl" | "failure" | "other";

const CATEGORIES: readonly { readonly id: Category; readonly label: string }[] =
  [
    { id: "lifecycle", label: "lifecycle" },
    { id: "message", label: "message" },
    { id: "tool", label: "actions" },
    { id: "hitl", label: "hitl" },
    { id: "failure", label: "failures" },
    { id: "other", label: "other" },
  ];

function categorize(type: string): Category {
  if (type.endsWith(".failed")) return "failure";
  const family = type.split(".")[0];
  switch (family) {
    case "session":
    case "turn":
    case "step":
      return "lifecycle";
    case "message":
    case "reasoning":
    case "result":
      return "message";
    case "actions":
    case "action":
    case "subagent":
      return "tool";
    case "input":
    case "authorization":
      return "hitl";
    default:
      return "other";
  }
}

/** Badge + chip tones per category. Identity is never color-alone: the badge
 *  always contains the literal event type. */
const CATEGORY_TONES: Record<Category, string> = {
  failure: "border-danger/40 bg-danger/10 text-danger",
  hitl: "border-warn/40 bg-warn/10 text-warn",
  lifecycle: "border-border bg-muted/60 text-muted-foreground",
  message: "border-brand/40 bg-brand/10 text-brand",
  other: "border-border bg-muted/60 text-muted-foreground",
  tool: "border-tool/40 bg-tool/10 text-tool",
};

/** Accent edge on the expanded JSON block, echoing the row's category. */
const CATEGORY_EDGES: Record<Category, string> = {
  failure: "border-l-danger/60",
  hitl: "border-l-warn/60",
  lifecycle: "border-l-muted-foreground/30",
  message: "border-l-brand/60",
  other: "border-l-muted-foreground/30",
  tool: "border-l-tool/60",
};

export function EventsPanel({
  events,
}: {
  readonly events: readonly HandleMessageStreamEvent[];
}) {
  const [filter, setFilter] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(CATEGORIES.map((category) => category.id)),
  );
  const [followTail, setFollowTail] = useState(true);
  const [clearedBefore, setClearedBefore] = useState(0);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const t0 = useMemo(() => {
    const at = events[0]?.meta?.at;
    return typeof at === "string" ? Date.parse(at) : null;
  }, [events]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return events
      .map((event, index) => ({
        category: categorize(event.type),
        event,
        index,
      }))
      .filter(({ index }) => index >= clearedBefore)
      .filter(({ category }) => activeCategories.has(category))
      .filter(
        ({ event }) => !needle || event.type.toLowerCase().includes(needle),
      );
  }, [events, filter, activeCategories, clearedBefore]);

  // Auto-scroll to the newest row, but only while following the tail.
  useEffect(() => {
    if (!followTail) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [followTail, events.length]);

  const toggleCategory = (id: Category) => {
    setActiveCategories((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          visible.map(({ event }) => event),
          null,
          2,
        ),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — nothing to do.
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="events-panel">
      {/* Sticky toolbar */}
      <div className="shrink-0 border-b bg-background/90 px-4 py-2 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
            <Input
              className="h-7.5 w-56 pl-8 font-mono text-xs"
              onChange={(changeEvent) => setFilter(changeEvent.target.value)}
              placeholder="Filter by type…"
              value={filter}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {CATEGORIES.map((category) => {
              const active = activeCategories.has(category.id);
              return (
                <button
                  aria-pressed={active}
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors duration-150",
                    active
                      ? CATEGORY_TONES[category.id]
                      : "border-transparent text-muted-foreground/50 hover:text-muted-foreground",
                  )}
                  key={category.id}
                  onClick={() => toggleCategory(category.id)}
                  type="button"
                >
                  {category.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="mr-1 font-mono text-[11px] text-muted-foreground tabular-nums">
              {visible.length}/{Math.max(events.length - clearedBefore, 0)}
            </span>
            <button
              aria-pressed={followTail}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium text-[11px] transition-colors duration-150",
                followTail
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setFollowTail((current) => !current)}
              type="button"
            >
              <ArrowDownToLineIcon className="size-3" />
              Follow
            </button>
            <Button
              aria-label="Copy visible events as JSON"
              disabled={visible.length === 0}
              onClick={() => void copyAll()}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              {copied ? (
                <CheckIcon className="size-3 text-ok" />
              ) : (
                <CopyIcon className="size-3" />
              )}
            </Button>
            <Button
              aria-label="Clear event list"
              disabled={events.length === clearedBefore}
              onClick={() => setClearedBefore(events.length)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <BanIcon className="size-3" />
            </Button>
          </div>
        </div>
      </div>

      {events.length === 0 || events.length <= clearedBefore ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg border bg-card">
            <InboxIcon className="size-4.5 text-muted-foreground/60" />
          </span>
          <div>
            <p className="font-medium text-sm">
              {events.length === 0 ? "No events yet" : "Event list cleared"}
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              {events.length === 0
                ? "Send a message in the Chat tab and the raw stream shows up here."
                : "New stream events will appear as they arrive."}
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
          <ul className="divide-y divide-border/60">
            {visible.map(({ event, index, category }) => (
              <EventRow
                category={category}
                event={event}
                index={index}
                key={`${index}-${event.type}`}
                t0={t0}
              />
            ))}
          </ul>
          {visible.length === 0 ? (
            <p className="px-6 py-10 text-center text-muted-foreground text-xs">
              No events match the current filter.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function relativeTime(at: unknown, t0: number | null): string | null {
  if (typeof at !== "string" || t0 === null) return null;
  const deltaMs = Date.parse(at) - t0;
  if (!Number.isFinite(deltaMs)) return null;
  return `+${(deltaMs / 1000).toFixed(3)}s`;
}

function preview(event: HandleMessageStreamEvent): string {
  const data = (event as { data?: unknown }).data;
  if (data === undefined) return "";
  try {
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

function EventRow({
  category,
  event,
  index,
  t0,
}: {
  readonly category: Category;
  readonly event: HandleMessageStreamEvent;
  readonly index: number;
  readonly t0: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rel = relativeTime(event.meta?.at, t0);

  const copyEvent = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable.
    }
  };

  return (
    <li data-event-type={event.type}>
      <button
        className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors duration-100 hover:bg-accent/40 sm:px-6"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronRightIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted-foreground/60 tabular-nums">
          {index}
        </span>
        <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {rel ?? "—"}
        </span>
        <span
          className={cn(
            "shrink-0 rounded border px-1.5 py-px font-mono text-[11px]",
            CATEGORY_TONES[category],
          )}
        >
          {event.type}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
          {preview(event)}
        </span>
      </button>
      {open ? (
        <div
          className={cn(
            "relative border-t border-l-2 bg-card/60",
            CATEGORY_EDGES[category],
          )}
        >
          <Button
            aria-label="Copy event JSON"
            className="absolute top-2 right-3"
            onClick={() => void copyEvent()}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            {copied ? (
              <CheckIcon className="size-3 text-ok" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </Button>
          <pre className="overflow-x-auto px-6 py-3 font-mono text-[11px] leading-4.5 sm:px-14">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      ) : null}
    </li>
  );
}
