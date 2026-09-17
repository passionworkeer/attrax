import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResultLoader } from "@/app/result/[sessionId]/use-result-loader";
import { mockScanResult } from "@/lib/mock/blaze-scan-result";
import type { ScanResult } from "@/lib/types";

const mockCopy = {
  failed: "Scan failed",
  loaded: "Loaded successfully",
  notFound: "Scan session not found",
  processing: "Processing scan...",
  restored: "Restored from cache",
};

describe("useResultLoader Hook", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("immediately returns initialResult for demo sessions without fetching", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");

    const { result } = renderHook(() =>
      useResultLoader({
        sessionId: "demo",
        isDemoSession: true,
        locale: "zh",
        initialResult: mockScanResult,
        loadingMessage: "Loading...",
        copy: mockCopy,
      })
    );

    expect(result.current.result).toEqual(mockScanResult);
    expect(result.current.message).toBe("Loading...");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("restores cached scan result from sessionStorage synchronously", async () => {
    const cachedData: Partial<ScanResult> = {
      ...mockScanResult,
      sessionId: "cached_123",
      productName: "Cached Product",
    };
    sessionStorage.setItem("scan:cached_123", JSON.stringify(cachedData));

    const fetchSpy = vi.spyOn(global, "fetch");

    const { result } = renderHook(() =>
      useResultLoader({
        sessionId: "cached_123",
        isDemoSession: false,
        locale: "zh",
        initialResult: null,
        loadingMessage: "Loading...",
        copy: mockCopy,
      })
    );

    expect(result.current.result?.productName).toBe("Cached Product");
    expect(result.current.message).toBe(mockCopy.restored);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears corrupted sessionStorage entries gracefully", async () => {
    sessionStorage.setItem("scan:corrupt_123", "invalid-json{{{");

    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() =>
      new Promise(() => {}) // never resolves in this test
    );

    renderHook(() =>
      useResultLoader({
        sessionId: "corrupt_123",
        isDemoSession: false,
        locale: "zh",
        initialResult: null,
        loadingMessage: "Loading...",
        copy: mockCopy,
      })
    );

    expect(sessionStorage.getItem("scan:corrupt_123")).toBeNull();
  });

  it("handles 404 response by setting notFound message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    const { result } = renderHook(() =>
      useResultLoader({
        sessionId: "non_existent_404",
        isDemoSession: false,
        locale: "en",
        initialResult: null,
        loadingMessage: "Loading...",
        copy: mockCopy,
      })
    );

    await vi.waitFor(() => {
      expect(result.current.message).toBe(mockCopy.notFound);
    });
  });

  it("handles degraded scan status and stores degradedReason", async () => {
    const degradedPayload = {
      status: "degraded",
      degradedReason: "LLM rate limited, fallback rules applied",
      progress: 100,
      result: {
        ...mockScanResult,
        sessionId: "degraded_session",
        source: "fallback",
      },
    };

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => degradedPayload,
    } as Response);

    const { result } = renderHook(() =>
      useResultLoader({
        sessionId: "degraded_session",
        isDemoSession: false,
        locale: "zh",
        initialResult: null,
        loadingMessage: "Loading...",
        copy: mockCopy,
      })
    );

    await vi.waitFor(() => {
      expect(result.current.result?.sessionId).toBe("degraded_session");
      expect(result.current.degradedReason).toBe("LLM rate limited, fallback rules applied");
    });
  });

  it("handles network error gracefully without crashing", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network connection dropped"));

    const { result } = renderHook(() =>
      useResultLoader({
        sessionId: "network_err_session",
        isDemoSession: false,
        locale: "en",
        initialResult: null,
        loadingMessage: "Loading...",
        copy: mockCopy,
      })
    );

    await vi.waitFor(() => {
      expect(result.current.message).toMatch(/failed to load/i);
    });
  });
});


describe("result recovery UX", () => {
  it("retries a failed request and displays the returned result", async () => {
    sessionStorage.clear();
    const fetcher = vi.spyOn(global, "fetch").mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ready", result: { ...mockScanResult, sessionId: "retry_ux" } }) } as Response);
    const { result } = renderHook(() => useResultLoader({sessionId: "retry_ux", isDemoSession: false, locale: "en", initialResult: null, loadingMessage: "Loading", copy: mockCopy}));
    await vi.waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(result.current.message).toContain("temporarily unavailable");
    act(() => result.current.retry());
    await vi.waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.result?.sessionId).toBe("retry_ux");
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks(); sessionStorage.clear();
  });
  it("can display a ready result when session storage is full", async () => {
    sessionStorage.clear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    vi.spyOn(global, "fetch").mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ready", result: { ...mockScanResult, sessionId: "full_storage" } }) } as Response);
    const { result } = renderHook(() => useResultLoader({sessionId: "full_storage", isDemoSession: false, locale: "zh", initialResult: null, loadingMessage: "Loading", copy: mockCopy}));
    await vi.waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.result?.sessionId).toBe("full_storage");
    vi.restoreAllMocks(); sessionStorage.clear();
  });
});
