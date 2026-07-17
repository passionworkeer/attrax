import { NextResponse, type NextRequest } from "next/server";
import { appendFileSync } from "fs";

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
 * Keep this policy deterministic. Per-request nonces force Next.js pages to
 * render dynamically, while cached/static HTML can retain scripts generated
 * with a different nonce. Next.js hydration currently emits inline bootstrap
 * scripts, so production pages require unsafe-inline until those scripts can
 * be hashed at build time.
 */
function buildCsp(): string {
  const parts = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'`,
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

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", buildCsp());
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
