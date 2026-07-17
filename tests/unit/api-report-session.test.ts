import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetScan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return { ...actual, getScan: mockGetScan };
});

describe("GET /api/report/[sessionId]/[reportType]", () => {
  beforeEach(() => mockGetScan.mockReset());

  it("builds a text report from the authenticated backend result", async () => {
    mockGetScan.mockResolvedValue({
      sessionId: "scan_real1",
      status: "ready",
      progress: 100,
      stageText: "complete",
      category: "electronics",
      markets: ["EU"],
      createdAt: "2026-07-17T00:00:00Z",
      updatedAt: "2026-07-17T00:01:00Z",
      result: {
        productName: "USB charger",
        productCategory: "electronics",
        targetMarkets: ["EU"],
        complianceStatus: "WARN",
        retrievedChunks: [],
        reportPackage: {
          decisionView: {
            nodes: [{ id: "risk-1", label: "Missing label", reasoning: "Input spec absent", status: "warning" }],
          },
          roadmap: { items: [] },
        },
      },
      error: null,
    });
    const { GET } = await import("@/app/api/report/[sessionId]/[reportType]/route");

    const response = await GET(
      new Request("http://localhost/api/report/scan_real1/compliance?format=md&lang=en", {
        headers: { authorization: "Bearer token-1" },
      }),
      { params: Promise.resolve({ sessionId: "scan_real1", reportType: "compliance" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(await response.text()).toContain("USB charger");
    expect(mockGetScan).toHaveBeenCalledWith({ sessionId: "scan_real1", accessToken: "token-1" });
  });

  it("requires a bearer token for non-demo reports", async () => {
    const { GET } = await import("@/app/api/report/[sessionId]/[reportType]/route");
    const response = await GET(
      new Request("http://localhost/api/report/scan_real1/compliance?format=md"),
      { params: Promise.resolve({ sessionId: "scan_real1", reportType: "compliance" }) },
    );

    expect(response.status).toBe(401);
    expect(mockGetScan).not.toHaveBeenCalled();
  });
});
