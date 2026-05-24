import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' http://localhost:8001 http://127.0.0.1:8001; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
];

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
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
