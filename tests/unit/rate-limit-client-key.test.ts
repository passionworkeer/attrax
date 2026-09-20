/**
 * Tests for resolveClientKey — 限流分桶的浏览器级主键（2026-09-20 P2）。
 *
 * 契约：`attrax_uid` cookie 存在时以它为主键（同一出口 IP 下的多个浏览器
 * 各自独立配额）；缺失或为空时退回 resolveClientId（按 IP），所以清空
 * cookie 只能退回更宽的按 IP 上限，不会拿到无限额度。
 * 返回的是加盐摘要，不落原始值。
 */
import { createHash } from "crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveClientId, resolveClientKey } from "@/lib/rate-limit";

const DEFAULT_SALT = "attrax-rate-limit-v2";
function uidKey(value: string): string {
  return `uid:${createHash("sha256")
    .update(`${DEFAULT_SALT}::${value}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/", { headers });
}

describe("resolveClientKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keys on the anonymous cookie when present", () => {
    const request = makeRequest({ cookie: "attrax_uid=abc-123", "x-real-ip": "1.2.3.4" });
    expect(resolveClientKey(request)).toBe(uidKey("abc-123"));
  });

  it("gives two users behind the same IP separate buckets", () => {
    const a = makeRequest({ cookie: "attrax_uid=user-a", "x-real-ip": "9.9.9.9" });
    const b = makeRequest({ cookie: "attrax_uid=user-b", "x-real-ip": "9.9.9.9" });
    expect(resolveClientKey(a)).not.toBe(resolveClientKey(b));
  });

  it("falls back to the IP bucket when the cookie is missing", () => {
    const request = makeRequest({ cookie: "other=1", "x-real-ip": "5.6.7.8" });
    expect(resolveClientKey(request)).toBe(resolveClientId(makeRequest({ "x-real-ip": "5.6.7.8" })));
  });

  it("falls back when attrax_uid is present but empty", () => {
    const request = makeRequest({ cookie: "attrax_uid=; other=1", "x-real-ip": "5.6.7.8" });
    expect(resolveClientKey(request).startsWith("ip:")).toBe(true);
  });

  it("does not treat other cookies as the client key", () => {
    const request = makeRequest({ cookie: "session_id=zzz; attrax_scan_x=y", "x-real-ip": "5.6.7.8" });
    expect(resolveClientKey(request)).toBe(resolveClientId(makeRequest({ "x-real-ip": "5.6.7.8" })));
  });

  it("keeps the value hashed (no raw cookie in the bucket key)", () => {
    const request = makeRequest({ cookie: "attrax_uid=super-secret-value", "x-real-ip": "1.2.3.4" });
    expect(resolveClientKey(request)).not.toContain("super-secret-value");
  });
});
