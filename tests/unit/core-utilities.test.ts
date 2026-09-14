import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { fail, ok, unwrapApiData } from "@/lib/api-response";
import {
  createAccessToken,
  hashAccessToken,
  tokenFromRequest,
  verifyAccessToken,
} from "@/lib/pipeline/session-auth";

let rateLimitDir = "";

describe("rate-limit utilities", () => {
  beforeEach(() => {
    globalThis.__rateLimitBuckets = new Map();
    rateLimitDir = mkdtempSync(join(tmpdir(), "attrax-rate-limit-"));
    vi.stubEnv("RATE_LIMIT_STORE_DIR", rateLimitDir);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    globalThis.__rateLimitBuckets = undefined;
    rmSync(rateLimitDir, { recursive: true, force: true });
  });

  it("ignores forwarding headers unless explicitly trusted", () => {
    const forwarded = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(forwarded)).toBe("unknown");
    vi.stubEnv("RATE_LIMIT_TRUST_XFF", "true");
    expect(clientIp(forwarded)).toMatch(/^ip:[a-f0-9]{32}$/);
    expect(clientIp(forwarded)).not.toContain("203.0.113.7");
  });

  it("shares production limits through the configured store", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(checkRateLimit("scan:ip", 2, 1000)).toBe(true);
    expect(checkRateLimit("scan:ip", 2, 1000)).toBe(true);
    expect(checkRateLimit("scan:ip", 2, 1000)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(checkRateLimit("scan:ip", 2, 1000)).toBe(true);
  });

  it("fails closed for invalid limits", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(checkRateLimit("bad", 0, 1000)).toBe(false);
    expect(checkRateLimit("bad", 1, 0)).toBe(false);
  });
});

describe("api response utilities", () => {
  it("wraps success and failure responses", async () => {
    const success = ok({ sessionId: "scan_ok", status: "processing" }, { status: 202 });
    await expect(success.json()).resolves.toMatchObject({
      success: true,
      data: { sessionId: "scan_ok", status: "processing" },
      sessionId: "scan_ok",
    });
    const failure = fail({ code: "BAD_INPUT", message: "Invalid" }, { status: 400 });
    await expect(failure.json()).resolves.toEqual({
      success: false,
      data: null,
      error: { code: "BAD_INPUT", message: "Invalid" },
    });
  });

  it("unwraps envelopes and preserves legacy payloads", () => {
    expect(unwrapApiData<{ value: number }>({ success: true, data: { value: 42 } })).toEqual({ value: 42 });
    const legacy = { status: "ready", progress: 100 };
    expect(unwrapApiData(legacy)).toBe(legacy);
    expect(unwrapApiData(null)).toBeNull();
  });
});

describe("session auth utilities", () => {
  it("creates base64url tokens and verifies hashes", () => {
    const token = createAccessToken();
    const hash = hashAccessToken(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyAccessToken(token, hash)).toBe(true);
    expect(verifyAccessToken("wrong", hash)).toBe(false);
  });

  it("accepts bearer headers and never query-string tokens", () => {
    const bearer = new Request("http://localhost/api/scan/x?token=query", {
      headers: { authorization: "Bearer header-token" },
    });
    const query = new Request("http://localhost/api/scan/x?token=query");
    expect(tokenFromRequest(bearer)).toBe("header-token");
    expect(tokenFromRequest(query)).toBeNull();
  });
});
