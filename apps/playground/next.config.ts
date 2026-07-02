import path from "node:path";
import type { NextConfig } from "next";

// Plain Next.js config on purpose: the playground is a *client* of many
// external eve agents (via the /api/agents proxy), not an eve app itself,
// so it must not use `withEve` from "eve/next".
const nextConfig: NextConfig = {
  // Pin the workspace root so Next does not guess it from the pnpm
  // monorepo's multiple lockfiles.
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
  },
};

export default nextConfig;
