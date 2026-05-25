import { describe, expect, it } from "vitest";
import { createMockScanResult, mockScanResult } from "@/lib/mock/scan-result";

describe("Mock Scan Result", () => {
  describe("createMockScanResult", () => {
    it("creates result with default sessionId", () => {
      const result = createMockScanResult();
      expect(result.sessionId).toBe("demo");
      expect(result.productCategory).toBe("electronics");
    });

    it("creates result with custom sessionId", () => {
      const result = createMockScanResult("scan_01JXXXXX");
      expect(result.sessionId).toBe("scan_01JXXXXX");
    });

    it("contains valid scan time", () => {
      const result = createMockScanResult();
      expect(result.scanTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("contains product name", () => {
      const result = createMockScanResult();
      expect(result.productName).toBe("USB 智能加湿器");
    });

    it("contains target markets", () => {
      const result = createMockScanResult();
      expect(result.targetMarkets).toContain("EU");
      expect(result.targetMarkets).toContain("US");
    });

    it("contains compliance score and grade", () => {
      const result = createMockScanResult();
      expect(result.complianceScore).toBe(45);
      expect(result.scoreGrade).toBe("D");
    });

    it("contains images", () => {
      const result = createMockScanResult();
      expect(result.images).toHaveLength(2);
      expect(result.images[0].imageId).toBe("img_01");
      expect(result.images[1].imageId).toBe("img_02");
    });

    it("contains richer risk points", () => {
      const result = createMockScanResult();
      expect(result.riskPoints.length).toBeGreaterThanOrEqual(3);
      expect(result.riskPoints[0].title).toContain("CE");
      expect(result.riskPoints[1].title).toContain("包装");
    });

    it("risk points have severity", () => {
      const result = createMockScanResult();
      expect(result.riskPoints[0].severity).toBe("critical");
      expect(result.riskPoints[1].severity).toBe("warning");
    });

    it("risk points have confidence scores", () => {
      const result = createMockScanResult();
      for (const risk of result.riskPoints) {
        expect(risk.confidence).toBeGreaterThan(0);
        expect(risk.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("risk points have bounding boxes", () => {
      const result = createMockScanResult();
      const bbox = result.riskPoints[0].bbox;
      expect(bbox).toHaveProperty("x");
      expect(bbox).toHaveProperty("y");
      expect(bbox).toHaveProperty("w");
      expect(bbox).toHaveProperty("h");
      expect(bbox.x).toBeGreaterThanOrEqual(0);
      expect(bbox.y).toBeGreaterThanOrEqual(0);
      expect(bbox.w).toBeGreaterThanOrEqual(0);
      expect(bbox.h).toBeGreaterThanOrEqual(0);
    });

    it("risk points have regulations", () => {
      const result = createMockScanResult();
      expect(result.riskPoints[0].regulations).toHaveLength(1);
      expect(result.riskPoints[0].regulations[0].code).toBe("CE");
    });

    it("risk points have recommended actions", () => {
      const result = createMockScanResult();
      expect(result.riskPoints[0].recommendedAction).toBeTruthy();
    });

    it("contains richer checklist items", () => {
      const result = createMockScanResult();
      expect(result.checklist.length).toBeGreaterThanOrEqual(3);
      expect(result.checklist[0].title).toBe("建立技术文件包和 DoC");
    });

    it("checklist items have required materials", () => {
      const result = createMockScanResult();
      expect(result.checklist[0].requiredMaterials).toContain("产品规格书");
    });

    it("checklist items include free and paid work", () => {
      const result = createMockScanResult();
      expect(result.checklist.some((item) => item.isFree)).toBe(true);
      expect(result.checklist.some((item) => !item.isFree)).toBe(true);
    });

    it("contains model info", () => {
      const result = createMockScanResult();
      expect(result.modelInfo).toBeDefined();
      expect(result.modelInfo?.visionProvider).toBe("mock");
      expect(result.modelInfo?.latencyMs).toBe(0);
    });

    it("contains generatedAt timestamp", () => {
      const result = createMockScanResult();
      expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("mockScanResult constant", () => {
    it("is exported and valid", () => {
      expect(mockScanResult).toBeDefined();
      expect(mockScanResult.sessionId).toBe("demo");
    });

    it("matches structure of createMockScanResult", () => {
      const generated = createMockScanResult("demo");
      expect(mockScanResult.images).toHaveLength(generated.images.length);
      expect(mockScanResult.riskPoints).toHaveLength(generated.riskPoints.length);
      expect(mockScanResult.checklist).toHaveLength(generated.checklist.length);
    });
  });
});
