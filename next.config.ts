import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page here is per-user and dynamic, so the classic request-time model is used.
  serverExternalPackages: ["@googleapis/sheets", "@googleapis/drive", "google-auth-library"],
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
