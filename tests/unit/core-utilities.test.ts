import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { fail, ok, unwrapApiData } from "@/lib/api-response";
import {
  createAccessToken,
  hashAccessToken,
  tokenFromRequest,
  verifyAccessToken,
} from "@/lib/pipeline/session-auth";
import { requireSessionAccess, sessionPayload } from "@/app/api/session-access";
import { SCAN_STAGE_TEXT, serverT } from "@/lib/server-i18n";
import type { ScanStatus } from "@/lib/types";
import type { StoredScanStatus } from "@/lib/pipeline/session-store";

describe("rate-limit utilities", () => {
  beforeEach(() => {
    globalThis.__rateLimitBuckets = new Map();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    globalThis.__rateLimitBuckets = undefined;
  });

  it("ignores forwarding headers unless explicitly trusted", () => {
    const forwarded = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientIp(forwarded)).toBe("unknown");
    vi.stubEnv("RATE_LIMIT_TRUST_XFF", "true");
    expect(clientIp(forwarded)).toBe("203.0.113.7");
  });

  it("limits repeated production requests until the window resets", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(checkRateLimit("scan:ip", 2, 1000)).toBe(true);
    expect(checkRateLimit("scan:ip", 2, 1000)).toBe(true);
    expect(checkRateLimit("scan:ip", 2, 1000)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(checkRateLimit("scan:ip", 2, 1000)).toBe(true);
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

describe("session access helpers", () => {
  function stored(overrides: Partial<StoredScanStatus> = {}): StoredScanStatus {
    return {
      sessionId: "scan_secure",
      status: "ready",
      progress: 100,
      stageText: "complete",
      createdAt: 0,
      updatedAt: 0,
      expiresAt: Date.now() + 1000,
      ...overrides,
    };
  }

  afterEach(() => vi.unstubAllEnvs());

  it("allows unhashed legacy fixtures outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(
      requireSessionAccess(
        new Request("http://localhost/api/scan/scan_secure"),
        stored(),
      ),
    ).toBeNull();
  });

  it("fails closed for unhashed production sessions", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = requireSessionAccess(
      new Request("http://localhost/api/scan/scan_secure"),
      stored(),
    );
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("allows valid bearer tokens and rejects invalid ones", async () => {
    const token = "secret-token";
    const session = stored({ accessTokenHash: hashAccessToken(token) });
    expect(
      requireSessionAccess(
        new Request("http://localhost", {
          headers: { authorization: `Bearer ${token}` },
        }),
        session,
      ),
    ).toBeNull();
    const denied = requireSessionAccess(new Request("http://localhost"), session);
    expect(denied?.status).toBe(401);
  });

  it("returns only public fields including degradation evidence", () => {
    const status: ScanStatus & { accessTokenHash?: string } = {
      sessionId: "scan_public",
      status: "degraded",
      progress: 100,
      stageText: "degraded",
      degradedReason: "NO_RETRIEVED_EVIDENCE",
      accessTokenHash: "private",
    };
    expect(sessionPayload(status)).toEqual({
      sessionId: "scan_public",
      status: "degraded",
      progress: 100,
      stageText: "degraded",
      result: undefined,
      profitReport: undefined,
      profitReports: undefined,
      error: undefined,
      degradedReason: "NO_RETRIEVED_EVIDENCE",
    });
  });
});

describe("server i18n utilities", () => {
  it("returns translations and parameterized fallbacks", () => {
    expect(serverT("errors.invalidRequest", "en")).toContain("Invalid request");
    expect(serverT("missing.key", "en")).toBe("missing.key");
    expect(serverT("Hello {name}", "en", { name: "CompliPilot" })).toBe("Hello CompliPilot");
  });

  it("exports scan stage text for both locales", () => {
    expect(SCAN_STAGE_TEXT.zh.identifyingLabels).toBeTruthy();
    expect(SCAN_STAGE_TEXT.en.reportComplete).toBe("Report complete");
  });
});
