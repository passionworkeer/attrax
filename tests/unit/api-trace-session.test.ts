/**
 * Unit tests for GET /api/trace/[sessionId] route.
 * Tests execution trace and agent flow visualization.
 *
 * Run with: npm run test -- tests/unit/api-trace-session.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashAccessToken } from "@/lib/pipeline/session-auth";

// Mock the session store before importing
const mockSessions = new Map<string, Record<string, unknown>>();

vi.mock("@/lib/pipeline/session-store", () => ({
  getSession: vi.fn((id: string) => mockSessions.get(id) ?? undefined),
}));

// Helper to create a mock session with result
function createSessionWithResult(
  sessionId: string,
  result: Record<string, unknown>
): Record<string, unknown> {
  return {
    sessionId,
    status: "ready",
    progress: 100,
    stageText: "完成",
    result,
  };
}

describe("GET /api/trace/[sessionId]", () => {
  beforeEach(() => {
    mockSessions.clear();
  });

  describe("Scenario 1: Session not found", () => {
    it("returns 401 before probing an unknown real session", async () => {
      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_nonexistent");
      const ctx = { params: Promise.resolve({ sessionId: "scan_nonexistent" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("access token");
    });
  });

  describe("Scenario 2: Session found but no result", () => {
    it("returns 401 when a protected session is requested without its access token", async () => {
      mockSessions.set("scan_protected", {
        sessionId: "scan_protected",
        status: "ready",
        progress: 100,
        stageText: "complete",
        accessTokenHash: hashAccessToken("secret-token"),
        result: { agentTrace: [] },
      });

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_protected");
      const ctx = { params: Promise.resolve({ sessionId: "scan_protected" }) };

      const res = await GET(req, ctx);

      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: "UNAUTHORIZED" },
      });
    });

    it("returns 404 with NOT_READY error code when result is missing", async () => {
      mockSessions.set("scan_processing", {
        sessionId: "scan_processing",
        status: "processing",
        progress: 50,
        stageText: "匹配法规库中...",
        // No result yet
      });

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_processing");
      const ctx = { params: Promise.resolve({ sessionId: "scan_processing" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("NOT_READY");
    });
  });

  describe("Scenario 3: Normal session with complete result", () => {
    it("returns trace data with all agent nodes", async () => {
      const fullResult = {
        sessionId: "scan_trace123",
        complianceScore: 85,
        scoreGrade: "B",
        complianceStatus: "PASS",
        targetMarkets: ["EU", "US"],
        agentTrace: [
          { node: "vision", status: "PASS", duration_ms: 3200, score: 0.95 },
          { node: "query_planner", status: "PASS", duration_ms: 500, score: 0.90 },
          { node: "retriever", status: "PASS", duration_ms: 1800, docs_retrieved: 10 },
          { node: "synthesis", status: "PASS", duration_ms: 1500, score: 0.88 },
          { node: "generate", status: "PASS", duration_ms: 2100, score: 0.85 },
        ],
        retrievedChunks: [
          { regId: "EU-CE-2014/35/EU", docName: "低压指令", articleNo: "Art. 4", region: "EU", score: 0.93 },
          { regId: "EU-REACH", docName: "REACH 法规", articleNo: "Art. 33", region: "EU", score: 0.89 },
        ],
      };

      mockSessions.set("scan_trace123", createSessionWithResult("scan_trace123", fullResult));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_trace123");
      const ctx = { params: Promise.resolve({ sessionId: "scan_trace123" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("scan_trace123");

      // Verify trace statistics
      expect(body.totalTime).toBeDefined();
      expect(body.steps).toBe(5);
      expect(body.markets).toBeDefined();
      expect(body.regulations).toBeDefined();

      // Verify trace nodes
      expect(body.traceNodes).toBeDefined();
      expect(body.traceNodes).toHaveLength(5);
      expect(body.traceNodes[0]).toHaveProperty("id");
      expect(body.traceNodes[0]).toHaveProperty("type");
      expect(body.traceNodes[0]).toHaveProperty("label");
      expect(body.traceNodes[0]).toHaveProperty("status");
      expect(body.traceNodes[0]).toHaveProperty("duration");

      // Verify retrieved chunks
      expect(body.retrievedChunks).toBeDefined();
      expect(body.retrievedChunks).toHaveLength(2);
    });

    it("calculates total time correctly from duration_ms", async () => {
      const result = {
        sessionId: "scan_timecalc",
        agentTrace: [
          { node: "vision", duration_ms: 3200 },
          { node: "retriever", duration_ms: 1800 },
          { node: "generate", duration_ms: 2100 },
        ],
        retrievedChunks: [],
      };

      mockSessions.set("scan_timecalc", createSessionWithResult("scan_timecalc", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_timecalc");
      const ctx = { params: Promise.resolve({ sessionId: "scan_timecalc" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      // (3200 + 1800 + 2100) / 1000 = 7.1
      expect(body.totalTime).toBe("7.1");
      expect(body.steps).toBe(3);
    });

    it("handles duration in milliseconds format", async () => {
      const result = {
        sessionId: "scan_dur_ms",
        agentTrace: [
          { node: "vision", duration_ms: 3000 }, // in milliseconds
          { node: "retriever", duration_ms: 2000 },
        ],
        retrievedChunks: [],
      };

      mockSessions.set("scan_dur_ms", createSessionWithResult("scan_dur_ms", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_dur_ms");
      const ctx = { params: Promise.resolve({ sessionId: "scan_dur_ms" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      // (3000 + 2000) / 1000 = 5.0 seconds
      expect(body.totalTime).toBe("5.0");
    });

    it("derives markets from retrievedChunks when targetMarkets is empty", async () => {
      const result = {
        sessionId: "scan_markets",
        agentTrace: [],
        retrievedChunks: [
          { region: "EU", docName: "CE指令" },
          { region: "US", docName: "FCC法规" },
          { region: "CN", docName: "CCC标准" },
        ],
      };

      mockSessions.set("scan_markets", createSessionWithResult("scan_markets", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_markets");
      const ctx = { params: Promise.resolve({ sessionId: "scan_markets" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.markets).toBe(3);
      expect(body.regulations).toBe(3);
    });

    it("uses targetMarkets when retrievedChunks is empty", async () => {
      const result = {
        sessionId: "scan_target_mkts",
        targetMarkets: ["EU", "US", "UK"],
        agentTrace: [],
        retrievedChunks: [],
      };

      mockSessions.set("scan_target_mkts", createSessionWithResult("scan_target_mkts", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_target_mkts");
      const ctx = { params: Promise.resolve({ sessionId: "scan_target_mkts" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.markets).toBe(3);
    });

    it("uses default score and grade when not present", async () => {
      const result = {
        sessionId: "scan_defaults",
        agentTrace: [],
        retrievedChunks: [],
        // No complianceScore or scoreGrade
      };

      mockSessions.set("scan_defaults", createSessionWithResult("scan_defaults", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_defaults");
      const ctx = { params: Promise.resolve({ sessionId: "scan_defaults" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.score).toBe(85);
      expect(body.grade).toBe("B");
    });
  });

  describe("Edge cases", () => {
    it("handles empty agentTrace array", async () => {
      const result = {
        sessionId: "scan_empty_trace",
        agentTrace: [],
        retrievedChunks: [],
      };

      mockSessions.set("scan_empty_trace", createSessionWithResult("scan_empty_trace", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_empty_trace");
      const ctx = { params: Promise.resolve({ sessionId: "scan_empty_trace" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.totalTime).toBe("0.0");
      expect(body.steps).toBe(0);
      expect(body.traceNodes).toEqual([]);
    });

    it("handles nodes with unknown labels", async () => {
      const result = {
        sessionId: "scan_unknown_node",
        agentTrace: [
          { node: "vision", status: "PASS", duration_ms: 1000 },
          { node: "unknown_custom_node", status: "PASS", duration_ms: 500 },
        ],
        retrievedChunks: [],
      };

      mockSessions.set("scan_unknown_node", createSessionWithResult("scan_unknown_node", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_unknown_node");
      const ctx = { params: Promise.resolve({ sessionId: "scan_unknown_node" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.traceNodes[0].label).toBe("视觉识别");
      expect(body.traceNodes[0].labelEn).toBe("Vision Analysis");
      expect(body.traceNodes[1].label).toBe("unknown_custom_node"); // Falls back to node name
      expect(body.traceNodes[1].labelEn).toBe("unknown_custom_node");
    });

    it("handles trace entries with missing optional fields", async () => {
      const result = {
        sessionId: "scan_partial",
        agentTrace: [
          { node: "vision" }, // Minimal entry
        ],
        retrievedChunks: [],
      };

      mockSessions.set("scan_partial", createSessionWithResult("scan_partial", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_partial");
      const ctx = { params: Promise.resolve({ sessionId: "scan_partial" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.traceNodes[0].status).toBe("pending");
      expect(body.traceNodes[0].duration).toBe("0s");
      expect(body.traceNodes[0].confidence).toBe(0);
    });

    it("handles missing agentTrace property (undefined)", async () => {
      const result = {
        sessionId: "scan_no_trace",
        // No agentTrace property at all
        retrievedChunks: [],
      };

      mockSessions.set("scan_no_trace", createSessionWithResult("scan_no_trace", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_no_trace");
      const ctx = { params: Promise.resolve({ sessionId: "scan_no_trace" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.totalTime).toBe("0.0");
      expect(body.steps).toBe(0);
      expect(body.traceNodes).toEqual([]);
    });

    it("extracts market info from retrievedChunks", async () => {
      const result = {
        sessionId: "scan_market_extract",
        agentTrace: [],
        retrievedChunks: [
          { region: "EU", docName: "CE指令" },
          { region: "US", docName: "FCC" },
        ],
        // No targetMarkets
      };

      mockSessions.set("scan_market_extract", createSessionWithResult("scan_market_extract", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_market_extract");
      const ctx = { params: Promise.resolve({ sessionId: "scan_market_extract" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.markets).toBe(2);
      expect(body.regulations).toBe(2);
    });

    it("handles missing retrievedChunks property", async () => {
      const result = {
        sessionId: "scan_no_chunks",
        agentTrace: [],
        // No retrievedChunks property - defaults to 6 regulations
      };

      mockSessions.set("scan_no_chunks", createSessionWithResult("scan_no_chunks", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_no_chunks");
      const ctx = { params: Promise.resolve({ sessionId: "scan_no_chunks" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      // When retrievedChunks is missing, it defaults to 6
      expect(body.regulations).toBe(6);
    });

    it("uses snake_case report_package decision_view before raw trace fallback", async () => {
      const result = {
        sessionId: "scan_snake_package_trace",
        complianceScore: 77,
        scoreGrade: "C",
        targetMarkets: ["EU"],
        agentTrace: [
          { node: "retriever", status: "PASS", duration_ms: 5000 },
        ],
        retrievedChunks: [],
        report_package: {
          decision_view: {
            summary: "Packaged decision view",
            recommended_action: "Proceed with fixes",
            nodes: [{
              id: "pkg-node",
              type: "generate",
              label: "四场景生成",
              label_en: "Four-scene generation",
              status: "success",
              duration: "1.4s",
              confidence: 0.91,
            }],
          },
        },
      };

      mockSessions.set("scan_snake_package_trace", createSessionWithResult("scan_snake_package_trace", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_snake_package_trace");
      const ctx = { params: Promise.resolve({ sessionId: "scan_snake_package_trace" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.totalTime).toBe("5.0");
      expect(body.decisionView.summary).toBe("Packaged decision view");
      expect(body.traceNodes).toHaveLength(1);
      expect(body.traceNodes[0].id).toBe("pkg-node");
      expect(body.traceNodes[0].label).toBe("四场景生成");
    });
    it("falls back to node type when packaged English labels are missing or Chinese", async () => {
      const result = {
        sessionId: "scan_decision_label_fallback",
        agentTrace: [],
        retrievedChunks: [],
        reportPackage: {
          decisionView: {
            nodes: [
              { type: "verify", label: "验证节点", reasoning: "中文推理" },
              { id: "missing-label" },
            ],
          },
        },
      };

      mockSessions.set("scan_decision_label_fallback", createSessionWithResult("scan_decision_label_fallback", result));

      const { GET } = await import("@/app/api/trace/[sessionId]/route");
      const req = new Request("http://localhost/api/trace/scan_decision_label_fallback");
      const ctx = { params: Promise.resolve({ sessionId: "scan_decision_label_fallback" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.traceNodes[0].labelEn).toBe("verify");
      expect(body.traceNodes[0].reasoningEn).toBeUndefined();
      expect(body.traceNodes[1].labelEn).toBe("synthesis");
    });
  });
});
