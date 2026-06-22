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

  return NextResponse.next();
}

export const config = {
  // Use Node.js runtime because the middleware imports `fs` (appendFileSync),
  // which is not available in the Edge runtime.
  runtime: "nodejs",
  // Run for API routes and page navigations; static assets are skipped above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};