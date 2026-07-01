import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + native file I/O for its on-disk data dir; bundling it
  // breaks path resolution under Turbopack, so keep it as a real Node import.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
