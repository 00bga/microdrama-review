import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local tool, no agent files. The SQLite driver is native and the Gemini SDK needs its Node
  // build (file uploads), so both stay outside the server bundle.
  agentRules: false,
  serverExternalPackages: ["better-sqlite3", "@google/genai"],
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
