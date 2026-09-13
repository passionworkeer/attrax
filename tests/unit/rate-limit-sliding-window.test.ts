import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit - Sliding Window & Storage Behavior", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.unstubAllEnvs();
    tempDir = mkdtempSync(join(tmpdir(), "attrax-rate-limit-test-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("bypasses rate limit in test environment by default", () => {
    // In test env, checkRateLimit always returns true
    expect(checkRateLimit("test-key-1", 1, 1000)).toBe(true);
    expect(checkRateLimit("test-key-1", 1, 1000)).toBe(true);
  });

  it("rejects invalid limit or windowMs arguments in non-test env", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(checkRateLimit("k", 0, 1000)).toBe(false);
    expect(checkRateLimit("k", -5, 1000)).toBe(false);
    expect(checkRateLimit("k", 1.5, 1000)).toBe(false);
    expect(checkRateLimit("k", 5, 0)).toBe(false);
    expect(checkRateLimit("k", 5, -100)).toBe(false);
  });

  it("enforces memory rate limit in development mode", () => {
    vi.stubEnv("NODE_ENV", "development");

    const key = `dev-user-${Date.now()}`;
    const limit = 3;
    const windowMs = 5000;

    // 1st, 2nd, 3rd requests succeed
    expect(checkRateLimit(key, limit, windowMs)).toBe(true);
    expect(checkRateLimit(key, limit, windowMs)).toBe(true);
    expect(checkRateLimit(key, limit, windowMs)).toBe(true);

    // 4th request exceeds limit and is rejected
    expect(checkRateLimit(key, limit, windowMs)).toBe(false);

    // A different key should still have full quota
    const otherKey = `dev-user-other-${Date.now()}`;
    expect(checkRateLimit(otherKey, limit, windowMs)).toBe(true);
  });

  it("enforces file-backed rate limit in production mode with isolation", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_STORE_DIR", tempDir);

    const key = `prod-client-${Date.now()}`;
    const limit = 2;
    const windowMs = 10_000;

    expect(checkRateLimit(key, limit, windowMs)).toBe(true);
    expect(checkRateLimit(key, limit, windowMs)).toBe(true);
    expect(checkRateLimit(key, limit, windowMs)).toBe(false);

    // Another client is unaffected
    const otherClient = `prod-client-2-${Date.now()}`;
    expect(checkRateLimit(otherClient, limit, windowMs)).toBe(true);
  });
});
