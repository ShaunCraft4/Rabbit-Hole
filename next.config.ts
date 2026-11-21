import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The Solari browser SDK (ESM-only) drives a Playwright fork; load both with Node instead of bundling
  // them (Next already does this for playwright-core, but not for patchright-core).
  serverExternalPackages: ["@solarisdk/browser", "patchright-core"],
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
