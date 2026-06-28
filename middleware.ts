import { NextResponse, type NextRequest } from "next/server";
import { appendFileSync } from "fs";
import { randomUUID } from "crypto";

const REQUEST_LOG_PATH =
  process.env.REQUEST_LOG_PATH ?? "/opt/attrax/logs/requests.log";

const SKIP_PREFIXES = [
  "/_next/",
  "/favicon",
  "/robots.txt",
  "/sitemap.xml",
];

function shouldSkip(pathname: string): boolean {
  return SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * API routes do not render inline scripts and respond with JSON, so they
 * need the request-log pass-through but no CSP/nonce injection. Keep them
 * inside the matcher so the access log is not regressed, but skip the
 * CSP/nonce headers below for these paths.
 */
function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * Generate a per-request CSP nonce. We use crypto.randomUUID (stable across
 * Node.js middleware runtime) and strip the dashes so the value matches the
 * base64-like charset browsers expect inside `nonce="..."`. The nonce is
 * emitted both on the request (as `x-nonce`, so Next.js auto-stamps it on
 * hydration inline scripts — see Next.js docs "Nonces for SSR / Middleware")
 * and on the response Content-Security-Policy header.
 */
function generateNonce(): string {
  return randomUUID().replaceAll("-", "");
}

/**
 * Build a Content-Security-Policy header value mirroring the previous static
 * CSP from next.config.ts, with `script-src` switched from 'unsafe-inline'
 * to a per-request nonce + 'strict-dynamic'. Every non-script directive is
 * preserved verbatim (default-src/style-src/connect-src/img-src/font-src/
 * frame-ancestors/base-uri/form-action) so we do not regress the existing
 * posture. style-src keeps 'unsafe-inline' because Next.js injects inline
 * style attributes (e.g. framer-motion, Tailwind JIT) that are not
 * nonce-stampable.
 */
function buildCsp(nonce: string): string {
  const parts = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ];
  return parts.join("; ");
}

export function middleware(request: NextRequest) {
  const start = Date.now();
  const path = request.nextUrl.pathname;
  const method = request.method;

  if (shouldSkip(path)) {
    return NextResponse.next();
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";
  const referer = request.headers.get("referer") ?? "-";
  const query = request.nextUrl.search || "-";
  const contentLength = request.headers.get("content-length") ?? "-";
  const acceptLang = request.headers.get("accept-language") ?? "-";

  const logLine =
    JSON.stringify({
      ts: new Date().toISOString(),
      method,
      path,
      query,
      ip,
      ua,
      referer,
      contentLength,
      acceptLang,
      // status/duration are observed by nginx access.log and joined on this start
      // timestamp + client IP; admins can read nginx access.log via `sudo chmod a+r`
      // or by adding admin to the adm group.
    }) + "\n";

  // Best-effort: never let logging failures block the request.
  try {
    appendFileSync(REQUEST_LOG_PATH, logLine, { encoding: "utf-8" });
  } catch {
    // Silent: a failed write must not surface to clients.
  }

  void start;

  // API routes: still served by this middleware (so request logging is not
  // regressed), but they do not render inline scripts and respond with JSON,
  // so no CSP/nonce is needed. Return early with the plain passthrough.
  if (isApiRoute(path)) {
    return NextResponse.next();
  }

  // Generate a per-request nonce and stamp it onto the request so Next.js
  // auto-applies it to inline hydration scripts (server-rendered HTML).
  // The same nonce is reflected in the response CSP header below.
  const nonce = generateNonce();

  // Build the response and apply (a) the request nonce — so Next.js stamps
  // it onto hydration inline scripts during render — and (b) the nonce-bound
  // Content-Security-Policy response header. Both are required for the nonce
  // to take effect: the request header lets the framework emit
  // `<script nonce="...">` for its own inline scripts, and the response CSP
  // header tells the browser to only honor scripts carrying that nonce.
  // Per Next.js docs, we clone the incoming headers into a fresh Headers
  // object, set `x-nonce`, and forward via NextResponse.next's `request`
  // rewrite — Next.js picks up that header during SSR and stamps it onto the
  // inline hydration scripts it emits.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-nonce", nonce);
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return response;
}

export const config = {
  // Use Node.js runtime because the middleware imports `fs` (appendFileSync),
  // which is not available in the Edge runtime.
  runtime: "nodejs",
  // Run for API routes and page navigations; static assets are skipped above.
  // We keep /api in the matcher so request logging still covers it, and skip
  // CSP/nonce injection inside the middleware body for those routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
