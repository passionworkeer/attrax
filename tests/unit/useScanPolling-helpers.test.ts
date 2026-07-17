/**
 * Direct tests for useScanPolling's internal guard helpers.
 *
 * These functions decide whether polling continues or aborts with an error,
 * so their semantics are critical and were previously only covered indirectly
 * through mocked fetch tests.
 */
import { describe, it, expect } from "vitest";
import {
  failedStatus,
  isDisplayableTerminalStatus,
  isScanStatusLike,
} from "@/lib/hooks/useScanPolling";

describe("isScanStatusLike", () => {
  it("accepts every backend scan status", () => {
    expect(isScanStatusLike({ status: "processing" })).toBe(true);
    expect(isScanStatusLike({ status: "ready" })).toBe(true);
    expect(isScanStatusLike({ status: "degraded" })).toBe(true);
    expect(isScanStatusLike({ status: "failed" })).toBe(true);
  });

  it("rejects unknown status values", () => {
    expect(isScanStatusLike({ status: "unknown" })).toBe(false);
    expect(isScanStatusLike({ status: "" })).toBe(false);
    expect(isScanStatusLike({ status: undefined })).toBe(false);
    expect(isScanStatusLike({ status: 200 })).toBe(false);
    expect(isScanStatusLike({ status: null })).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(isScanStatusLike(null)).toBe(false);
    expect(isScanStatusLike(undefined)).toBe(false);
    expect(isScanStatusLike("processing")).toBe(false);
    expect(isScanStatusLike(42)).toBe(false);
    expect(isScanStatusLike(true)).toBe(false);
  });

  it("rejects empty objects and objects without status", () => {
    expect(isScanStatusLike({})).toBe(false);
    expect(isScanStatusLike({ sessionId: "scan_x" })).toBe(false);
    expect(isScanStatusLike({ status: null, progress: 50 })).toBe(false);
  });

  it("preserves extra fields on accepted payloads", () => {
    const payload = {
      sessionId: "scan_abc",
      status: "ready",
      progress: 100,
      result: { foo: "bar" },
    };
    expect(isScanStatusLike(payload)).toBe(true);
    // Type guard guarantees payload is ScanStatus; verify by accessing .status
    expect((payload as { status: string }).status).toBe("ready");
  });
});

describe("failedStatus", () => {
  it("builds a failed ScanStatus with the given sessionId and error", () => {
    const status = failedStatus("scan_xyz", "Network down");
    expect(status).toEqual({
      sessionId: "scan_xyz",
      status: "failed",
      progress: 0,
      stageText: "",
      error: "Network down",
    });
  });

  it("always sets status='failed' regardless of sessionId", () => {
    expect(failedStatus("scan_a", "x").status).toBe("failed");
    expect(failedStatus("", "x").status).toBe("failed");
    expect(failedStatus("scan_with_underscores_and_123", "x").status).toBe("failed");
  });

  it("resets progress to 0 and stageText to empty", () => {
    const status = failedStatus("scan_x", "boom");
    expect(status.progress).toBe(0);
    expect(status.stageText).toBe("");
  });

  it("preserves the error message verbatim (no transformation)", () => {
    const msg = "Failed to fetch: TypeError: network unreachable (at 2026-06-26T10:00:00Z)";
    const status = failedStatus("scan_x", msg);
    expect(status.error).toBe(msg);
  });
});

describe("isDisplayableTerminalStatus", () => {
  it("routes ready and degraded results out of the burning page", () => {
    expect(isDisplayableTerminalStatus("ready")).toBe(true);
    expect(isDisplayableTerminalStatus("degraded")).toBe(true);
    expect(isDisplayableTerminalStatus("processing")).toBe(false);
    expect(isDisplayableTerminalStatus("failed")).toBe(false);
  });
});
