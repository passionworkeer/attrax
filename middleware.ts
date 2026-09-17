import { NextResponse, type NextRequest } from "next/server";

const SKIP_PREFIXES = [
  "/_next/",
  "/favicon",
  "/robots.txt",
  "/sitemap.xml",
];

function shouldSkip(pathname: string): boolean {
  return SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function buildCsp(): string {
  // Next.js dev mode(HMR + React 调试)需要 eval();生产保持严格,不加
  // 'unsafe-eval' 以保 XSS 防护。dev 放宽仅供本地开发与 E2E(dev server)使用。
  const dev = process.env.NODE_ENV !== "production";
  return [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

function emitSafeRequestLog(request: NextRequest): void {
  // Do not persist query strings, bearer tokens, referers, full user agents,
  // or raw IP addresses. Runtime stdout is collected and rotated by the
  // process manager/reverse proxy without blocking the request event loop.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  const language = request.headers
    .get("accept-language")
    ?.split(",", 1)[0]
    ?.slice(0, 16);
  console.info(
    JSON.stringify({
      event: "http_request",
      timestamp: new Date().toISOString(),
      requestId,
      method: request.method,
      path: request.nextUrl.pathname,
      contentLength:
        Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : null,
      language: language || null,
    }),
  );
}

function applySecurityHeaders(response: NextResponse, apiRoute: boolean): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (!apiRoute) {
    response.headers.set("Content-Security-Policy", buildCsp());
  }
  return response;
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (shouldSkip(path)) return NextResponse.next();

  emitSafeRequestLog(request);
  // 把 request-id 注入转发给 route handler 的请求头：BFF 上游调用
  // （v1-adapter → RAG）靠它做跨边界日志关联；只设响应头时 handler 与
  // RAG 都看不到同一个 id。
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("X-Request-Id", requestId);
  return applySecurityHeaders(response, isApiRoute(path));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
