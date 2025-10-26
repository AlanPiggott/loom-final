import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb', // Allow large video uploads (matches loom-lite limit)
    },
  },
};

export default nextConfig;
