import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useScanPolling } from "@/lib/hooks/useScanPolling";
import type { ScanStatus } from "@/lib/types";

// Stable fetch mock factory
function makeFetchMock(response: Partial<ScanStatus>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  });
}

describe("useScanPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns null initially", () => {
    const fetchSpy = makeFetchMock({ sessionId: "test", status: "processing", progress: 0, stageText: "..." });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useScanPolling("test_session"));
    expect(result.current).toBeNull();
  });

  it("polls and updates status to ready", async () => {
    const responses: Partial<ScanStatus>[] = [
      { sessionId: "s1", status: "processing", progress: 30, stageText: "分析中..." },
      { sessionId: "s1", status: "processing", progress: 65, stageText: "匹配法规..." },
      { sessionId: "s1", status: "ready", progress: 100, stageText: "完成" },
    ];
    let callIndex = 0;
    const fetchSpy = vi.fn().mockImplementation(async () => {
      const r = responses[callIndex++] ?? responses[responses.length - 1];
      return { ok: true, json: async () => r };
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useScanPolling("s1"));

    // First poll (immediate)
    expect(result.current).toBeNull(); // still null before first resolution

    // Advance timer to allow poll cycle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(result.current?.status).toBe("processing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(result.current?.status).toBe("ready");
  });

  it("stops polling and sets failed when fetch returns non-ok", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useScanPolling("not_found"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current?.status).toBe("failed");
    expect(result.current?.error).toBe("会话已失效");
  });

  it("does not poll when sessionId is empty", () => {
    const fetchSpy = makeFetchMock({});
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useScanPolling(""));
    // No fetch should be called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("cancels polling on unmount", async () => {
    const fetchSpy = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ sessionId: "s1", status: "processing", progress: 50, stageText: "..." }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { unmount } = renderHook(() => useScanPolling("s1"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const callCountBefore = fetchSpy.mock.calls.length;
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // No new calls after unmount
    expect(fetchSpy.mock.calls.length).toBe(callCountBefore);
  });

  it("renders processing state with correct progress", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessionId: "s1", status: "processing", progress: 45, stageText: "匹配法规库..." }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() => useScanPolling("s1"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(result.current?.progress).toBe(45);
    expect(result.current?.stageText).toBe("匹配法规库...");
    expect(result.current?.status).toBe("processing");
  });
});