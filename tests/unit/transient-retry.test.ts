import { describe, expect, it } from "vitest";
import {
  isRetryableStatus,
  MAX_TRANSIENT_RETRIES,
  transientRetryDelayMs,
} from "@/lib/transient-retry";

describe("isRetryableStatus", () => {
  it("treats rate limiting and upstream trouble as retryable", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }
  });

  it("does not retry deterministic client errors", () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });

  it("does not retry success or redirects", () => {
    for (const status of [200, 202, 204, 301, 304]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe("transientRetryDelayMs", () => {
  it("backs off exponentially from 3s and caps at 15s", () => {
    expect(transientRetryDelayMs(1)).toBe(3000);
    expect(transientRetryDelayMs(2)).toBe(6000);
    expect(transientRetryDelayMs(3)).toBe(12000);
    expect(transientRetryDelayMs(4)).toBe(15000);
    expect(transientRetryDelayMs(9)).toBe(15000);
  });

  it("keeps the total retry budget inside a scan's polling window", () => {
    let total = 0;
    for (let attempt = 1; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      total += transientRetryDelayMs(attempt);
    }
    expect(total).toBeLessThanOrEqual(60_000);
  });
});
