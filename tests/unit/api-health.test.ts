/**
 * Tests for GET /api/health — frontend liveness + RAG service **readiness** probe.
 *
 * The route probes RAG `/ready` (not `/health`): a 200 with `{ready:true}` is the
 * only healthy state. `{ready:false}` (200 body but deps not loaded) and HTTP 503
 * (gate check failed) both surface as 503 here.
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
  it("returns 200 + rag ok when RAG /ready reports ready=true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ready: true, checks: { bm25: true }, version: "1" }),
    });
    const res = await callHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.frontend).toBe("ok");
    expect(body.ragService.status).toBe("ok");
    expect(body.ragService.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(body.ragService.error).toBeNull();
  });

  it("returns 503 + status=error when RAG /ready reports ready=false (deps not loaded)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ready: false, checks: { bm25: false } }),
    });
    const res = await callHealth();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ragService.status).toBe("error");
    expect(body.ragService.error).toContain("not ready");
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

  it("returns 503 + status=error when RAG /ready returns 503 (gate failed)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ ready: false, checks: {} }),
    });
    const res = await callHealth();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ragService.status).toBe("error");
    expect(body.ragService.error).toContain("HTTP 503");
  });

  it("returns 503 + status=error on any other non-ok HTTP", async () => {
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
      json: async () => ({ ready: true }),
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
      json: async () => ({ ready: true }),
    });
    const res = await callHealth();
    const body = await res.json();
    expect(body.demoMode).toBe(true);
  });

  it("reports demoMode=false by default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ready: true }),
    });
    const res = await callHealth();
    const body = await res.json();
    expect(body.demoMode).toBe(false);
  });

  it("probes the RAG /ready endpoint (not /health)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ready: true }),
    });
    await callHealth();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://rag.test:9999/ready",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
