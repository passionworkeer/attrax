import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScanPolling } from "@/lib/hooks/useScanPolling";
import type { ScanStatus } from "@/lib/types";

function makeFetchMock(response: Partial<ScanStatus>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  });
}

// Mock requestAnimationFrame to avoid animation loop in tests
// Use a stub that doesn't call back (no-op) so the RAF loop stops naturally
const originalRAF = globalThis.requestAnimationFrame;
const noopRAF = vi.fn(() => 0);

describe("useScanPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Stub RAF so animation tick never fires (avoids infinite loop)
    globalThis.requestAnimationFrame = noopRAF;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalThis.requestAnimationFrame = originalRAF;
  });

  it("returns null status before first poll", () => {
    const fetchSpy = makeFetchMock({ sessionId: "test", status: "processing", progress: 0, stageText: "..." });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useScanPolling("test_session"));
    // The hook returns { status, displayProgress } immediately.
    // status field starts as null before first fetch completes.
    expect(result.current.status).toBeNull();
  });

  it("polls and updates status when fetch returns data", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: "s1", status: "processing", progress: 30, stageText: "分析中..." }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useScanPolling("s1"));

    // Trigger the initial poll
    await act(async () => { vi.advanceTimersByTime(50); });

    // After first poll, status should be populated
    expect(result.current?.status).not.toBeNull();
    expect(result.current?.status?.status).toBe("processing");
  });

  it("sets failed when fetch returns non-ok", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useScanPolling("not_found"));

    await act(async () => { vi.advanceTimersByTime(50); });

    expect(result.current?.status?.status).toBe("failed");
    expect(result.current?.status?.error).toBe("会话已失效");
  });

  it("does not poll when sessionId is empty", () => {
    const fetchSpy = makeFetchMock({});
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useScanPolling(""));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cancels polling on unmount", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: "s1", status: "processing", progress: 50, stageText: "..." }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { unmount } = renderHook(() => useScanPolling("s1"));

    await act(async () => { vi.advanceTimersByTime(50); });

    const callCountBefore = fetchSpy.mock.calls.length;
    unmount();

    await act(async () => { vi.advanceTimersByTime(2000); });

    expect(fetchSpy.mock.calls.length).toBe(callCountBefore);
  });

  it("returns displayProgress via the hook return value", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: "s1", status: "processing", progress: 45, stageText: "匹配法规库..." }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useScanPolling("s1"));

    await act(async () => { vi.advanceTimersByTime(50); });

    // status is the ScanStatus object from fetch
    expect(result.current?.status?.status).toBe("processing");
    expect(result.current?.status?.progress).toBe(45);
    expect(result.current?.status?.stageText).toBe("匹配法规库...");
    // displayProgress is the animated number (starts at 0, no RAF fires)
    expect(typeof result.current?.displayProgress).toBe("number");
  });
});