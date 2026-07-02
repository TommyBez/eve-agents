import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./global.css";

export const metadata: Metadata = {
  title: {
    template: "%s | evex-starter",
    default: "evex-starter docs",
  },
  description:
    "Documentation for evex-starter: a Turborepo monorepo of eve-framework agents.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
