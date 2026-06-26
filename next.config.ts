import type { NextConfig } from "next";

const securityHeaders = [
  // The browser never talks to the RAG service directly — all calls go
  // through Next.js API routes (proxy). connect-src is therefore just 'self';
  // the previous localhost:8001 entries were dead CSP rules that leaked dev
  // infrastructure URLs into every response. If a future feature requires a
  // direct browser→RAG connection, add it explicitly via build-time env.
  { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Disable browser features the app does not use, defense in depth against
  // malicious injected content. geolocation/microphone/camera/payment are
  // turned off so a compromised dependency cannot silently request them.
  // HSTS is intentionally set at the reverse-proxy (nginx) layer only —
  // see docs/infra/nginx-attrax-site.conf — because emitting it from the app
  // is meaningless to browsers connecting on plain HTTP and would mask
  // misconfiguration if the proxy header is ever dropped.
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()" },
  // Cross-Origin-Opener-Policy isolates the browsing context from cross-origin
  // popups. safe-origin fallback avoids breaking the dev server's HMR.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  output: "standalone",
  turbopack: {
    root: process.cwd(),
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
