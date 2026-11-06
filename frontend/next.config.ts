import path from "node:path";
import type { NextConfig } from "next";

// @aven/core is a workspace package shipped as TypeScript source (backend/core/src), so Next transpiles it.
// Only its browser-safe subpaths (fee, abi, pool, price, verify, precompiles) are imported by the app.
const nextConfig: NextConfig = {
  transpilePackages: ["@aven/core"],
  turbopack: { root: path.resolve(process.cwd(), "..") },
  reactStrictMode: true,
  // Next 16 writes an AGENTS.md otherwise; the repo has one rulebook at the root (AGENTS.md rule 6).
  agentRules: false,
  // Pages folded into Trade / Pool / Docs (2026-11-06). Old links keep working.
  async redirects() {
    return [
      { source: "/arena", destination: "/pool", permanent: false },
      { source: "/how", destination: "/docs/how-it-works", permanent: false },
      { source: "/build", destination: "/docs/build", permanent: false },
      { source: "/verify", destination: "/docs/verify", permanent: false },
    ];
  },
};

export default nextConfig;
