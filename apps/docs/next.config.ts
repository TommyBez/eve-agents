import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next does not guess it from the pnpm
  // monorepo's multiple lockfiles (same as apps/playground).
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
