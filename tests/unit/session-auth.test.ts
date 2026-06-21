import { describe, it, expect } from "vitest";
import {
  createAccessToken,
  hashAccessToken,
  verifyAccessToken,
  tokenFromRequest,
} from "@/lib/pipeline/session-auth";

// Tests pin the security contract for session auth tokens.
// These rules were hardened in the 16-round audit (June 2026):
//   - 32 bytes random, base64url encoded
//   - SHA-256 hash at rest
//   - timingSafeEqual for compare
//   - Bearer header ONLY (no ?token= query — that leaked into nginx access log)

describe("createAccessToken", () => {
  it("returns a base64url string of 43-44 chars (32 bytes)", () => {
    const tok = createAccessToken();
    expect(tok).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tok.length).toBeGreaterThanOrEqual(43);
    expect(tok.length).toBeLessThanOrEqual(44);
  });

  it("returns a unique value each call", () => {
    const a = createAccessToken();
    const b = createAccessToken();
    expect(a).not.toBe(b);
  });
});

describe("hashAccessToken / verifyAccessToken", () => {
  it("round-trips a real token", () => {
    const tok = createAccessToken();
    const hash = hashAccessToken(tok);
    expect(verifyAccessToken(tok, hash)).toBe(true);
  });

  it("rejects a wrong token against a valid hash", () => {
    const hash = hashAccessToken(createAccessToken());
    expect(verifyAccessToken("not-the-token", hash)).toBe(false);
  });

  it("rejects a token when hash is undefined", () => {
    expect(verifyAccessToken(createAccessToken(), undefined)).toBe(false);
  });

  it("rejects an empty token", () => {
    const hash = hashAccessToken("x");
    expect(verifyAccessToken("", hash)).toBe(false);
  });

  it("hash is hex (sha256), 64 chars", () => {
    const hash = hashAccessToken("anything");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hash is deterministic for same input", () => {
    expect(hashAccessToken("x")).toBe(hashAccessToken("x"));
  });

  it("rejects malformed hash (length mismatch)", () => {
    // verifyAccessToken calls Buffer.from(..., "hex") on both sides then
    // checks length. A short hash should fail without throwing.
    expect(verifyAccessToken("x", "abcd")).toBe(false);
  });
});

describe("tokenFromRequest — Bearer header only (no ?token= query)", () => {
  it("reads Bearer header", () => {
    const req = new Request("https://x/", {
      headers: { authorization: "Bearer abc123" },
    });
    expect(tokenFromRequest(req)).toBe("abc123");
  });

  it("handles case-insensitive 'bearer'", () => {
    const req = new Request("https://x/", {
      headers: { authorization: "bEARER abc123" },
    });
    expect(tokenFromRequest(req)).toBe("abc123");
  });

  it("trims whitespace inside the header", () => {
    const req = new Request("https://x/", {
      headers: { authorization: "Bearer   abc123   " },
    });
    expect(tokenFromRequest(req)).toBe("abc123");
  });

  it("returns null when no Authorization header", () => {
    expect(tokenFromRequest(new Request("https://x/"))).toBeNull();
  });

  it("returns null for empty Bearer value", () => {
    const req = new Request("https://x/", {
      headers: { authorization: "Bearer " },
    });
    expect(tokenFromRequest(req)).toBeNull();
  });

  it("returns null for non-Bearer auth scheme", () => {
    const req = new Request("https://x/", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(tokenFromRequest(req)).toBeNull();
  });

  // CRITICAL: this is the regression guard for the access-log leak fix.
  // If anyone re-adds query-string support, this test fails.
  it("does NOT read ?token= from query string (regression: tokens leaked in access log)", () => {
    const req = new Request("https://x/scan/abc?token=secret123");
    expect(tokenFromRequest(req)).toBeNull();
  });

  it("does NOT read token from query even when header is also present", () => {
    const req = new Request("https://x/scan/abc?token=query-leak", {
      headers: { authorization: "Bearer header-tok" },
    });
    // Header wins, query ignored
    expect(tokenFromRequest(req)).toBe("header-tok");
  });
});
