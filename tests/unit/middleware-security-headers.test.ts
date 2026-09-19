/**
 * middleware.ts — security headers and safe request logging.
 *
 * The middleware had no test at all, which is uncomfortable because it is the
 * single place these headers are applied: a change that dropped the CSP, or
 * that let `'unsafe-eval'` leak into the production policy, would not have
 * failed anything. It also deliberately logs a *reduced* request record
 * (no query string, no bearer token, no referer, no raw IP), so "the log
 * stays safe" is a property worth pinning rather than trusting.
 *
 * @vitest-environment node
 *     middleware 现在引入 lib/admin/traffic → node:sqlite（服务端内置模块），
 *     jsdom 环境无法打包 Node 内置模块，此测试本就只测服务端行为。
 */
import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

// middleware 现在会写流量统计库：只有当项目根下存在 .admin-auth.json 时才启用。
// 本地工作目录可能真实存在该文件（开发者跑过 setup-admin），把项目根指到
// 一个空的临时目录，保证测试永远不落库、也不依赖机器状态。
const SCRATCH = path.resolve(__dirname, "..", "..", "tmp");
mkdirSync(SCRATCH, { recursive: true });
const TRAFFICLESS_ROOT = mkdtempSync(path.join(SCRATCH, "middleware-test-"));
afterAll(() => rmSync(TRAFFICLESS_ROOT, { recursive: true, force: true }));

function makeRequest(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(`https://example.com${path}`, { headers }));
}

describe("middleware security headers", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("ATTRAX_PROJECT_ROOT", TRAFFICLESS_ROOT);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    infoSpy.mockRestore();
  });

  it("sets the baseline hardening headers on a page route", () => {
    const res = middleware(makeRequest("/upload"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Permissions-Policy")).toContain("geolocation=()");
  });

  it("sends a CSP on page routes but not on /api/ routes", () => {
    expect(middleware(makeRequest("/upload")).headers.get("Content-Security-Policy")).toBeTruthy();
    // JSON API responses don't render markup, so the CSP is skipped there.
    expect(middleware(makeRequest("/api/scan")).headers.get("Content-Security-Policy")).toBeNull();
    // ...but an API route still gets the other headers.
    expect(middleware(makeRequest("/api/scan")).headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("production CSP omits 'unsafe-eval'", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = middleware(makeRequest("/")).headers.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("development CSP adds 'unsafe-eval' for HMR", () => {
    vi.stubEnv("NODE_ENV", "development");
    const csp = middleware(makeRequest("/")).headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("'unsafe-eval'");
  });

  it("echoes a caller-supplied X-Request-Id and generates one otherwise", () => {
    const echoed = middleware(makeRequest("/upload", { "x-request-id": "req-abc-123" }));
    expect(echoed.headers.get("X-Request-Id")).toBe("req-abc-123");

    const generated = middleware(makeRequest("/upload"));
    expect(generated.headers.get("X-Request-Id")).toBeTruthy();
    expect(generated.headers.get("X-Request-Id")).not.toBe("req-abc-123");
  });

  it("skips static and metadata paths entirely", () => {
    for (const path of ["/_next/static/chunk.js", "/favicon.ico", "/robots.txt", "/sitemap.xml"]) {
      const res = middleware(makeRequest(path));
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
      expect(res.headers.get("X-Request-Id")).toBeNull();
    }
    // Skipped paths are not logged either.
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("middleware request logging stays redacted", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("ATTRAX_PROJECT_ROOT", TRAFFICLESS_ROOT);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    infoSpy.mockRestore();
  });

  function loggedPayload(): Record<string, unknown> {
    expect(infoSpy).toHaveBeenCalledTimes(1);
    return JSON.parse(String(infoSpy.mock.calls[0][0]));
  }

  it("logs the path but never the query string", () => {
    middleware(makeRequest("/result/scan_abc?token=super-secret-value&hl=EU"));
    const payload = loggedPayload();
    expect(payload.event).toBe("http_request");
    expect(payload.path).toBe("/result/scan_abc");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("token=");
    expect(serialized).not.toContain("hl=EU");
  });

  it("does not log authorization, referer, raw user agent or IP", () => {
    middleware(
      makeRequest("/api/scan", {
        authorization: "Bearer leaked-token-value",
        referer: "https://evil.example/steal",
        "user-agent": "Mozilla/5.0 (secret-fingerprint)",
        "x-forwarded-for": "203.0.113.77",
      }),
    );
    const serialized = JSON.stringify(loggedPayload());
    expect(serialized).not.toContain("leaked-token-value");
    expect(serialized).not.toContain("evil.example");
    expect(serialized).not.toContain("secret-fingerprint");
    expect(serialized).not.toContain("203.0.113.77");
  });

  it("keeps only the first language tag, truncated", () => {
    middleware(makeRequest("/upload", { "accept-language": "zh-CN,zh;q=0.9,en;q=0.8" }));
    expect(loggedPayload().language).toBe("zh-CN");
  });

  it("reports content-length when numeric and null otherwise", () => {
    middleware(makeRequest("/upload", { "content-length": "2048" }));
    expect(loggedPayload().contentLength).toBe(2048);

    infoSpy.mockClear();
    middleware(makeRequest("/upload", { "content-length": "not-a-number" }));
    expect(loggedPayload().contentLength).toBeNull();
  });
});
