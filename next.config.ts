import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local tool, no agent files, native SQLite driver stays outside the bundle.
  agentRules: false,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
