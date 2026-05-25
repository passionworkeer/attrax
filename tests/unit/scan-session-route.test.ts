/**
 * Unit tests for the Next.js /api/scan/[sessionId] route (GET).
 * Run with: npx vitest run tests/unit/scan-session-route.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the session store before importing
const mockSessions = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/pipeline/session-store", () => ({
  getSession: vi.fn((id: string) => mockSessions.get(id) ?? undefined),
}));

vi.mock("@/lib/mock/scan-result", () => ({
  createMockScanResult: vi.fn((id: string) => ({
    sessionId: id,
    scanTime: "2026-04-27T10:00:00.000Z",
    productCategory: "electronics",
    targetMarkets: ["EU", "US"],
    complianceScore: 72,
    scoreGrade: "B",
    complianceReport: "## 合规报告\n测试报告内容",
    complianceStatus: "PASS",
    agentTrace: [{ node: "retrieve", docs_retrieved: 10 }],
    loopCount: 0,
    retrievedChunks: [],
    documents: [],
    generatedAt: "2026-04-27T10:00:00.000Z",
    modelInfo: { ragProvider: "mimotalk", latencyMs: 500 },
  })),
  createMockComplianceReportResult: vi.fn((id: string) => ({
    sessionId: id,
    complianceScore: 72,
    scoreGrade: "B",
    complianceReport: "## 鍚堣鎶ュ憡\n娴嬭瘯鎶ュ憡鍐呭",
    complianceStatus: "PASS",
    agentTrace: [],
    retrievedChunks: [],
    targetMarkets: ["EU", "US"],
  })),
  createMockProfitReport: vi.fn((id: string) => ({
    sessionId: id,
    productType: "测试产品",
    market: "EU",
    report: "## 利润报告",
    barebone: { bom: 10, packaging: 1, cert: 0.5, epr: 0.3, logistics: 5, asp: 25, gp: 8.2 },
    compliant: { bom: 15, packaging: 1.5, cert: 1, epr: 0.5, logistics: 5, asp: 45, gp: 22 },
    bareboneRiskExposure: 30,
    compliantRiskExposure: 0,
    keyConclusion: "合规模式净利润显著高于裸奔模式",
    generatedAt: "2026-04-27T10:00:00.000Z",
  })),
  createMockProfitReports: vi.fn((id: string) => [
    {
      sessionId: id,
      productType: "测试产品",
      market: "EU",
      report: "## 利润报告",
      barebone: { bom: 10, packaging: 1, cert: 0.5, epr: 0.3, logistics: 5, asp: 25, gp: 8.2 },
      compliant: { bom: 15, packaging: 1.5, cert: 1, epr: 0.5, logistics: 5, asp: 45, gp: 22 },
      bareboneRiskExposure: 30,
      compliantRiskExposure: 0,
      keyConclusion: "合规模式净利润显著高于裸奔模式",
      generatedAt: "2026-04-27T10:00:00.000Z",
    },
  ]),
}));

describe("GET /api/scan/[sessionId]", () => {
  beforeEach(() => {
    mockSessions.clear();
  });

  describe("demo session", () => {
    it("returns mock result for demo sessionId", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/demo");
      const ctx = { params: Promise.resolve({ sessionId: "demo" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("demo");
      expect(body.status).toBe("ready");
      expect(body.result).toBeDefined();
      expect(body.result.complianceScore).toBe(72);
    });
  });

  describe("real session", () => {
    it("returns session data when found", async () => {
      mockSessions.set("scan_real123", {
        sessionId: "scan_real123",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_real123",
          scanTime: "2026-04-27T10:00:00.000Z",
          productCategory: "electronics",
          targetMarkets: ["EU"],
          complianceScore: 55,
          scoreGrade: "C",
          complianceReport: "## 合规要求",
          complianceStatus: "WARN",
          agentTrace: [],
          loopCount: 2,
          retrievedChunks: [],
          documents: [],
          generatedAt: "2026-04-27T10:00:00.000Z",
          modelInfo: { ragProvider: "mimotalk", latencyMs: 8000 },
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_real123");
      const ctx = { params: Promise.resolve({ sessionId: "scan_real123" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("scan_real123");
      expect(body.status).toBe("ready");
      expect(body.progress).toBe(100);
      expect(body.result.complianceStatus).toBe("WARN");
      expect(body.result.complianceScore).toBe(55);
    });

    it("returns processing state correctly", async () => {
      mockSessions.set("scan_processing", {
        sessionId: "scan_processing",
        status: "processing",
        progress: 45,
        stageText: "匹配法规库...",
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_processing");
      const ctx = { params: Promise.resolve({ sessionId: "scan_processing" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("processing");
      expect(body.progress).toBe(45);
      expect(body.stageText).toBe("匹配法规库...");
    });

    it("returns 404 when session not found", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_nonexistent");
      const ctx = { params: Promise.resolve({ sessionId: "scan_nonexistent" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toContain("未找到");
    });
  });
});
