/**
 * Tests for clientIp — security contract:
 *
 * x-real-ip IS trusted by default: in this deployment every request arrives
 * through our nginx (port 3000 is loopback-only) whose `proxy_set_header
 * X-Real-IP $remote_addr` overwrites any client-supplied value, so it is the
 * genuine peer address. X-Forwarded-For is NOT trusted by default (its
 * leftmost entry is client-controlled even behind $proxy_add_x_forwarded_for);
 * set RATE_LIMIT_TRUST_XFF=true to honor it behind a proxy that sanitizes it.
 *
 * When neither header is present (local dev), clientIp falls back to a salted
 * SHA-256 of the User-Agent (truncated) so distinct browser fingerprints get
 * distinct buckets instead of collapsing into a single global "unknown" bucket.
 */
import { createHash } from "crypto";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { clientIp, resolveClientId } from "@/lib/rate-limit";

// Pins the default-salt identifier digest used by lib/rate-limit.ts. Production
// client-id functions hash IPs and cookies (never returning raw PII) before
// they become rate-limit bucket keys, so the resolved id is a prefixed digest.
// Keep DEFAULT_SALT in sync with lib/rate-limit.ts; if the salt or digest
// shape changes there, this helper must change too — that is intentional.
const DEFAULT_SALT = "attrax-rate-limit-v2";
function digestId(prefix: "ip" | "cookie", value: string): string {
  return `${prefix}:${createHash("sha256")
    .update(`${DEFAULT_SALT}::${value}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/", { headers });
}

describe("clientIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("default (RATE_LIMIT_TRUST_XFF unset) — headers are ignored", () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    it("trusts x-real-ip (nginx overwrites it with $remote_addr; not spoofable through our proxy)", () => {
      const req = makeRequest({
        "x-real-ip": "203.0.113.5",
        "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      });
      // x-real-ip wins and XFF is ignored.
      expect(clientIp(req)).toBe(digestId("ip", "203.0.113.5"));
    });

    it("returns 'unknown' when no headers are set", () => {
      expect(clientIp(makeRequest())).toBe("unknown");
    });

    it("returns 'unknown' even when an attacker spoofs only XFF", () => {
      const req = makeRequest({ "x-forwarded-for": "999.999.999.999" });
      expect(clientIp(req)).toBe("unknown");
    });
  });

  describe("RATE_LIMIT_TRUST_XFF=true — proxy headers honored", () => {
    beforeEach(() => {
      vi.stubEnv("RATE_LIMIT_TRUST_XFF", "true");
    });

    it("returns X-Real-IP when present, ignoring XFF", () => {
      const req = makeRequest({
        "x-real-ip": "203.0.113.5",
        "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      });
      expect(clientIp(req)).toBe(digestId("ip", "203.0.113.5"));
    });

    it("returns the leftmost XFF entry when X-Real-IP is missing", () => {
      const req = makeRequest({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
      expect(clientIp(req)).toBe(digestId("ip", "198.51.100.7"));
    });

    it("returns 'unknown' when X-Real-IP is whitespace and XFF is empty", () => {
      const req = makeRequest({ "x-real-ip": "   " });
      expect(clientIp(req)).toBe("unknown");
    });

    it("trims whitespace from X-Real-IP", () => {
      const req = makeRequest({ "x-real-ip": "  203.0.113.5  " });
      expect(clientIp(req)).toBe(digestId("ip", "203.0.113.5"));
    });

    it("prefers X-Real-IP over a spoofed XFF from the same client", () => {
      const req = makeRequest({
        "x-real-ip": "203.0.113.5",
        "x-forwarded-for": "999.999.999.999",
      });
      expect(clientIp(req)).toBe(digestId("ip", "203.0.113.5"));
    });

    it("accepts '1' / 'yes' as truthy spellings", () => {
      vi.stubEnv("RATE_LIMIT_TRUST_XFF", "1");
      const req = makeRequest({ "x-real-ip": "203.0.113.5" });
      expect(clientIp(req)).toBe(digestId("ip", "203.0.113.5"));

      vi.stubEnv("RATE_LIMIT_TRUST_XFF", "yes");
      expect(clientIp(req)).toBe(digestId("ip", "203.0.113.5"));
    });
  });

  describe("default (XFF untrusted) — UA fingerprint isolation", () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    it("different User-Agents resolve to different client ids (not 'unknown')", () => {
      const chrome = makeRequest({ "user-agent": "Mozilla/5.0 Chrome/120" });
      const firefox = makeRequest({ "user-agent": "Mozilla/5.0 Firefox/121" });
      const a = clientIp(chrome);
      const b = clientIp(firefox);
      expect(a).not.toBe("unknown");
      expect(b).not.toBe("unknown");
      expect(a).not.toBe(b);
    });

    it("the same User-Agent resolves to the same client id (stable bucket)", () => {
      const ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/120";
      expect(clientIp(makeRequest({ "user-agent": ua }))).toBe(
        clientIp(makeRequest({ "user-agent": ua }))
      );
    });

    it("does NOT surface the raw UA in the resolved id (privacy)", () => {
      const raw = "Mozilla/5.0 unique-fingerprint-string-xyz";
      const id = clientIp(makeRequest({ "user-agent": raw }));
      expect(id).not.toContain(raw);
      expect(id.startsWith("ua:")).toBe(true);
      expect(id.length).toBeLessThan(raw.length);
    });

    it("spoofed XFF alone cannot override the UA-derived id (no reset attack)", () => {
      const spoofed = makeRequest({
        "user-agent": "Mozilla/5.0 Chrome/120",
        "x-forwarded-for": "999.999.999.999",
      });
      const honest = makeRequest({ "user-agent": "Mozilla/5.0 Chrome/120" });
      expect(clientIp(spoofed)).toBe(clientIp(honest));
    });

    it("prefers a session_id cookie over the UA fingerprint", () => {
      const req = makeRequest({
        "user-agent": "Mozilla/5.0 Chrome/120",
        cookie: "session_id=abc123; theme=dark",
      });
      expect(clientIp(req)).toBe(digestId("cookie", "session_id=abc123"));
    });

    it("prefers the `sid` cookie when session_id is absent", () => {
      const req = makeRequest({
        "user-agent": "Mozilla/5.0 Chrome/120",
        cookie: "sid=xyz789",
      });
      expect(clientIp(req)).toBe(digestId("cookie", "sid=xyz789"));
    });

    it("falls back to 'unknown' only when UA + cookie + XFF are all absent", () => {
      expect(resolveClientId(makeRequest())).toBe("unknown");
    });

    it("honors a custom RATE_LIMIT_CLIENT_ID_SALT (different salt → different id)", () => {
      const ua = "Mozilla/5.0 Chrome/120";
      vi.stubEnv("RATE_LIMIT_CLIENT_ID_SALT", "custom-salt-A");
      const a = clientIp(makeRequest({ "user-agent": ua }));
      vi.stubEnv("RATE_LIMIT_CLIENT_ID_SALT", "custom-salt-B");
      const b = clientIp(makeRequest({ "user-agent": ua }));
      expect(a).not.toBe(b);
    });
  });
});
