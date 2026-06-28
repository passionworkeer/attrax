// @vitest-environment node

/**
 * scan-queue crash-recovery tests.
 *
 * Verifies:
 * 1. A job in `running` state older than ZOMBIE_TIMEOUT_MS is re-enqueued at
 *    drain start (so a crashed process doesn't lose work permanently).
 * 2. A zombie that has exhausted MAX_ATTEMPTS is marked permanently failed
 *    instead of being retried forever.
 * 3. markJobFailed's failed marker survives an unlinkSync EPERM (Windows
 *    antivirus lock) — the `state:"failed"` job file stays on disk and
 *    reclaimZombies ignores it on the next restart.
 *
 * Uses a real temp queue dir under data/scan-queue via fs to exercise the
 * actual atomic-write + reclaim path, with runScan mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const QUEUE_DIR = join(process.cwd(), "data", "scan-queue-test");

// Mock runScan so we observe calls without touching the network. We mock the
// module BEFORE importing scan-queue.
const { mockRunScan, mockUpdateSession, unlinkShouldFail } = vi.hoisted(() => ({
  mockRunScan: vi.fn(() => Promise.resolve()),
  mockUpdateSession: vi.fn(),
  // Toggle: when true, the mocked unlinkSync throws EPERM (Windows AV lock).
  unlinkShouldFail: { current: false as boolean },
}));

vi.mock("@/lib/pipeline/scan", () => ({ runScan: mockRunScan }));
// Re-export everything from the real session-store so writeJsonAtomic works
// against the real fs, but override updateSession to a no-op spy so reclaim
// doesn't try to write session files into data/sessions.
vi.mock("@/lib/pipeline/session-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pipeline/session-store")>(
    "@/lib/pipeline/session-store"
  );
  return { ...actual, updateSession: mockUpdateSession };
});
vi.mock("@/lib/pipeline/upload-storage", () => ({ logUserActivity: vi.fn() }));

// Mock `fs` so we can make unlinkSync throw EPERM on demand for the JOB file
// only (not for writeJsonAtomic's temp-file cleanup). scan-queue imports
// unlinkSync as a static binding, so we mock at the module level BEFORE the
// SUT is imported. We re-export every other fs primitive from the real
// module so listJobs / writeJsonAtomic keep working.
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    unlinkSync(path: unknown) {
      const p = String(path);
      // Only simulate the Windows-EPERM lock on the actual job file path
      // (data/scan-queue/<id>.json), NOT on writeJsonAtomic's *.tmp files.
      if (unlinkShouldFail.current && p.endsWith(".json")) {
        const err = new Error(
          "EPERM: operation not permitted"
        ) as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return actual.unlinkSync(p);
    },
  };
});

// Force NODE_ENV !== "test" so enqueueScan/drainQueue use the file-backed path
// instead of the in-memory shortcut.
const realNodeEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = "production";
  process.env.SCAN_ZOMBIE_TIMEOUT_MS = "0"; // treat any running job as zombie
  process.env.SCAN_MAX_ATTEMPTS = "3";
});
afterEach(() => {
  process.env.NODE_ENV = realNodeEnv;
  delete process.env.SCAN_ZOMBIE_TIMEOUT_MS;
  delete process.env.SCAN_MAX_ATTEMPTS;
});

describe("scan-queue crash recovery", () => {
  beforeEach(() => {
    mockRunScan.mockClear();
    mockUpdateSession.mockClear();
    mockRunScan.mockResolvedValue(undefined);
    if (existsSync(QUEUE_DIR)) rmSync(QUEUE_DIR, { recursive: true, force: true });
    mkdirSync(QUEUE_DIR, { recursive: true });

    // Redirect QUEUE_DIR by monkey-patching join results is fragile; instead
    // we write zombie files into the real data/scan-queue dir and clean up.
  });

  afterEach(() => {
    // Clean both the test sandbox and any stray files in the real queue dir
    // that this test created.
    if (existsSync(QUEUE_DIR)) rmSync(QUEUE_DIR, { recursive: true, force: true });
    const realDir = join(process.cwd(), "data", "scan-queue");
    if (existsSync(realDir)) {
      for (const f of readdirSync(realDir)) {
        if (f.endsWith(".json")) {
          try {
            rmSync(join(realDir, f), { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
  });

  it("re-enqueues a zombie running job on drain start", async () => {
    const { drainQueue } = await import("@/lib/pipeline/scan-queue");
    const realDir = join(process.cwd(), "data", "scan-queue");
    if (!existsSync(realDir)) mkdirSync(realDir, { recursive: true });

    // Seed a zombie: running state, started long ago, attempts=1.
    const jobId = `1000_zombie_session`;
    const zombie = {
      jobId,
      sessionId: "zombie_session",
      input: {
        images: [{ bufferBase64: Buffer.from("x").toString("base64"), originalName: "a.jpg", mimeType: "image/jpeg" }],
        category: "electronics",
        markets: ["EU"],
      },
      createdAt: 1000,
      attempts: 1,
      state: "running",
      startedAt: 1000, // ancient -> will be reclaimed
    };
    writeFileSync(join(realDir, `${jobId}.json`), JSON.stringify(zombie), "utf-8");

    await drainQueue();
    // Allow executeJob promise chain to flush.
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRunScan).toHaveBeenCalledWith(
      "zombie_session",
      expect.objectContaining({ category: "electronics" })
    );
  });

  it("marks a zombie as permanently failed when attempts are exhausted", async () => {
    const { drainQueue } = await import("@/lib/pipeline/scan-queue");
    const realDir = join(process.cwd(), "data", "scan-queue");
    if (!existsSync(realDir)) mkdirSync(realDir, { recursive: true });

    process.env.SCAN_MAX_ATTEMPTS = "1";
    const jobId = `2000_exhausted_session`;
    const zombie = {
      jobId,
      sessionId: "exhausted_session",
      input: {
        images: [{ bufferBase64: Buffer.from("x").toString("base64"), originalName: "a.jpg", mimeType: "image/jpeg" }],
        category: "electronics",
        markets: ["EU"],
      },
      createdAt: 2000,
      attempts: 1, // already at limit
      state: "running",
      startedAt: 2000,
    };
    writeFileSync(join(realDir, `${jobId}.json`), JSON.stringify(zombie), "utf-8");

    await drainQueue();
    await new Promise((r) => setTimeout(r, 50));

    // Should NOT retry — runScan must not be called for an exhausted zombie.
    expect(mockRunScan).not.toHaveBeenCalled();
    // Session should be marked failed.
    expect(mockUpdateSession).toHaveBeenCalledWith(
      "exhausted_session",
      expect.objectContaining({
        status: "failed",
        error: "SCAN_MAX_ATTEMPTS_EXCEEDED",
      })
    );
  });

  it("persists the failed marker even when unlinkSync throws EPERM, and reclaimZombies does not retry it", async () => {
    // Toggle the fs mock so unlinkSync throws EPERM for *.json job files
    // (simulating Windows antivirus holding the file). The failed marker
    // MUST still be on disk in `state: "failed"` and reclaimZombies must
    // skip it on a second drain.
    unlinkShouldFail.current = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const realDir = join(process.cwd(), "data", "scan-queue");
      if (!existsSync(realDir)) mkdirSync(realDir, { recursive: true });

      process.env.SCAN_MAX_ATTEMPTS = "1";
      const jobId = `3000_eperm_session`;
      const zombie = {
        jobId,
        sessionId: "eperm_session",
        input: {
          images: [
            { bufferBase64: Buffer.from("x").toString("base64"), originalName: "a.jpg", mimeType: "image/jpeg" },
          ],
          category: "electronics",
          markets: ["EU"],
        },
        createdAt: 3000,
        attempts: 1, // at the limit
        state: "running",
        startedAt: 3000, // ancient -> reclaimed on next drain
      };
      writeFileSync(join(realDir, `${jobId}.json`), JSON.stringify(zombie), "utf-8");

      const { drainQueue } = await import("@/lib/pipeline/scan-queue");
      await drainQueue();
      await new Promise((r) => setTimeout(r, 50));

      // The job file must still exist in `failed` state (unlink was blocked).
      const markerPath = join(realDir, `${jobId}.json`);
      expect(existsSync(markerPath)).toBe(true);
      const persisted = JSON.parse(readFileSync(markerPath, "utf-8"));
      expect(persisted.state).toBe("failed");
      expect(persisted.failureReason).toBe("SCAN_MAX_ATTEMPTS_EXCEEDED");
      expect(typeof persisted.failedAt).toBe("number");

      // runScan must never have run — the failed marker prevented retry.
      expect(mockRunScan).not.toHaveBeenCalled();

      // A second drain (simulating process restart) must NOT re-run the
      // failed job either: reclaimZombies ignores state:"failed".
      mockRunScan.mockClear();
      await drainQueue();
      await new Promise((r) => setTimeout(r, 50));
      expect(mockRunScan).not.toHaveBeenCalled();
    } finally {
      unlinkShouldFail.current = false;
      warnSpy.mockRestore();
    }
  });
});
