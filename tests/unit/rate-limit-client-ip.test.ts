/**
 * Tests for clientIp — added to lock in the trust contract:
 * X-Real-IP (single-value, harder to spoof) wins over X-Forwarded-For
 * (multi-value, trivially spoofable).
 */
import { describe, it, expect } from "vitest";
import { clientIp } from "@/lib/rate-limit";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/", { headers });
}

describe("clientIp", () => {
  it("returns X-Real-IP when present, ignoring XFF", () => {
    const req = makeRequest({
      "x-real-ip": "203.0.113.5",
      "x-forwarded-for": "1.2.3.4, 10.0.0.1",
    });
    expect(clientIp(req)).toBe("203.0.113.5");
  });

  it("returns the leftmost XFF entry when X-Real-IP is missing", () => {
    const req = makeRequest({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    expect(clientIp(req)).toBe("198.51.100.7");
  });

  it("returns 'unknown' when neither header is set", () => {
    expect(clientIp(makeRequest())).toBe("unknown");
  });

  it("returns 'unknown' when X-Real-IP is whitespace and XFF is empty", () => {
    const req = makeRequest({ "x-real-ip": "   " });
    expect(clientIp(req)).toBe("unknown");
  });

  it("trims whitespace from X-Real-IP", () => {
    const req = makeRequest({ "x-real-ip": "  203.0.113.5  " });
    expect(clientIp(req)).toBe("203.0.113.5");
  });

  it("does not trust spoofed XFF when both headers are present", () => {
    // Attacker sends both. We trust X-Real-IP (set by trusted reverse proxy).
    const req = makeRequest({
      "x-real-ip": "203.0.113.5",
      "x-forwarded-for": "999.999.999.999",
    });
    expect(clientIp(req)).toBe("203.0.113.5");
  });
});