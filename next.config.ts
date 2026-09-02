import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Produce a self-contained Node server for the hardened production container.
  output: "standalone",
  // Preview hosts can be opted in without weakening production host checks.
  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),
};

export default nextConfig;
