import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(() => null),
  getRoadmap: vi.fn(),
  getTrace: vi.fn(),
  getScan: vi.fn(),
}));

vi.mock("@/lib/pipeline/session-store", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return {
    ...actual,
    getRoadmap: mocks.getRoadmap,
    getTrace: mocks.getTrace,
    getScan: mocks.getScan,
  };
});

describe("real v1 resource BFF proxies", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getSession.mockReturnValue(null);
    mocks.getRoadmap.mockReset();
    mocks.getTrace.mockReset();
    mocks.getScan.mockReset();
  });

  it("forwards roadmap access with the browser bearer token", async () => {
    mocks.getRoadmap.mockResolvedValue({ totalDays: 12, items: [{ id: "step-1" }] });
    const { GET } = await import("@/app/api/roadmap/[sessionId]/route");

    const response = await GET(
      new Request("http://localhost/api/roadmap/scan_real1", {
        headers: { authorization: "Bearer token-1" },
      }),
      { params: Promise.resolve({ sessionId: "scan_real1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.getRoadmap).toHaveBeenCalledWith({
      sessionId: "scan_real1",
      accessToken: "token-1",
    });
    expect(await response.json()).toMatchObject({
      sessionId: "scan_real1",
      totalDays: 12,
      items: [{ id: "step-1" }],
    });
  });

  it("normalizes real trace nodes for the existing trace page", async () => {
    mocks.getTrace.mockResolvedValue([
      { node: "vision", status: "success", duration_ms: 1200, score: 0.9 },
    ]);
    mocks.getScan.mockResolvedValue({
      sessionId: "scan_real1",
      status: "ready",
      progress: 100,
      stageText: "complete",
      category: "electronics",
      markets: ["EU"],
      createdAt: "2026-07-17T00:00:00Z",
      updatedAt: "2026-07-17T00:01:00Z",
      result: { complianceStatus: "PASS", retrievedChunks: [] },
      error: null,
    });
    const { GET } = await import("@/app/api/trace/[sessionId]/route");

    const response = await GET(
      new Request("http://localhost/api/trace/scan_real1", {
        headers: { authorization: "Bearer token-1" },
      }),
      { params: Promise.resolve({ sessionId: "scan_real1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.score).toBe(90);
    expect(body.traceNodes[0]).toMatchObject({ id: "vision", status: "success" });
  });

  it("rejects a real resource request without a bearer token", async () => {
    const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/roadmap/scan_real1"),
      { params: Promise.resolve({ sessionId: "scan_real1" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.getRoadmap).not.toHaveBeenCalled();
  });
});
