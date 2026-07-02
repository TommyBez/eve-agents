"use client";

import {
  CheckIcon,
  CopyIcon,
  MinusIcon,
  SearchIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAgentEvents } from "./agent-view";

/* ------------------------------------------------------------------ */
/* Copy button (instructions, commands)                               */
/* ------------------------------------------------------------------ */

export function CopyButton({
  text,
  className,
  label = "Copy",
}: {
  readonly text: string;
  readonly className?: string;
  readonly label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable.
    }
  };

  return (
    <Button
      aria-label={label}
      className={className}
      onClick={() => void copy()}
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
  );
}

/* ------------------------------------------------------------------ */
/* Context-window usage meter                                         */
/* ------------------------------------------------------------------ */

/**
 * Single-ratio meter (dataviz: "a single ratio against a limit → meter with a
 * same-ramp track"). Fill and track share the accent hue; the value is always
 * direct-labeled in mono, so color never carries the number alone. Usage is
 * read live from the session's `step.completed` events.
 */
export function ContextWindowMeter({
  windowTokens,
}: {
  readonly windowTokens: number | undefined;
}) {
  const events = useAgentEvents();

  // Prompt size of the most recent model call ≈ context currently in use.
  const usedTokens = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === "step.completed" && event.data.usage) {
        return (
          (event.data.usage.inputTokens ?? 0) +
          (event.data.usage.cacheReadTokens ?? 0)
        );
      }
    }
    return null;
  }, [events]);

  if (!windowTokens) {
    return (
      <p className="text-muted-foreground text-xs">context window unknown</p>
    );
  }

  const ratio =
    usedTokens === null ? 0 : Math.min(1, usedTokens / windowTokens);
  const percent = Math.round(ratio * 100);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs tabular-nums">
          {usedTokens === null ? "0" : usedTokens.toLocaleString("en-US")}
          <span className="text-muted-foreground">
            {" "}
            / {windowTokens.toLocaleString("en-US")} tokens
          </span>
        </span>
        <span className="font-mono text-muted-foreground text-xs tabular-nums">
          {percent}%
        </span>
      </div>
      {/* Decorative bar — the value is direct-labeled in text above. */}
      <div
        aria-hidden
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-brand/15"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300"
          style={{ width: `${Math.max(ratio * 100, usedTokens ? 1 : 0)}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground/70">
        {usedTokens === null
          ? "no model calls in this session yet"
          : "prompt size of the latest model call in this session"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Searchable tools table                                             */
/* ------------------------------------------------------------------ */

export type DiagnosticsTool = {
  readonly name: string;
  readonly description?: string;
  readonly origin?: string;
  readonly requiresApproval?: boolean;
};

export function ToolsTable({
  tools,
}: {
  readonly tools: readonly DiagnosticsTool[];
}) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(needle) ||
        (tool.description ?? "").toLowerCase().includes(needle),
    );
  }, [tools, query]);

  return (
    <div>
      <div className="relative mb-3">
        <SearchIcon className="absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
        <Input
          className="h-7.5 w-64 max-w-full pl-8 font-mono text-xs"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${tools.length} tools…`}
          value={query}
        />
      </div>
      {visible.length === 0 ? (
        <p className="py-4 text-muted-foreground text-sm">
          No tools match “{query.trim()}”.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-[11px] uppercase tracking-wider">
                Name
              </TableHead>
              <TableHead className="h-8 text-[11px] uppercase tracking-wider">
                Origin
              </TableHead>
              <TableHead className="h-8 text-[11px] uppercase tracking-wider">
                Approval
              </TableHead>
              <TableHead className="h-8 text-[11px] uppercase tracking-wider">
                Description
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((tool) => (
              <TableRow key={tool.name}>
                <TableCell className="whitespace-nowrap py-2 align-top font-mono text-xs">
                  {tool.name}
                </TableCell>
                <TableCell className="py-2 align-top">
                  <span
                    className={cn(
                      "rounded border px-1.5 py-px font-mono text-[10px]",
                      tool.origin === "framework"
                        ? "text-muted-foreground"
                        : "border-brand/40 bg-brand/10 text-brand",
                    )}
                  >
                    {tool.origin ?? "unknown"}
                  </span>
                </TableCell>
                <TableCell className="py-2 align-top">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default">
                        {tool.requiresApproval ? (
                          <ShieldAlertIcon
                            aria-label="Requires human approval"
                            className="size-3.5 text-warn"
                          />
                        ) : (
                          <MinusIcon
                            aria-label="No approval required"
                            className="size-3.5 text-muted-foreground/50"
                          />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {tool.requiresApproval
                        ? "Requires human approval before running"
                        : "Runs without approval"}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="max-w-md py-2 align-top text-muted-foreground text-xs leading-4.5">
                  <span className="line-clamp-3">{tool.description}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
