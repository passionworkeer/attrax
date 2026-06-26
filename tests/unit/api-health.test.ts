/**
 * Tests for GET /api/health — frontend liveness + RAG service readiness probe.
 * Pattern follows tests/unit/api-scan-session-full.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  process.env.RAG_SERVICE_URL = "http://rag.test:9999";
  // Reset module cache so the route re-reads process.env
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RAG_SERVICE_URL;
  delete process.env.DEMO_MODE;
});

async function callHealth() {
  const mod = await import("@/app/api/health/route");
  return mod.GET();
}

describe("GET /api/health", () => {
  it("returns 200 + frontend ok + rag ok when RAG responds with status=ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ok", faiss_index: "loaded" }),
    });
    const res = await callHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.frontend).toBe("ok");
    expect(body.ragService.status).toBe("ok");
    expect(body.ragService.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(body.ragService.error).toBeNull();
  });

  it("returns 200 when RAG reports DEMO status (acceptable degraded state)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "DEMO", faiss_index: "missing" }),
    });
    const res = await callHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ragService.status).toBe("DEMO");
  });

  it("returns 503 + status=unreachable when RAG fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await callHealth();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.frontend).toBe("ok"); // frontend itself is alive
    expect(body.ragService.status).toBe("unreachable");
    expect(body.ragService.error).toContain("ECONNREFUSED");
  });

  it("returns 503 + status=error when RAG returns non-ok HTTP", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const res = await callHealth();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ragService.status).toBe("error");
    expect(body.ragService.error).toContain("HTTP 500");
  });

  it("returns 503 with error=timeout when AbortError fires", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    mockFetch.mockRejectedValueOnce(abortErr);
    const res = await callHealth();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ragService.status).toBe("unreachable");
    expect(body.ragService.error).toBe("timeout");
  });

  it("includes the current timestamp in the response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ok", faiss_index: "loaded" }),
    });
    const res = await callHealth();
    const body = await res.json();
    expect(typeof body.timestamp).toBe("string");
    // ISO 8601 with milliseconds
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("reports demoMode=true when DEMO_MODE env is set", async () => {
    process.env.DEMO_MODE = "true";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ok", faiss_index: "loaded" }),
    });
    const res = await callHealth();
    const body = await res.json();
    expect(body.demoMode).toBe(true);
  });

  it("reports demoMode=false by default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ok", faiss_index: "loaded" }),
    });
    const res = await callHealth();
    const body = await res.json();
    expect(body.demoMode).toBe(false);
  });

  it("uses the configured RAG_SERVICE_URL env var", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "ok", faiss_index: "loaded" }),
    });
    await callHealth();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://rag.test:9999/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});