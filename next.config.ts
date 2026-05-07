import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "pub-87c37da128064cf29af538c90d98fdaf.r2.dev",
      },
    ],
  },
};

export default nextConfig;
