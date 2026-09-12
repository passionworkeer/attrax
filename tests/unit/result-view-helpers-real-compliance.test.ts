import { describe, it, expect } from "vitest";
import { scanResultToRealComplianceView } from "@/lib/result-view-helpers";
import type { ScanResult } from "@/lib/types";

/**
 * Regression tests for the real (non-demo) compliance-view conversion.
 *
 * Bug background: `scanResultToComplianceView` (the demo converter) used to be
 * called for ALL scans, which destroyed real LLM output and rendered a fake
 * "demo.aggregate" trace + zero-latency "fallback-mock" provider label even on
 * genuine KB-anchored scans. `scanResultToRealComplianceView` was added as the
 * real-path counterpart on 2026-09-12.
 */
describe("scanResultToRealComplianceView", () => {
  const baseResult: ScanResult = {
    sessionId: "scan_real_1",
    scanTime: "2026-09-12T07:25:00+00:00",
    productCategory: "electronics",
    productName: "65W GaN 充电器",
    targetMarkets: ["EU", "UK"],
    complianceScore: 35,
    scoreGrade: "D",
    images: [],
    documents: [],
    riskPoints: [
      {
        riskId: "rp_01",
        title: "产品图视觉识别",
        description: "未提供实物图",
        severity: "critical",
        flameLevel: 3,
        confidence: 0.4,
        imageId: "img_0",
        bbox: { x: 0, y: 0, w: 0, h: 0 },
        regulations: [],
        recommendedAction: "冻结发货与上架",
      },
    ],
    checklist: [],
    generatedAt: "2026-09-12T07:27:50+00:00",
    source: "real",
  };

  it("forwards the real LLM-rendered compliance markdown (not a demo template)", () => {
    const realMarkdown = "# 真实合规报告\n\n## 法规适用性\n- RoHS";
    const view = scanResultToRealComplianceView(
      { ...baseResult, complianceReport: realMarkdown },
      "zh",
    );
    expect(view.complianceReport).toBe(realMarkdown);
    expect(view.complianceReport).not.toContain("Demo");
  });

  it("falls back to reportPackage.complianceReport when top-level field is empty", () => {
    const pkgMarkdown = "# 来自 reportPackage 的报告";
    const view = scanResultToRealComplianceView(
      {
        ...baseResult,
        complianceReport: undefined,
        reportPackage: { complianceReport: pkgMarkdown } as ScanResult["reportPackage"],
      },
      "zh",
    );
    expect(view.complianceReport).toBe(pkgMarkdown);
  });

  it("passes through real agent trace and never appends demo.aggregate", () => {
    const realTrace = [
      { node: "vision", durationMs: 5054 },
      { node: "generate", status: "success", durationMs: 48484 },
      { node: "verify", status: "success", matched: 17 },
    ];
    const view = scanResultToRealComplianceView(
      { ...baseResult, agentTrace: realTrace },
      "zh",
    );
    expect(view.agentTrace).toEqual(realTrace);
    expect(view.agentTrace.some((step) => step.node === "demo.aggregate")).toBe(false);
  });

  it("exposes the real LLM provider and latency (not 'demo' / 0ms)", () => {
    const view = scanResultToRealComplianceView(
      { ...baseResult, ragProvider: "minimax", latencyMs: 48484 },
      "zh",
    );
    expect(view.modelInfo.ragProvider).toBe("minimax");
    expect(view.modelInfo.latencyMs).toBe(48484);
  });

  it("falls back to 'unknown' (not 'minimax') when the backend omitted provider", () => {
    // Audit P1-H: previously the helper fabricated "minimax" when the
    // backend shipped no provider, which would silently keep showing the old
    // label after any future LLM swap.
    const view = scanResultToRealComplianceView({ ...baseResult, ragProvider: undefined }, "zh");
    expect(view.modelInfo.ragProvider).toBe("unknown");
  });

  it("uses result.source (real/fallback) and never hardcodes 'demo'", () => {
    const realView = scanResultToRealComplianceView({ ...baseResult, source: "real" }, "zh");
    const fallbackView = scanResultToRealComplianceView({ ...baseResult, source: "fallback" }, "zh");
    expect(realView.source).toBe("real");
    expect(fallbackView.source).toBe("fallback");
    expect(realView.source).not.toBe("demo");
  });

  it("rolls up complianceStatus from riskPoints (critical → REJECTED)", () => {
    const view = scanResultToRealComplianceView(baseResult, "zh");
    expect(view.complianceStatus).toBe("REJECTED");
  });

  it("returns UNKNOWN when there are no risk points (no demo defaults)", () => {
    const view = scanResultToRealComplianceView(
      { ...baseResult, riskPoints: [] },
      "zh",
    );
    expect(view.complianceStatus).toBe("UNKNOWN");
  });

  /**
   * P0-A regression: real scans previously dropped images/riskPoints/checklist
   * in the helper (they were hardcoded to `undefined`), which silently collapsed
   * the rich panel inside `<ComplianceReportView>`. After the fix the helper
   * forwards them so the rich section renders identically for demo and real.
   */
  it("forwards images, riskPoints, checklist, and documents for real scans (no silent undefined)", () => {
    const realImages = [
      {
        imageId: "img_real",
        url: "/api/scan/scan_real_1/asset/0",
        thumbnail: "/api/scan/scan_real_1/asset/0",
        width: 1024,
        height: 768,
        fileName: "front.jpg",
        angleHint: "front" as const,
      },
    ];
    const realDocuments = [
      {
        documentId: "doc_real",
        name: "spec.pdf",
        size: 12345,
        type: "pdf" as const,
        mimeType: "application/pdf",
        url: "/api/scan/scan_real_1/asset/doc/0",
      },
    ];
    const realRiskPoints = [
      {
        ...baseResult.riskPoints[0],
        regulations: [
          {
            regId: "EU-2014-35",
            code: "Art. 4",
            name: "Low Voltage Directive",
            nameEn: "Low Voltage Directive",
            market: "EU" as const,
            summary: "电气安全",
            sourceUrl: "https://eur-lex.europa.eu/eli/dir/2014/35/oj",
            severity: "critical" as const,
          },
        ],
      },
    ];
    const view = scanResultToRealComplianceView(
      { ...baseResult, images: realImages, documents: realDocuments, riskPoints: realRiskPoints },
      "zh",
    );
    expect(view.images).toBe(realImages);
    expect(view.documents).toEqual([
      expect.objectContaining({
        documentId: "doc_real",
        name: "spec.pdf",
        type: "pdf",
      }),
    ]);
    expect(view.riskPoints).toBe(realRiskPoints);
    expect(view.checklist).toBe(baseResult.checklist);
    expect(view.retrievedChunks.length).toBeGreaterThan(0);
    expect(view.retrievedChunks[0]).toMatchObject({
      regId: "EU-2014-35",
      articleNo: "Art. 4",
      region: "EU",
    });
  });
});
