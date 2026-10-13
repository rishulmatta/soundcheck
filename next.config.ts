import type { NextConfig } from "next";
import { getBackendBaseUrl } from "./src/lib/backend";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  rewrites() {
    const backend = getBackendBaseUrl();
    return {
      beforeFiles: backend ? [{ source: "/api/:path*", destination: `${backend}/api/:path*` }] : [],
      afterFiles: [],
      fallback: [],
    };
  },
  experimental: {
    // The build cache served a stale globals.css chunk after a token change (locally and on Railway, which caches .next/cache).
    // The build takes seconds, so skip the persistent cache for builds; dev keeps it.
    turbopackFileSystemCacheForBuild: false,
  },
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
