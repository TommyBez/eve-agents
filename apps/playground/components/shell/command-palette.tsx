"use client";

import {
  ActivityIcon,
  BotIcon,
  LayoutGridIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  StethoscopeIcon,
  SunMoonIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import type { ShellAgent } from "./health";
import { useTheme } from "./theme";

/** Agent-view tabs the palette can switch to (handled in agent-view.tsx). */
const TABS = [
  { icon: MessageSquareIcon, id: "chat", label: "Chat" },
  { icon: StethoscopeIcon, id: "diagnostics", label: "Diagnostics" },
  { icon: ActivityIcon, id: "events", label: "Events" },
] as const;

export function CommandPalette({
  agents,
}: {
  readonly agents: readonly ShellAgent[];
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const onAgentPage = pathname.startsWith("/agents/");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    const onOpenRequest = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("playground:palette", onOpenRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("playground:palette", onOpenRequest);
    };
  }, []);

  const run = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  return (
    <CommandDialog
      description="Jump to an agent, switch tabs, or run a command."
      onOpenChange={setOpen}
      open={open}
      title="Playground commands"
    >
      <CommandInput placeholder="Type a command or agent name…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => run(() => router.push("/"))}>
            <LayoutGridIcon />
            Overview
          </CommandItem>
          {agents
            .filter((agent) => agent.enabled)
            .map((agent) => (
              <CommandItem
                key={agent.id}
                onSelect={() => run(() => router.push(`/agents/${agent.id}`))}
                value={`agent ${agent.title} ${agent.id}`}
              >
                <BotIcon />
                {agent.title}
                <CommandShortcut className="font-mono normal-case tracking-normal">
                  {agent.targetLabel}
                </CommandShortcut>
              </CommandItem>
            ))}
        </CommandGroup>
        {onAgentPage ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="This agent">
              {TABS.map((tab) => (
                <CommandItem
                  key={tab.id}
                  onSelect={() =>
                    run(() =>
                      window.dispatchEvent(
                        new CustomEvent("playground:tab", {
                          detail: tab.id,
                        }),
                      ),
                    )
                  }
                  value={`tab ${tab.label}`}
                >
                  <tab.icon />
                  Switch to {tab.label}
                </CommandItem>
              ))}
              <CommandItem
                onSelect={() =>
                  run(() =>
                    window.dispatchEvent(
                      new CustomEvent("playground:new-session"),
                    ),
                  )
                }
              >
                <RotateCcwIcon />
                New session
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
        <CommandSeparator />
        <CommandGroup heading="Appearance">
          <CommandItem onSelect={() => run(toggle)}>
            <SunMoonIcon />
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          <kbd className="rounded border bg-muted/60 px-1 font-mono text-[10px]">
            ↑↓
          </kbd>{" "}
          navigate
        </span>
        <span>
          <kbd className="rounded border bg-muted/60 px-1 font-mono text-[10px]">
            ↵
          </kbd>{" "}
          select
        </span>
        <span>
          <kbd className="rounded border bg-muted/60 px-1 font-mono text-[10px]">
            esc
          </kbd>{" "}
          close
        </span>
      </div>
    </CommandDialog>
  );
}
