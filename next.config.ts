import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  turbopack: {
    root: "./",
  },

  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Allow all local uploads; tighten domains in production
    remotePatterns: [],
  },

  // Bundle optimization
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion", "sonner"],
  },
};

export default nextConfig;
