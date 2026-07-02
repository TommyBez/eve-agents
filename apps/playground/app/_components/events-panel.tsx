"use client";

import type { HandleMessageStreamEvent } from "eve/client";
import { ChevronRightIcon, InboxIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Raw event inspector for the current chat session: one row per eve stream
 * event, type-colored, expandable to the full JSON payload, filterable by a
 * type substring.
 */
export function EventsPanel({
  events,
}: {
  readonly events: readonly HandleMessageStreamEvent[];
}) {
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const indexed = events.map((event, index) => ({ event, index }));
    if (!needle) return indexed;
    return indexed.filter(({ event }) =>
      event.type.toLowerCase().includes(needle),
    );
  }, [events, filter]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-3 pb-4"
      data-testid="events-panel"
    >
      <div className="flex shrink-0 items-center gap-3">
        <Input
          className="max-w-xs"
          onChange={(changeEvent) => setFilter(changeEvent.target.value)}
          placeholder="Filter by type (e.g. message, actions)…"
          value={filter}
        />
        <span className="text-muted-foreground text-xs">
          {visible.length} / {events.length} events
        </span>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <InboxIcon className="size-8 text-muted-foreground/50" />
          <p className="text-muted-foreground text-sm">
            No events yet — send a message in the Chat tab and the raw stream
            shows up here.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          <ul className="divide-y">
            {visible.map(({ event, index }) => (
              <EventRow
                event={event}
                index={index}
                key={`${index}-${event.type}`}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EventRow({
  event,
  index,
}: {
  readonly event: HandleMessageStreamEvent;
  readonly index: number;
}) {
  const [open, setOpen] = useState(false);
  const at =
    typeof event.meta?.at === "string" ? event.meta.at.slice(11, 23) : null;

  return (
    <li data-event-type={event.type}>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="w-8 shrink-0 font-mono text-muted-foreground text-xs">
          {index}
        </span>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 font-medium font-mono text-xs",
            typeTone(event.type),
          )}
        >
          {event.type}
        </span>
        {at ? (
          <span className="ml-auto font-mono text-muted-foreground text-xs">
            {at}
          </span>
        ) : null}
      </button>
      {open ? (
        <pre className="overflow-x-auto border-t bg-muted/40 px-4 py-3 font-mono text-xs">
          {JSON.stringify(event, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

/** Deterministic color per event family, keyed on the type prefix. */
function typeTone(type: string): string {
  const family = type.split(".")[0];
  switch (family) {
    case "session":
      return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "turn":
      return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "step":
      return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
    case "message":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "reasoning":
      return "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300";
    case "actions":
    case "action":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "input":
      return "bg-orange-500/10 text-orange-700 dark:text-orange-300";
    case "authorization":
      return "bg-pink-500/10 text-pink-700 dark:text-pink-300";
    case "subagent":
      return "bg-teal-500/10 text-teal-700 dark:text-teal-300";
    case "result":
    case "compaction":
      return "bg-slate-500/10 text-slate-700 dark:text-slate-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}
