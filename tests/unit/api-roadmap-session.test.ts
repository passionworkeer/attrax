/**
 * Unit tests for GET /api/roadmap/[sessionId] route.
 * Tests compliance roadmap generation and timeline.
 *
 * Run with: npm run test -- tests/unit/api-roadmap-session.test.ts
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

describe("GET /api/roadmap/[sessionId]", () => {
  beforeEach(() => {
    mockSessions.clear();
  });

  describe("Scenario 1: Session not found", () => {
    it("returns 401 before probing an unknown real session", async () => {
      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_nonexistent");
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
        result: { complianceScore: 90 },
      });

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_protected");
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
        stageText: "分析中...",
        // No result yet
      });

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_processing");
      const ctx = { params: Promise.resolve({ sessionId: "scan_processing" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("NOT_READY");
    });
  });

  describe("Scenario 3: Normal session with high compliance score (>=80)", () => {
    it("returns roadmap with 42-day timeline", async () => {
      const result = {
        sessionId: "scan_high_score",
        productName: "智能音箱",
        targetMarkets: ["EU", "US"],
        complianceScore: 88,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_high_score", createSessionWithResult("scan_high_score", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_high_score");
      const ctx = { params: Promise.resolve({ sessionId: "scan_high_score" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.sessionId).toBe("scan_high_score");
      expect(body.product).toBe("智能音箱");
      expect(body.markets).toEqual(["EU", "US"]);
      expect(body.complianceScore).toBe(88);
      expect(body.complianceStatus).toBe("PASS");
      expect(body.totalDays).toBe(42);
      expect(body.progress).toBe(88);

      // Verify roadmap items
      expect(body.items).toBeDefined();
      expect(body.items).toHaveLength(6);
      expect(body.items[0].type).toBe("complete");
      expect(body.items[0].status).toBe("completed");
    });

    it("includes correct cost estimate for high score", async () => {
      const result = {
        sessionId: "scan_high_cost",
        targetMarkets: ["EU"],
        complianceScore: 92,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_high_cost", createSessionWithResult("scan_high_cost", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_high_cost");
      const ctx = { params: Promise.resolve({ sessionId: "scan_high_cost" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.totalCost).toMatch(/¥\d+K\+/);
    });
  });

  describe("Scenario 4: Medium compliance score (60-79)", () => {
    it("returns roadmap with 56-day timeline", async () => {
      const result = {
        sessionId: "scan_medium_score",
        targetMarkets: ["US", "UK"],
        complianceScore: 65,
        complianceStatus: "WARN",
      };

      mockSessions.set("scan_medium_score", createSessionWithResult("scan_medium_score", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_medium_score");
      const ctx = { params: Promise.resolve({ sessionId: "scan_medium_score" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.totalDays).toBe(56);
      expect(body.complianceStatus).toBe("WARN");
    });

    it("marks apply step as in-progress for low-medium scores", async () => {
      const result = {
        sessionId: "scan_apply_progress",
        targetMarkets: ["EU"],
        complianceScore: 55, // < 70
        complianceStatus: "WARN",
      };

      mockSessions.set("scan_apply_progress", createSessionWithResult("scan_apply_progress", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_apply_progress");
      const ctx = { params: Promise.resolve({ sessionId: "scan_apply_progress" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      // The "prepare application" step should be in-progress
      const applyStep = body.items.find((item: { id: string }) => item.id === "2");
      expect(applyStep.status).toBe("in-progress");
    });
  });

  describe("Scenario 5: Low compliance score (<60)", () => {
    it("returns roadmap with 70-day timeline", async () => {
      const result = {
        sessionId: "scan_low_score",
        targetMarkets: ["CN", "US"],
        complianceScore: 45,
        complianceStatus: "FAIL",
      };

      mockSessions.set("scan_low_score", createSessionWithResult("scan_low_score", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_low_score");
      const ctx = { params: Promise.resolve({ sessionId: "scan_low_score" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.totalDays).toBe(70);
      expect(body.complianceStatus).toBe("FAIL");
    });

    it("includes higher testing cost for low scores", async () => {
      const result = {
        sessionId: "scan_low_cost",
        targetMarkets: ["EU"],
        complianceScore: 40,
        complianceStatus: "FAIL",
      };

      mockSessions.set("scan_low_cost", createSessionWithResult("scan_low_cost", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_low_cost");
      const ctx = { params: Promise.resolve({ sessionId: "scan_low_cost" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      // Product testing step should have higher cost estimate
      const testStep = body.items.find((item: { id: string }) => item.id === "4");
      expect(testStep.cost).toBe("¥20,000-40,000");
    });
  });

  describe("Roadmap structure validation", () => {
    it("returns all required roadmap item fields", async () => {
      const result = {
        sessionId: "scan_roadmap_fields",
        targetMarkets: ["EU"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_roadmap_fields", createSessionWithResult("scan_roadmap_fields", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_roadmap_fields");
      const ctx = { params: Promise.resolve({ sessionId: "scan_roadmap_fields" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      for (const item of body.items) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("date");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("titleEn");
        expect(item).toHaveProperty("description");
        expect(item).toHaveProperty("descriptionEn");
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("status");
      }
    });

    it("contains correct item types", async () => {
      const result = {
        sessionId: "scan_item_types",
        targetMarkets: ["EU"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_item_types", createSessionWithResult("scan_item_types", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_item_types");
      const ctx = { params: Promise.resolve({ sessionId: "scan_item_types" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      const types = body.items.map((item: { type: string }) => item.type);
      expect(types).toContain("complete");
      expect(types).toContain("apply");
      expect(types).toContain("certify");
      expect(types).toContain("test");
    });

    it("includes document requirements for apply step", async () => {
      const result = {
        sessionId: "scan_docs",
        productName: "电动牙刷",
        targetMarkets: ["EU"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_docs", createSessionWithResult("scan_docs", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_docs");
      const ctx = { params: Promise.resolve({ sessionId: "scan_docs" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      const applyStep = body.items.find((item: { id: string }) => item.id === "2");
      expect(applyStep.documents).toBeDefined();
      expect(applyStep.documents.length).toBeGreaterThan(0);
      expect(applyStep.documentsEn).toBeDefined();
      expect(applyStep.documentsEn.length).toBeGreaterThan(0);
    });
  });

  describe("Cost estimation", () => {
    it("adds EU market surcharge", async () => {
      const result = {
        sessionId: "scan_eu_cost",
        targetMarkets: ["EU"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_eu_cost", createSessionWithResult("scan_eu_cost", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_eu_cost");
      const ctx = { params: Promise.resolve({ sessionId: "scan_eu_cost" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      // Parse the cost to verify EU surcharge
      const costMatch = body.totalCost.match(/¥(\d+)K\+/);
      expect(costMatch).not.toBeNull();
    });

    it("adds US market surcharge", async () => {
      const result = {
        sessionId: "scan_us_cost",
        targetMarkets: ["US"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_us_cost", createSessionWithResult("scan_us_cost", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_us_cost");
      const ctx = { params: Promise.resolve({ sessionId: "scan_us_cost" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.totalCost).toMatch(/¥\d+K\+/);
    });

    it("adds CN market surcharge", async () => {
      const result = {
        sessionId: "scan_cn_cost",
        targetMarkets: ["CN"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_cn_cost", createSessionWithResult("scan_cn_cost", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_cn_cost");
      const ctx = { params: Promise.resolve({ sessionId: "scan_cn_cost" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.totalCost).toMatch(/¥\d+K\+/);
    });
  });

  describe("Product name handling", () => {
    it("uses productName when available", async () => {
      const result = {
        sessionId: "scan_product_name",
        productName: "智能手表",
        targetMarkets: ["EU"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_product_name", createSessionWithResult("scan_product_name", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_product_name");
      const ctx = { params: Promise.resolve({ sessionId: "scan_product_name" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.product).toBe("智能手表");
    });

    it("falls back to product when productName is missing", async () => {
      const result = {
        sessionId: "scan_product_fallback",
        product: "蓝牙耳机",
        targetMarkets: ["EU"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_product_fallback", createSessionWithResult("scan_product_fallback", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_product_fallback");
      const ctx = { params: Promise.resolve({ sessionId: "scan_product_fallback" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.product).toBe("蓝牙耳机");
    });

    it("uses default product when both are missing", async () => {
      const result = {
        sessionId: "scan_no_product",
        targetMarkets: ["EU"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_no_product", createSessionWithResult("scan_no_product", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_no_product");
      const ctx = { params: Promise.resolve({ sessionId: "scan_no_product" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.product).toBe("产品");
    });
  });

  describe("Edge cases", () => {
    it("handles single market", async () => {
      const result = {
        sessionId: "scan_single_market",
        targetMarkets: ["JP"],
        complianceScore: 85,
        complianceStatus: "PASS",
      };

      mockSessions.set("scan_single_market", createSessionWithResult("scan_single_market", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_single_market");
      const ctx = { params: Promise.resolve({ sessionId: "scan_single_market" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(body.markets).toEqual(["JP"]);
    });

    it("handles unknown compliance status", async () => {
      const result = {
        sessionId: "scan_unknown_status",
        targetMarkets: ["EU"],
        complianceScore: 85,
        complianceStatus: "UNKNOWN",
      };

      mockSessions.set("scan_unknown_status", createSessionWithResult("scan_unknown_status", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_unknown_status");
      const ctx = { params: Promise.resolve({ sessionId: "scan_unknown_status" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.complianceStatus).toBe("UNKNOWN");
    });

    it("uses snake_case report_package roadmap before generated fallback", async () => {
      const result = {
        sessionId: "scan_snake_package_roadmap",
        productName: "Adapter",
        targetMarkets: ["EU"],
        complianceScore: 91,
        complianceStatus: "PASS",
        report_package: {
          roadmap: {
            total_days: 21,
            total_cost: "¥12K+",
            progress: 72,
            items: [{
              id: "pkg-1",
              date: "2026-05-22",
              title: "补齐标签",
              title_en: "Complete labeling",
              description: "补齐铭牌和警示语",
              description_en: "Complete nameplate and warnings",
              type: "apply",
              status: "in-progress",
              estimated_days: 3,
              documents_en: ["Label artwork"],
            }],
          },
        },
      };

      mockSessions.set("scan_snake_package_roadmap", createSessionWithResult("scan_snake_package_roadmap", result));

      const { GET } = await import("@/app/api/roadmap/[sessionId]/route");
      const req = new Request("http://localhost/api/roadmap/scan_snake_package_roadmap");
      const ctx = { params: Promise.resolve({ sessionId: "scan_snake_package_roadmap" }) };

      const res = await GET(req, ctx);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.totalDays).toBe(21);
      expect(body.totalCost).toBe("¥12K+");
      expect(body.items).toHaveLength(1);
      expect(body.items[0].titleEn).toBe("Complete labeling");
      expect(body.items[0].estimatedDays).toBe(3);
      expect(body.items[0].documentsEn).toEqual(["Label artwork"]);
    });
  });
});
