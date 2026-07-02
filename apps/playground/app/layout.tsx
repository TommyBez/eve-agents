import { TerminalIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Eve Playground",
    template: "%s · Eve Playground",
  },
  description:
    "Web chat and diagnostics control-plane for the eve agents in this repo.",
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-background text-foreground antialiased">
        <TooltipProvider>
          <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
            <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
              <Link
                className="flex items-center gap-2 font-semibold text-sm tracking-tight"
                href="/"
              >
                <TerminalIcon className="size-4" />
                Eve Playground
              </Link>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </TooltipProvider>
      </body>
    </html>
  );
}
