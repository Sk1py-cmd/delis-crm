import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained Node server for the hardened production container.
  output: "standalone",
};

export default nextConfig;
