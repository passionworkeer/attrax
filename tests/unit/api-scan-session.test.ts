/**
 * Unit tests for GET /api/scan/[sessionId] route.
 * Tests specified scenarios per requirements.
 *
 * Run with: npm run test -- tests/unit/api-scan-session.test.ts
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
    scanTime: "2026-05-13T10:00:00.000Z",
    productCategory: "electronics",
    productName: "测试产品",
    targetMarkets: ["EU", "US"],
    complianceScore: 72,
    scoreGrade: "B",
    complianceReport: "## 合规报告\n测试报告内容",
    complianceStatus: "PASS",
    agentTrace: [
      { node: "vision", status: "PASS", duration_ms: 3200, score: 0.95 },
      { node: "retriever", status: "PASS", duration_ms: 1800, docs_retrieved: 10 },
      { node: "generator", status: "PASS", duration_ms: 2100, score: 0.88 },
    ],
    loopCount: 1,
    retrievedChunks: [
      { regId: "EU-CE-2014/35/EU", docName: "低压指令", articleNo: "Art. 4", region: "EU", score: 0.93 },
    ],
    documents: [],
    generatedAt: "2026-05-13T10:00:00.000Z",
    modelInfo: { ragProvider: "mimotalk", latencyMs: 7100 },
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
    generatedAt: "2026-05-13T10:00:00.000Z",
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
      generatedAt: "2026-05-13T10:00:00.000Z",
    },
  ]),
}));

// Helper to create a mock session with all required fields
function createMockSession(
  sessionId: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    sessionId,
    status: "processing",
    progress: 0,
    stageText: "准备中…",
    ...overrides,
  };
}

describe("GET /api/scan/[sessionId]", () => {
  beforeEach(() => {
    mockSessions.clear();
  });

  describe("Scenario 1: Normal sessionId returns current state", () => {
    it("returns complete session state with all fields", async () => {
      mockSessions.set("scan_normal123", {
        sessionId: "scan_normal123",
        status: "ready",
        progress: 100,
        stageText: "✅ 报告生成完成",
        result: {
          sessionId: "scan_normal123",
          scanTime: "2026-05-13T10:00:00.000Z",
          productCategory: "electronics",
          targetMarkets: ["EU", "US"],
          complianceScore: 85,
          scoreGrade: "B",
          complianceReport: "## 合规报告\n测试内容",
          complianceStatus: "PASS",
          agentTrace: [],
          loopCount: 2,
          retrievedChunks: [],
          documents: [],
          generatedAt: "2026-05-13T10:00:00.000Z",
          modelInfo: { ragProvider: "mimotalk", latencyMs: 5000 },
        },
        profitReport: {
          sessionId: "scan_normal123",
          productType: "测试产品",
          market: "EU",
          report: "## 利润报告",
          barebone: { bom: 10, packaging: 1, cert: 0.5, epr: 0.3, logistics: 5, asp: 25, gp: 8.2 },
          compliant: { bom: 15, packaging: 1.5, cert: 1, epr: 0.5, logistics: 5, asp: 45, gp: 22 },
          bareboneRiskExposure: 30,
          compliantRiskExposure: 0,
          keyConclusion: "合规模式净利润显著高于裸奔模式",
          generatedAt: "2026-05-13T10:00:00.000Z",
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_normal123");
      const ctx = { params: Promise.resolve({ sessionId: "scan_normal123" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);

      // Verify all required fields
      expect(body.sessionId).toBe("scan_normal123");
      expect(body.status).toBe("ready");
      expect(body.progress).toBe(100);
      expect(body.stageText).toBe("✅ 报告生成完成");

      // Verify result object
      expect(body.result).toBeDefined();
      expect(body.result.complianceScore).toBe(85);
      expect(body.result.complianceStatus).toBe("PASS");

      // Verify profitReport
      expect(body.profitReport).toBeDefined();
      expect(body.profitReport.keyConclusion).toBeDefined();
    });

    it("returns processing state with progress updates", async () => {
      mockSessions.set("scan_processing456", {
        sessionId: "scan_processing456",
        status: "processing",
        progress: 45,
        stageText: "🧠 规划检索策略…",
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_processing456");
      const ctx = { params: Promise.resolve({ sessionId: "scan_processing456" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("processing");
      expect(body.progress).toBe(45);
      expect(body.stageText).toBe("🧠 规划检索策略…");
    });

    it("returns session with WARN compliance status", async () => {
      mockSessions.set("scan_warn789", {
        sessionId: "scan_warn789",
        status: "ready",
        progress: 100,
        stageText: "⚠️ 合规警告，请查看报告",
        result: {
          sessionId: "scan_warn789",
          scanTime: "2026-05-13T10:00:00.000Z",
          productCategory: "toys",
          targetMarkets: ["EU", "US", "UK"],
          complianceScore: 55,
          scoreGrade: "C",
          complianceReport: "## 合规报告\n存在警告",
          complianceStatus: "WARN",
          agentTrace: [],
          loopCount: 1,
          retrievedChunks: [],
          documents: [],
          generatedAt: "2026-05-13T10:00:00.000Z",
          modelInfo: { ragProvider: "mimotalk", latencyMs: 6000 },
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_warn789");
      const ctx = { params: Promise.resolve({ sessionId: "scan_warn789" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.complianceScore).toBe(55);
      expect(body.result.complianceStatus).toBe("WARN");
      expect(body.stageText).toContain("警告");
    });
  });

  describe("Scenario 2: Not found sessionId returns 404", () => {
    it("returns 404 with NOT_FOUND error code", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_nonexistent");
      const ctx = { params: Promise.resolve({ sessionId: "scan_nonexistent" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(404);

      // Verify error structure
      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("code");
      expect(body.error.code).toBe("NOT_FOUND");

      expect(body.error).toHaveProperty("message");
      expect(body.error.message).toContain("未找到");
    });

    it("returns 404 for malformed sessionId", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/invalid-id");
      const ctx = { params: Promise.resolve({ sessionId: "invalid-id" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("does not return partial session data for not found", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_deleted");
      const ctx = { params: Promise.resolve({ sessionId: "scan_deleted" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.sessionId).toBeUndefined();
      expect(body.status).toBeUndefined();
      expect(body.result).toBeUndefined();
    });
  });

  describe("Demo session special case", () => {
    it("returns mock result for 'demo' sessionId", async () => {
      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/demo");
      const ctx = { params: Promise.resolve({ sessionId: "demo" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("demo");
      expect(body.status).toBe("ready");
      expect(body.progress).toBe(100);
      expect(body.stageText).toBe("完成");
      expect(body.result).toBeDefined();
      expect(body.result.complianceScore).toBe(72);
    });
  });

  describe("Additional edge cases", () => {
    it("handles session with error status", async () => {
      mockSessions.set("scan_failed", {
        sessionId: "scan_failed",
        status: "failed",
        progress: 50,
        stageText: "❌ 扫描失败",
        error: "RAG_SERVICE_UNAVAILABLE",
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_failed");
      const ctx = { params: Promise.resolve({ sessionId: "scan_failed" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("failed");
      expect(body.error).toBe("RAG_SERVICE_UNAVAILABLE");
    });

    it("returns session with empty documents array", async () => {
      mockSessions.set("scan_nodocs", {
        sessionId: "scan_nodocs",
        status: "ready",
        progress: 100,
        stageText: "✅ 完成",
        result: {
          sessionId: "scan_nodocs",
          scanTime: "2026-05-13T10:00:00.000Z",
          productCategory: "electronics",
          targetMarkets: ["EU"],
          complianceScore: 90,
          scoreGrade: "A",
          complianceReport: "## 合规报告\n完美通过",
          complianceStatus: "PASS",
          agentTrace: [],
          loopCount: 0,
          retrievedChunks: [],
          documents: [],
          generatedAt: "2026-05-13T10:00:00.000Z",
          modelInfo: { ragProvider: "mimotalk", latencyMs: 4000 },
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_nodocs");
      const ctx = { params: Promise.resolve({ sessionId: "scan_nodocs" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.documents).toEqual([]);
      expect(body.result.complianceScore).toBe(90);
    });
  });
});
