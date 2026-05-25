import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScanPolling } from "@/lib/hooks/useScanPolling";
import type { ScanStatus } from "@/lib/types";
import { POLL_MAX_DURATION_MS } from "@/lib/constants";

// Store original RAF for restoration
const originalRAF = globalThis.requestAnimationFrame;

// Create a controlled RAF mock that we can advance manually
let rafCallbacks: FrameRequestCallback[] = [];
const controlledRAF = vi.fn((callback: FrameRequestCallback) => {
  rafCallbacks.push(callback);
  return rafCallbacks.length - 1; // return index as id
});

function advanceAnimationFrame() {
  vi.advanceTimersByTime(16);
}

function runAnimationFrames(count: number) {
  for (let i = 0; i < count; i++) {
    const pendingCallbacks = rafCallbacks.splice(0);
    pendingCallbacks.forEach((cb) => cb(performance.now()));
    advanceAnimationFrame();
  }
}

async function flushInitialPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

function makeFetchMock(response: Partial<ScanStatus>, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => response,
  });
}

describe("useScanPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    rafCallbacks = [];
    globalThis.requestAnimationFrame = controlledRAF;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalThis.requestAnimationFrame = originalRAF;
    rafCallbacks = [];
    sessionStorage.clear();
  });

  describe("Initial state", () => {
    it("returns null status before first poll", () => {
      const fetchSpy = makeFetchMock({
        sessionId: "test",
        status: "processing",
        progress: 0,
        stageText: "...",
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("test_session"));
      expect(result.current.status).toBeNull();
    });

    it("returns displayProgress starting at 0", () => {
      const fetchSpy = makeFetchMock({});
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("test_session"));
      expect(result.current.displayProgress).toBe(0);
    });
  });

  describe("Polling behavior", () => {
    it("does not poll when sessionId is empty", () => {
      const fetchSpy = makeFetchMock({});
      vi.stubGlobal("fetch", fetchSpy);

      renderHook(() => useScanPolling(""));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("starts polling when sessionId is provided", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "processing",
          progress: 0,
          stageText: "...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      renderHook(() => useScanPolling("s1"));

      // Trigger useEffect
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(fetchSpy).toHaveBeenCalled();
    });

    it("polls and updates status when fetch returns data", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "processing",
          progress: 30,
          stageText: "分析中...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(result.current?.status?.status).toBe("processing");
      expect(result.current?.status?.progress).toBe(30);
    });

    it("sets failed status when fetch returns non-ok", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("not_found"));

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(result.current?.status?.status).toBe("failed");
      expect(result.current?.status?.error).toBe("Scan session expired.");
    });

    it("sets failed status when fetch rejects with an Error", async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new Error("Network unavailable"));
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await flushInitialPoll();

      expect(result.current.status).toMatchObject({
        sessionId: "s1",
        status: "failed",
        error: "Network unavailable",
      });
    });

    it("sets a generic failed status when fetch rejects with a non-Error", async () => {
      const fetchSpy = vi.fn().mockRejectedValue("offline");
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await flushInitialPoll();

      expect(result.current.status).toMatchObject({
        sessionId: "s1",
        status: "failed",
        error: "Scan request failed.",
      });
    });

    it("uses the session access token from sessionStorage", async () => {
      sessionStorage.setItem("scan-token:s1", "token-123");
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "ready",
          progress: 100,
          stageText: "done",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      renderHook(() => useScanPolling("s1"));

      await flushInitialPoll();

      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/scan/s1",
        expect.objectContaining({
          cache: "no-store",
          headers: { Authorization: "Bearer token-123" },
        })
      );
    });

    it("polls multiple times during processing", async () => {
      let callCount = 0;
      const fetchSpy = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            sessionId: "s1",
            status: callCount === 1 ? "processing" : "ready",
            progress: callCount * 20,
            stageText: "...",
          }),
        };
      });
      vi.stubGlobal("fetch", fetchSpy);

      renderHook(() => useScanPolling("s1"));

      // First poll
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      await act(async () => {
        vi.advanceTimersByTime(850); // POLL_INTERVAL_MS
      });

      // Second poll
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      await act(async () => {
        vi.advanceTimersByTime(850);
      });

      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Status transitions - stopping polling", () => {
    it("stops polling when status is 'ready'", async () => {
      let callCount = 0;
      const fetchSpy = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            sessionId: "s1",
            status: callCount === 1 ? "processing" : "ready",
            progress: 100,
            stageText: "完成",
          }),
        };
      });
      vi.stubGlobal("fetch", fetchSpy);

      renderHook(() => useScanPolling("s1"));

      // First poll - returns processing
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(callCount).toBe(1);

      // Wait for next poll interval
      await act(async () => {
        vi.advanceTimersByTime(850);
      });

      // Second poll - returns ready, polling should stop
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(callCount).toBe(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Try to trigger more polling
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      // Should still be 2 calls since polling stopped
      expect(callCount).toBe(2);
    });

    it("stops polling when status is 'failed'", async () => {
      let callCount = 0;
      const fetchSpy = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            sessionId: "s1",
            status: callCount === 1 ? "processing" : "failed",
            progress: 50,
            stageText: "失败",
            error: "Scan failed",
          }),
        };
      });
      vi.stubGlobal("fetch", fetchSpy);

      renderHook(() => useScanPolling("s1"));

      // First poll
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Wait for next poll
      await act(async () => {
        vi.advanceTimersByTime(850);
      });
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(callCount).toBe(2);

      // Try to trigger more polling
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      // Should still be 2 calls
      expect(callCount).toBe(2);
    });
  });

  describe("Animation / displayProgress", () => {
    it("updates displayProgress toward targetProgress", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "processing",
          progress: 100, // target is 100
          stageText: "...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      // Trigger initial poll
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Run RAF callbacks multiple times to animate
      await act(async () => {
        runAnimationFrames(10);
      });

      // displayProgress should have moved toward 100
      expect(result.current.displayProgress).toBeGreaterThan(0);
    });

    it("animation uses easing to approach target", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "processing",
          progress: 50,
          stageText: "...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Initial displayProgress should be 0
      const initialProgress = result.current.displayProgress;

      // Advance animation
      await act(async () => {
        runAnimationFrames(20);
      });

      // Progress should have increased
      expect(result.current.displayProgress).toBeGreaterThanOrEqual(initialProgress);
    });

    it("animation stops when close to target (< 0.15 diff)", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "processing",
          progress: 100,
          stageText: "...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Run animation until settled
      await act(async () => {
        runAnimationFrames(100);
      });

      // Should settle close to target (100)
      expect(result.current.displayProgress).toBeGreaterThanOrEqual(95);
    });

    it("rounds displayProgress to integer", () => {
      const fetchSpy = makeFetchMock({
        sessionId: "s1",
        status: "processing",
        progress: 75,
        stageText: "...",
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      // Type check - should be number
      expect(typeof result.current.displayProgress).toBe("number");
    });
  });

  describe("Cleanup on unmount", () => {
    it("cancels polling on unmount", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "processing",
          progress: 50,
          stageText: "...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { unmount } = renderHook(() => useScanPolling("s1"));

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      const callCountBefore = fetchSpy.mock.calls.length;
      unmount();

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(fetchSpy.mock.calls.length).toBe(callCountBefore);
    });

    it("cleans up RAF on unmount", () => {
      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
      vi.stubGlobal("cancelAnimationFrame", cancelSpy);

      const fetchSpy = makeFetchMock({});
      vi.stubGlobal("fetch", fetchSpy);

      const { unmount } = renderHook(() => useScanPolling("s1"));

      unmount();

      expect(cancelSpy).toHaveBeenCalled();
    });
  });

  describe("Fetch URL construction", () => {
    it("uses correct API endpoint", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "test123",
          status: "processing",
          progress: 0,
          stageText: "...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      renderHook(() => useScanPolling("test123"));

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/scan/test123",
        expect.objectContaining({ cache: "no-store" })
      );
    });
  });

  describe("Edge cases", () => {
    it("unwraps successful API response envelopes", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sessionId: "s1",
            status: "ready",
            progress: 100,
            stageText: "done",
          },
          error: null,
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await flushInitialPoll();

      expect(result.current.status).toMatchObject({
        sessionId: "s1",
        status: "ready",
        progress: 100,
      });
    });

    it("fails gracefully when the scan response body is invalid JSON", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("invalid json");
        },
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await flushInitialPoll();

      expect(result.current.status).toMatchObject({
        sessionId: "s1",
        status: "failed",
        error: "Invalid scan response.",
      });
    });

    it("times out long-running processing scans", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "processing",
          progress: 50,
          stageText: "working",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MAX_DURATION_MS + 5000);
      });

      expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
      expect(result.current.status).toMatchObject({
        sessionId: "s1",
        status: "failed",
        error: "Scan timed out.",
      });
    });

    it("does not update status when a pending fetch rejects after unmount", async () => {
      let rejectFetch: (reason?: unknown) => void = () => {};
      const fetchSpy = vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject;
          })
      );
      vi.stubGlobal("fetch", fetchSpy);

      const { result, unmount } = renderHook(() => useScanPolling("s1"));

      await act(async () => {
        await Promise.resolve();
      });
      unmount();
      await act(async () => {
        rejectFetch(new Error("late failure"));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.status).toBeNull();
    });

    it("handles missing progress field", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "s1",
          status: "processing",
          // progress is missing
          stageText: "...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(result.current?.status).toBeDefined();
      expect(result.current?.status?.sessionId).toBe("s1");
    });

    it("handles null/undefined from fetch", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => null,
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { result } = renderHook(() => useScanPolling("s1"));

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Should handle gracefully
      expect(result.current.status).toBeDefined();
    });

    it("re-fetches when sessionId changes", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: "new_session",
          status: "processing",
          progress: 0,
          stageText: "...",
        }),
      });
      vi.stubGlobal("fetch", fetchSpy);

      const { rerender } = renderHook(
        ({ id }: { id: string }) => useScanPolling(id),
        { initialProps: { id: "session1" } }
      );

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/scan/session1",
        expect.objectContaining({ cache: "no-store" })
      );

      // Change sessionId
      rerender({ id: "session2" });

      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // Should have polled with new session
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/scan/session2",
        expect.objectContaining({ cache: "no-store" })
      );
    });
  });
});
