/**
 * Additional unit tests for GET /api/scan/[sessionId] to ensure full coverage.
 * Tests edge cases and error scenarios.
 *
 * Run with: npm run test -- tests/unit/api-scan-session-full.test.ts
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
    complianceScore: 85,
    scoreGrade: "B",
    complianceReport: "## 合规报告\n测试内容",
    complianceStatus: "PASS",
    agentTrace: [
      { node: "vision", status: "PASS", duration_ms: 3200, score: 0.95 },
      { node: "retriever", status: "PASS", duration_ms: 1800, docs_retrieved: 10 },
      { node: "generate", status: "PASS", duration_ms: 2100, score: 0.88 },
    ],
    loopCount: 1,
    retrievedChunks: [
      { regId: "EU-CE-2014/35/EU", docName: "低压指令", articleNo: "Art. 4", region: "EU", score: 0.93 },
    ],
    documents: [],
    generatedAt: "2026-05-13T10:00:00.000Z",
    modelInfo: { ragProvider: "mimotalk", latencyMs: 7100 },
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

describe("GET /api/scan/[sessionId] - Extended Coverage", () => {
  beforeEach(() => {
    mockSessions.clear();
  });

  describe("Session status variations", () => {
    it("handles session with pending status", async () => {
      mockSessions.set("scan_pending", {
        sessionId: "scan_pending",
        status: "pending",
        progress: 0,
        stageText: "等待中...",
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_pending");
      const ctx = { params: Promise.resolve({ sessionId: "scan_pending" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("pending");
      expect(body.progress).toBe(0);
    });

    it("handles session with all score grades", async () => {
      const grades = ["A", "B", "C", "D", "F"];

      for (const grade of grades) {
        mockSessions.clear();
        mockSessions.set(`scan_grade_${grade}`, {
          sessionId: `scan_grade_${grade}`,
          status: "ready",
          progress: 100,
          stageText: "完成",
          result: {
            sessionId: `scan_grade_${grade}`,
            complianceScore: grade === "A" ? 95 : grade === "B" ? 85 : grade === "C" ? 65 : grade === "D" ? 45 : 25,
            scoreGrade: grade,
            complianceStatus: grade === "A" ? "PASS" : grade === "B" ? "PASS" : "WARN",
            agentTrace: [],
            retrievedChunks: [],
          },
        });

        const { GET } = await import("@/app/api/scan/[sessionId]/route");
        const req = new Request(`http://localhost/api/scan/scan_grade_${grade}`);
        const ctx = { params: Promise.resolve({ sessionId: `scan_grade_${grade}` }) };

        const res = await GET(req, ctx);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.result.scoreGrade).toBe(grade);
      }
    });
  });

  describe("Result structure variations", () => {
    it("handles result with all compliance statuses", async () => {
      const statuses = ["PASS", "WARN", "FAIL", "UNKNOWN"];

      for (const status of statuses) {
        mockSessions.clear();
        mockSessions.set(`scan_status_${status}`, {
          sessionId: `scan_status_${status}`,
          status: "ready",
          progress: 100,
          stageText: status === "PASS" ? "通过" : status === "WARN" ? "警告" : "未通过",
          result: {
            sessionId: `scan_status_${status}`,
            complianceScore: status === "PASS" ? 90 : status === "WARN" ? 60 : status === "FAIL" ? 30 : 50,
            scoreGrade: "B",
            complianceStatus: status,
            agentTrace: [],
            retrievedChunks: [],
          },
        });

        const { GET } = await import("@/app/api/scan/[sessionId]/route");
        const req = new Request(`http://localhost/api/scan/scan_status_${status}`);
        const ctx = { params: Promise.resolve({ sessionId: `scan_status_${status}` }) };

        const res = await GET(req, ctx);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.result.complianceStatus).toBe(status);
      }
    });

    it("handles result with agentTrace containing various nodes", async () => {
      mockSessions.set("scan_all_nodes", {
        sessionId: "scan_all_nodes",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_all_nodes",
          complianceScore: 85,
          scoreGrade: "B",
          complianceStatus: "PASS",
          agentTrace: [
            { node: "vision", status: "PASS", duration_ms: 1000, score: 0.9 },
            { node: "query_planner", status: "PASS", duration_ms: 500 },
            { node: "retriever", status: "PASS", duration_ms: 2000, docs_retrieved: 15 },
            { node: "synthesis", status: "PASS", duration_ms: 1500 },
            { node: "generate", status: "PASS", duration_ms: 3000, score: 0.85 },
            { node: "verify", status: "PASS", duration_ms: 1000, score: 0.95 },
            { node: "refine", status: "PASS", duration_ms: 800 },
            { node: "fan_out", status: "PASS", duration_ms: 500 },
          ],
          retrievedChunks: [],
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_all_nodes");
      const ctx = { params: Promise.resolve({ sessionId: "scan_all_nodes" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.agentTrace).toHaveLength(8);
    });

    it("handles result with detailed retrievedChunks", async () => {
      mockSessions.set("scan_chunks", {
        sessionId: "scan_chunks",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_chunks",
          complianceScore: 85,
          scoreGrade: "B",
          complianceStatus: "PASS",
          agentTrace: [],
          retrievedChunks: [
            { regId: "EU-CE-LVD", docName: "低压指令", articleNo: "Art. 4", region: "EU", score: 0.95 },
            { regId: "EU-CE-EMC", docName: "电磁兼容指令", articleNo: "Art. 2", region: "EU", score: 0.92 },
            { regId: "EU-REACH", docName: "REACH 法规", articleNo: "Art. 33", region: "EU", score: 0.88 },
            { regId: "US-FCC", docName: "FCC 认证", articleNo: "Part 15", region: "US", score: 0.90 },
            { regId: "US-UL", docName: "UL 安全标准", articleNo: "UL 60950", region: "US", score: 0.85 },
          ],
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_chunks");
      const ctx = { params: Promise.resolve({ sessionId: "scan_chunks" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.retrievedChunks).toHaveLength(5);
      expect(body.result.retrievedChunks[0]).toHaveProperty("regId");
      expect(body.result.retrievedChunks[0]).toHaveProperty("docName");
      expect(body.result.retrievedChunks[0]).toHaveProperty("articleNo");
      expect(body.result.retrievedChunks[0]).toHaveProperty("region");
      expect(body.result.retrievedChunks[0]).toHaveProperty("score");
    });
  });

  describe("Profit report handling", () => {
    it("returns session with profitReport when available", async () => {
      mockSessions.set("scan_with_profit", {
        sessionId: "scan_with_profit",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_with_profit",
          complianceScore: 85,
          scoreGrade: "B",
          complianceStatus: "PASS",
          agentTrace: [],
          retrievedChunks: [],
        },
        profitReport: {
          sessionId: "scan_with_profit",
          productType: "蓝牙耳机",
          market: "EU",
          report: "## 利润分析报告",
          barebone: { bom: 10, packaging: 1, cert: 0.5, epr: 0.3, logistics: 5, asp: 25, gp: 8.2 },
          compliant: { bom: 15, packaging: 1.5, cert: 1, epr: 0.5, logistics: 5, asp: 45, gp: 22 },
          bareboneRiskExposure: 30,
          compliantRiskExposure: 0,
          keyConclusion: "合规模式净利润更高",
          generatedAt: "2026-05-13T10:00:00.000Z",
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_with_profit");
      const ctx = { params: Promise.resolve({ sessionId: "scan_with_profit" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.profitReport).toBeDefined();
      expect(body.profitReport.productType).toBe("蓝牙耳机");
      expect(body.profitReport.keyConclusion).toBe("合规模式净利润更高");
    });

    it("returns session without profitReport when not available", async () => {
      mockSessions.set("scan_no_profit", {
        sessionId: "scan_no_profit",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_no_profit",
          complianceScore: 85,
          scoreGrade: "B",
          complianceStatus: "PASS",
          agentTrace: [],
          retrievedChunks: [],
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_no_profit");
      const ctx = { params: Promise.resolve({ sessionId: "scan_no_profit" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.profitReport).toBeUndefined();
    });
  });

  describe("Error field handling", () => {
    it("returns error field when present", async () => {
      mockSessions.set("scan_with_error", {
        sessionId: "scan_with_error",
        status: "failed",
        progress: 30,
        stageText: "处理失败",
        error: "IMAGE_PROCESSING_FAILED",
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_with_error");
      const ctx = { params: Promise.resolve({ sessionId: "scan_with_error" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.error).toBe("IMAGE_PROCESSING_FAILED");
    });

    it("handles various error codes", async () => {
      const errorCodes = [
        "RAG_SERVICE_UNAVAILABLE",
        "IMAGE_PROCESSING_FAILED",
        "TIMEOUT",
        "INVALID_IMAGE_FORMAT",
        "DOCUMENT_PARSING_FAILED",
      ];

      for (const errorCode of errorCodes) {
        mockSessions.clear();
        mockSessions.set(`scan_err_${errorCode}`, {
          sessionId: `scan_err_${errorCode}`,
          status: "failed",
          error: errorCode,
        });

        const { GET } = await import("@/app/api/scan/[sessionId]/route");
        const req = new Request(`http://localhost/api/scan/scan_err_${errorCode}`);
        const ctx = { params: Promise.resolve({ sessionId: `scan_err_${errorCode}` }) };

        const res = await GET(req, ctx);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.error).toBe(errorCode);
      }
    });
  });

  describe("Demo session edge cases", () => {
    it("handles demo session correctly", async () => {
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
      expect(body.result.complianceScore).toBeDefined();
    });

    it("demo session takes precedence over store lookup", async () => {
      // Even if there's a real session with id "demo", demo mode should return mock result
      mockSessions.set("demo", {
        sessionId: "demo",
        status: "processing",
        progress: 50,
        stageText: "处理中",
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/demo");
      const ctx = { params: Promise.resolve({ sessionId: "demo" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      // Should return demo mock, not the processing session
      expect(body.status).toBe("ready");
      expect(body.progress).toBe(100);
    });
  });

  describe("Session with model info", () => {
    it("includes model info in result", async () => {
      mockSessions.set("scan_model_info", {
        sessionId: "scan_model_info",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_model_info",
          complianceScore: 88,
          scoreGrade: "B",
          complianceStatus: "PASS",
          agentTrace: [],
          retrievedChunks: [],
          modelInfo: {
            ragProvider: "mimotalk",
            latencyMs: 8500,
            modelName: "mimo-v2.5",
          },
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_model_info");
      const ctx = { params: Promise.resolve({ sessionId: "scan_model_info" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.modelInfo).toBeDefined();
      expect(body.result.modelInfo.ragProvider).toBe("mimotalk");
      expect(body.result.modelInfo.latencyMs).toBe(8500);
    });
  });

  describe("Market variations", () => {
    it("handles single market", async () => {
      mockSessions.set("scan_single_market", {
        sessionId: "scan_single_market",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_single_market",
          complianceScore: 90,
          scoreGrade: "A",
          complianceStatus: "PASS",
          targetMarkets: ["JP"],
          agentTrace: [],
          retrievedChunks: [],
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_single_market");
      const ctx = { params: Promise.resolve({ sessionId: "scan_single_market" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.targetMarkets).toEqual(["JP"]);
    });

    it("handles multiple markets", async () => {
      mockSessions.set("scan_multi_market", {
        sessionId: "scan_multi_market",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_multi_market",
          complianceScore: 75,
          scoreGrade: "C",
          complianceStatus: "WARN",
          targetMarkets: ["EU", "US", "UK", "CN", "AU"],
          agentTrace: [],
          retrievedChunks: [],
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_multi_market");
      const ctx = { params: Promise.resolve({ sessionId: "scan_multi_market" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.targetMarkets).toHaveLength(5);
    });
  });

  describe("Product category variations", () => {
    it("handles all product categories", async () => {
      const categories = ["electronics", "appliance", "3c", "toy", "home", "other"];

      for (const category of categories) {
        mockSessions.clear();
        mockSessions.set(`scan_cat_${category}`, {
          sessionId: `scan_cat_${category}`,
          status: "ready",
          progress: 100,
          stageText: "完成",
          result: {
            sessionId: `scan_cat_${category}`,
            productCategory: category,
            complianceScore: 85,
            scoreGrade: "B",
            complianceStatus: "PASS",
            agentTrace: [],
            retrievedChunks: [],
          },
        });

        const { GET } = await import("@/app/api/scan/[sessionId]/route");
        const req = new Request(`http://localhost/api/scan/scan_cat_${category}`);
        const ctx = { params: Promise.resolve({ sessionId: `scan_cat_${category}` }) };

        const res = await GET(req, ctx);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.result.productCategory).toBe(category);
      }
    });
  });

  describe("Loop count variations", () => {
    it("handles zero loops", async () => {
      mockSessions.set("scan_zero_loops", {
        sessionId: "scan_zero_loops",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_zero_loops",
          complianceScore: 95,
          scoreGrade: "A",
          complianceStatus: "PASS",
          loopCount: 0,
          agentTrace: [
            { node: "vision", status: "PASS", duration_ms: 1000 },
            { node: "retriever", status: "PASS", duration_ms: 2000 },
            { node: "generate", status: "PASS", duration_ms: 1500 },
          ],
          retrievedChunks: [],
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_zero_loops");
      const ctx = { params: Promise.resolve({ sessionId: "scan_zero_loops" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.loopCount).toBe(0);
    });

    it("handles multiple loops", async () => {
      mockSessions.set("scan_multi_loops", {
        sessionId: "scan_multi_loops",
        status: "ready",
        progress: 100,
        stageText: "完成",
        result: {
          sessionId: "scan_multi_loops",
          complianceScore: 70,
          scoreGrade: "C",
          complianceStatus: "WARN",
          loopCount: 5,
          agentTrace: [],
          retrievedChunks: [],
        },
      });

      const { GET } = await import("@/app/api/scan/[sessionId]/route");
      const req = new Request("http://localhost/api/scan/scan_multi_loops");
      const ctx = { params: Promise.resolve({ sessionId: "scan_multi_loops" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.result.loopCount).toBe(5);
    });
  });
});
