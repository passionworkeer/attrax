import { describe, expect, it } from "vitest";
import {
  buildProfitReportFromScanResult,
  financialSummaryFromProfitReport,
  synthesizeFinancialSummaryIfMissing,
} from "@/lib/pipeline/profit-report";
import type { ScanResult } from "@/lib/types";

/**
 * Regression tests for the `synthesizeFinancialSummaryIfMissing` adapter.
 *
 * Bug (2026-07-21): The /profit/[sessionId] page falls back to a
 * "no demo figures substituted" panel whenever result.financialSummary
 * is missing, even when the backend LLM has already produced a complete
 * profitReport.markdown for the same scan (real backend RAG responses
 * carry profit data ONLY in profitReport.markdown, no top-level
 * financialSummary). The user landed on the degraded panel when they
 * had a real backend scan whose LLM output contained the actual cost
 * analysis (CE/UKCA摊销 ¥15,000-40,000, BOM 增量 ¥0.75-1.05, etc.).
 *
 * Fix: when financialSummary is missing but reportPackage.profitReport
 * .markdown is present, derive a FinancialSummary-shaped object from
 * the LLM-generated markdown via buildProfitReportFromScanResult +
 * financialSummaryFromProfitReport. The /profit page uses the synthesized
 * summary to render structured cards plus the LLM markdown as the cost
 * detail panel.
 */

function realScanWithBackendMarkdown(markdown: string): ScanResult {
  return {
    sessionId: "scan_real_no_finsum",
    scanTime: "2026-07-21T08:00:00Z",
    productCategory: "electronics",
    productName: "65W GaN USB-PD 快充充电器",
    targetMarkets: ["EU", "UK"],
    complianceScore: 35,
    scoreGrade: "D",
    images: [],
    documents: [],
    riskPoints: [],
    checklist: [],
    generatedAt: "2026-07-21T08:01:00Z",
    source: "real",
    reportPackage: {
      complianceReport: "## 合规报告 (省略)",
      profitReport: { markdown },
      roadmap: { totalDays: 0, totalCost: "", progress: 0, items: [] },
      decisionView: {
        verdict: "REJECTED",
        riskLevel: "HIGH",
        summary: "",
        keyFindings: [],
        recommendedAction: "",
        nodes: [],
      },
      evidenceBundles: { visual: [], retrieval: [], generation: [] },
      auditMetadata: {
        schemaVersion: "1.0",
        generatedAt: "2026-07-21T08:01:00Z",
        validationStatus: "normalized",
        validationErrors: [],
        provider: "minimax",
        traceNodeCount: 0,
      },
    },
  };
}

const RICH_BACKEND_MARKDOWN = `### 一、合规升级成本（关键成本驱动）
基于 USB-C+PD 合规对标数据：非合规Micro-USB 方案约$0.25，合规 USB-C+PD+ESD完整方案约$1.00-$1.30，单台合规增量约*$0.75-$1.05*/台。

### 二、估算单台合规总成本
| 项目 | 估算金额 |
| BOM 物料合规增量 | $0.75-1.05 / 台 |
| CE/UKCA 测试认证 | ¥15,000-40,000（一次性）|
| UKCA 单独评估 | ¥8,000-20,000 |
| WEEE 注册与申报 | f2,000-6,000 / 年 |
| Pictogram 包装改版 | ¥3,000-8,000 |
| 单台摊销（按 10K 台）| ≈¥10-20 / 台 |

### 三、合规溢价与净利分析
- 合规后单件净利从 ¥70 下降到约 ¥45（出厂价不变）
- 整改后月度净利基准：¥18,000（3,000 台 / 月）
- 合规溢价：约 35%
- 盈亏平衡点：约 2,580 台 / 月

### 四、风险敞口
- 单日最高罚款：¥180 万
- 全店永久封停
- 货物强制扣毁
- 跨境集体诉讼
`;

