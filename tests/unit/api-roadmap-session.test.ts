import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashAccessToken } from "@/lib/pipeline/session-auth";

const mockSessions = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/pipeline/session-store", () => ({
  getSession: vi.fn((id: string) => mockSessions.get(id) ?? undefined),
}));

vi.mock("@/lib/rag-client/v1-adapter", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag-client/v1-adapter")>(
    "@/lib/rag-client/v1-adapter",
  );
  return {
    ...actual,
    getRoadmap: vi.fn(),
  };
});

function session(result?: Record<string, unknown>) {
  return {
    sessionId: "scan_local",
    status: result ? "ready" : "processing",
    progress: result ? 100 : 50,
    stageText: result ? "complete" : "processing",
    result,
  };
}

function packagedResult(overrides: Record<string, unknown> = {}) {
  return {
    productName: "USB charger",
    productNameEn: "USB charger",
    targetMarkets: ["EU", "US"],
    complianceScore: 78,
    complianceStatus: "WARN",
    reportPackage: {
      roadmap: {
        totalDays: 31,
        progress: 25,
        totalCost: "EUR 12,000-18,000",
        items: [
          {
            id: "collect-docs",
            date: "2026-08-05",
            title: "收集资料",
            titleEn: "Collect documents",
            description: "准备真实技术文件",
            descriptionEn: "Prepare actual technical files",
            type: "apply",
            status: "in-progress",
            estimatedDays: 5,
            cost: "EUR 500",
            documents: ["BOM", "规格书"],
            documentsEn: ["BOM", "Specification"],
          },
        ],
      },
    },
    ...overrides,
  };
}

describe("GET /api/roadmap/[sessionId] truthful contract", () => {
  beforeEach(() => {
    mockSessions.clear();
  });

  it("returns 401 before probing an unknown real session", async () => {
    const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/roadmap/scan_missing"),
      { params: Promise.resolve({ sessionId: "scan_missing" }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("requires access for protected legacy sessions", async () => {
    mockSessions.set("scan_protected", {
      ...session(packagedResult()),
      sessionId: "scan_protected",
      accessTokenHash: hashAccessToken("secret"),
    });
    const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/roadmap/scan_protected"),
      { params: Promise.resolve({ sessionId: "scan_protected" }) },
    );

    expect(response.status).toBe(401);
  });

  it("returns 409 while the result is not ready", async () => {
    mockSessions.set("scan_processing", session());
    const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/roadmap/scan_processing"),
      { params: Promise.resolve({ sessionId: "scan_processing" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_READY" },
    });
  });

  it("returns 404 instead of inventing a roadmap from the compliance score", async () => {
    mockSessions.set(
      "scan_no_roadmap",
      session({
        productName: "Speaker",
        targetMarkets: ["EU"],
        complianceScore: 92,
        complianceStatus: "PASS",
      }),
    );
    const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/roadmap/scan_no_roadmap"),
      { params: Promise.resolve({ sessionId: "scan_no_roadmap" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("returns only backend-provided dates, costs, and steps", async () => {
    mockSessions.set("scan_packaged", session(packagedResult()));
    const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/roadmap/scan_packaged"),
      { params: Promise.resolve({ sessionId: "scan_packaged" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      product: "USB charger",
      markets: ["EU", "US"],
      complianceScore: 78,
      complianceStatus: "WARN",
      totalDays: 31,
      progress: 25,
      totalCost: "EUR 12,000-18,000",
    });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: "collect-docs",
      date: "2026-08-05",
      cost: "EUR 500",
      estimatedDays: 5,
      status: "in-progress",
    });
  });

  it("keeps unknown optional roadmap metrics null rather than estimating them", async () => {
    mockSessions.set(
      "scan_partial",
      session(
        packagedResult({
          complianceScore: undefined,
          reportPackage: {
            roadmap: {
              items: [{ id: "one", title: "核验资料", type: "apply" }],
            },
          },
        }),
      ),
    );
    const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
    const response = await GET(
      new Request("http://localhost/api/roadmap/scan_partial"),
      { params: Promise.resolve({ sessionId: "scan_partial" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.complianceScore).toBeNull();
    expect(body.totalDays).toBeNull();
    expect(body.progress).toBeNull();
    expect(body.totalCost).toBeNull();
  });
});
