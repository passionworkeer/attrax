import { describe, expect, it } from "vitest";
import { buildComplianceReport } from "@/lib/reporting";
import type { ScanResult } from "@/lib/types";

function realScanResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    sessionId: "scan_real1",
    productName: "Anker A2332 充电器",
    targetMarkets: ["EU"],
    complianceScore: 65,
    scoreGrade: "C",
    generatedAt: "2026-09-17T06:20:26+00:00",
    riskPoints: [],
    checklist: [],
    complianceReport: "### EU 市合规风险扫描\n\n**必检法规与适用理由**\n1. RoHS Directive 2011/65/EU — 适用理由：充电器属电子电气设备。",
    reportPackage: {
      citations: [
        {
          doc_id: "eu_rohs_2011_65",
          article_id: "art-4",
          official_citation: "Directive 2011/65/EU Article 4",
          quote: "…",
          match_status: "matched",
        },
        {
          doc_id: "eu_gpsr_2023_988",
          article_id: "art-6",
          official_citation: "Regulation (EU) 2023/988 Article 6",
          quote: "…",
          match_status: "unmatched",
        },
      ],
    },
    ...overrides,
  } as unknown as ScanResult;
}

describe("buildComplianceReport — real backend scans (de-RAG report package)", () => {
  it("renders the backend compliance report body instead of empty riskPoints sections", () => {
    const md = buildComplianceReport(realScanResult(), "zh");

    expect(md).toContain("Anker A2332 充电器");
    expect(md).toContain("### EU 市合规风险扫描");
    expect(md).toContain("RoHS Directive 2011/65/EU");
    // The legacy empty-section template must not appear.
    expect(md).not.toContain("## 核心结论\n\n\n");
  });

  it("lists reportPackage citations with match status", () => {
    const md = buildComplianceReport(realScanResult(), "zh");

    expect(md).toContain("- Directive 2011/65/EU Article 4");
    // Unmatched citations are flagged, matched ones are not.
    expect(md).toContain("Regulation (EU) 2023/988 Article 6 [unmatched]");
  });

  it("falls back to a placeholder when the scan carries no citations", () => {
    const md = buildComplianceReport(
      realScanResult({ reportPackage: { citations: [] } as ScanResult["reportPackage"] }),
      "zh",
    );

    expect(md).toContain("本次扫描暂无引用条款");
  });

  it("keeps the legacy riskPoints rendering for old/demo shapes", () => {
    const legacy = realScanResult({
      complianceReport: undefined,
      riskPoints: [
        {
          title: "CE 标志缺失",
          description: "包装未见 CE 标志",
          severity: "warning",
          recommendedAction: "补齐 CE 标志",
          regulations: [
            {
              market: "EU",
              code: "2011/65/EU",
              name: "RoHS",
              summary: "有害物质限制",
            },
          ],
        },
      ],
    } as Partial<ScanResult>);
    const md = buildComplianceReport(legacy, "zh");

    expect(md).toContain("## 核心结论");
    expect(md).toContain("CE 标志缺失");
    expect(md).toContain("## 重点法规引用");
    expect(md).toContain("2011/65/EU");
  });

  it("renders the English variant with the backend body", () => {
    const md = buildComplianceReport(realScanResult(), "en");

    expect(md).toContain("# CompliPilot · Compliance Scan Report");
    expect(md).toContain("### EU 市合规风险扫描");
    expect(md).toContain("## Regulatory citations");
    expect(md).toContain("Directive 2011/65/EU Article 4");
  });
});