describe("synthesizeFinancialSummaryIfMissing", () => {
  it("returns existing financialSummary without modification (demo path)", () => {
    const result: ScanResult = {
      sessionId: "demo",
      scanTime: "2026-07-21T08:00:00Z",
      productCategory: "electronics",
      productName: "demo product",
      targetMarkets: ["EU"],
      complianceScore: 50,
      scoreGrade: "C",
      images: [],
      documents: [],
      riskPoints: [],
      checklist: [],
      generatedAt: "2026-07-21T08:00:00Z",
      source: "demo",
      financialSummary: {
        estimatedHeroicProfit: "¥0.71",
        trueNetProfit: "¥7.46",
        complianceCost: "¥25",
        monthlyNetProfit: "¥18,000",
        targetVolumeLabel: "3,000 台 / 月",
        riskExposureItems: ["罚款"],
        costBreakdown: [],
      },
    };
    const out = synthesizeFinancialSummaryIfMissing(result, "zh");
    expect(out).toBe(result.financialSummary); // referential identity preserved
  });

  it("synthesizes a FinancialSummary when backend markdown is rich (the regression fix)", () => {
    const result = realScanWithBackendMarkdown(RICH_BACKEND_MARKDOWN);
    const out = synthesizeFinancialSummaryIfMissing(result, "zh");
    expect(out).not.toBeNull();
    expect(out).not.toBe(result.financialSummary); // must be synthesized, not the absent field
    // Must carry the contract surface that /profit page relies on
    expect(out!.estimatedHeroicProfit).toBeTruthy();
    expect(out!.trueNetProfit).toBeTruthy();
    expect(out!.complianceCost).toBeTruthy();
    expect(out!.monthlyNetProfit).toBeTruthy();
    expect(out!.targetVolumeLabel).toBeTruthy();
    expect(out!.riskExposureItems.length).toBeGreaterThanOrEqual(4);
    expect(out!.costBreakdown.length).toBeGreaterThanOrEqual(4);
  });

  it("returns null when no backend markdown is present (true empty state)", () => {
    const result = realScanWithBackendMarkdown("");
    expect(synthesizeFinancialSummaryIfMissing(result, "zh")).toBeNull();
  });

  it("English locale labels match the document language", () => {
    const result = realScanWithBackendMarkdown(RICH_BACKEND_MARKDOWN);
    const out = synthesizeFinancialSummaryIfMissing(result, "en");
    expect(out).not.toBeNull();
    expect(out!.targetVolumeLabel).toMatch(/Baseline|month/i);
  });
});

describe("buildProfitReportFromScanResult integration", () => {
  it("parses the same backend markdown into a structured ProfitReportResult", () => {
    const result = realScanWithBackendMarkdown(RICH_BACKEND_MARKDOWN);
    const profit = buildProfitReportFromScanResult(result, "zh");
    expect(profit).not.toBeNull();
    // The export pipeline (PDF/DOCX) must continue to work for this same input
    expect(typeof profit!.report).toBe("string");
    expect(profit!.report.length).toBeGreaterThan(0);
  });
});

describe("financialSummaryFromProfitReport unit", () => {
  it("produces a 6-row cost breakdown that matches the demo 65W layout", () => {
    const profit: Parameters<typeof financialSummaryFromProfitReport>[0] = {
      sessionId: "test",
      productType: "65W 充电器",
      market: "EU",
      report: "",
      barebone: { bom: 32, packaging: 3, cert: 0, epr: 0, logistics: 18.5, asp: 180, gp: 70.2, warranty: 4.3, total: 57.8 },
      compliant: { bom: 32, packaging: 5.5, cert: 18, epr: 4, logistics: 18.5, asp: 180, gp: 57.1, warranty: 7.5, total: 85.5 },
      bareboneRiskExposure: 180,
      compliantRiskExposure: 0,
      keyConclusion: "",
      generatedAt: "2026-07-21T08:00:00Z",
      premiumPct: "35%",
      breakevenUnits: "2,580 台",
      pricingStrategy: "¥18,000 / 月",
      riskNote: "",
      conclusions: "",
      references: "",
      bareboneGpm: 39,
      compliantGpm: 31.7,
    };
    const summary = financialSummaryFromProfitReport(profit, "zh");
    expect(summary.costBreakdown.length).toBe(6);
    expect(summary.riskExposureItems.length).toBeGreaterThanOrEqual(4);
    expect(summary.complianceCost).toContain("¥");
    expect(summary.targetVolumeLabel).toContain("3,000");
  });
});
