import type { NextConfig } from "next";

const securityHeaders = [
  // The browser never talks to the RAG service directly — all calls go
  // through Next.js API routes (proxy). connect-src is therefore just 'self';
  // the previous localhost:8001 entries were dead CSP rules that leaked dev
  // infrastructure URLs into every response. If a future feature requires a
  // direct browser→RAG connection, add it explicitly via build-time env.
  //
  // CSP script-src previously carried 'unsafe-eval' and 'unsafe-inline'.
  // Audited 2026-06-28:
  //   - 'unsafe-eval' removed: no devDependency calls eval / new Function at
  //     runtime in app code; jspdf / docx / react-markdown / remark-gfm /
  //     framer-motion / shadcn-ui do not require eval in their production
  //     paths (verified via build + smoke-checking report render/export +
  //     scan flow).
  //   - Next.js hydration currently needs inline bootstrap scripts. The
  //     deterministic middleware CSP permits only those inline scripts and
  //     same-origin external scripts. A per-request nonce is intentionally
  //     avoided because it conflicts with cached/static page output.
  //
  // Note: middleware.ts owns the Content-Security-Policy header.
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
    // standalone 生产部署下 image optimizer 读 public 图返回 null,
    // 导致 /complipilot/* 和 /mock-fixtures/* 等图全部破图(nextjs err log
    // 刷屏 "isn't a valid image ... received null")。standalone server 不
    // 自带可用的 sharp optimizer,直接关掉优化,图片由静态服务原样返回。
    // 本项目图片都是小图(logo / demo 预设图 / canvas),不压缩无损。
    unoptimized: true,
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
