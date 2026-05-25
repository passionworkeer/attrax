import { describe, expect, it } from "vitest";
import {
  createMockComplianceReportResult,
  createMockProfitReports,
  createMockScanResult,
} from "@/lib/mock/scan-result";
import {
  containsHan,
  localizeComplianceReportResult,
  localizeProfitReportResult,
  localizeScanResult,
} from "@/lib/report-localization";

const HAN = /[\u3400-\u9fff]/;

function expectNoHan(text: string | undefined) {
  expect(text ?? "").not.toMatch(HAN);
}

describe("report localization", () => {
  it("detects Han text for English-safe fallbacks", () => {
    expect(containsHan("中文")).toBe(true);
    expect(containsHan("English only")).toBe(false);
  });

  it("localizes raw mock product data to English fields", () => {
    const result = localizeScanResult(createMockScanResult(), "en");

    expectNoHan(result.productName);
    result.documents.forEach((document) => expectNoHan(document.name));
    result.riskPoints.forEach((risk) => {
      expectNoHan(risk.title);
      expectNoHan(risk.description);
      expectNoHan(risk.recommendedAction);
      risk.regulations.forEach((regulation) => {
        expectNoHan(regulation.name);
        expectNoHan(regulation.summary);
      });
    });
    result.checklist.forEach((item) => {
      expectNoHan(item.category);
      expectNoHan(item.title);
      item.requiredMaterials.forEach(expectNoHan);
      expectNoHan(item.recommendedLab);
      expectNoHan(item.estimatedTime);
    });
  });

  it("localizes compliance report body and retrieved evidence to English", () => {
    const result = localizeComplianceReportResult(createMockComplianceReportResult(), "en");

    expectNoHan(result.productName);
    expectNoHan(result.complianceReport);
    result.retrievedChunks.forEach((chunk) => expectNoHan(chunk.docName));
  });

  it("provides English report-package content for decision and roadmap exports", () => {
    const reportPackage = createMockComplianceReportResult().reportPackage;

    expectNoHan(reportPackage?.complianceReportEn);
    expectNoHan(reportPackage?.decisionView?.summaryEn);
    reportPackage?.decisionView?.keyFindingsEn?.forEach(expectNoHan);
    expectNoHan(reportPackage?.decisionView?.recommendedActionEn);
    reportPackage?.decisionView?.nodes?.forEach((node) => {
      expectNoHan(node.labelEn);
      expectNoHan(node.reasoningEn);
    });
    reportPackage?.roadmap?.items?.forEach((item) => {
      expectNoHan(item.titleEn);
      expectNoHan(item.descriptionEn);
      item.documentsEn?.forEach(expectNoHan);
    });
  });

  it("localizes every mock profit scenario body and export field to English", () => {
    const reports = createMockProfitReports().map((report) => localizeProfitReportResult(report, "en"));

    reports.forEach((report) => {
      expectNoHan(report.productType);
      expectNoHan(report.market);
      expectNoHan(report.report);
      expectNoHan(report.keyConclusion);
      expectNoHan(report.breakevenUnits);
      expectNoHan(report.pricingStrategy);
      expectNoHan(report.riskNote);
      expectNoHan(report.conclusions);
      expectNoHan(report.references);
    });
  });

  it("does not fall back to Chinese when English compliance fields are missing", () => {
    const base = createMockComplianceReportResult();
    const result = localizeComplianceReportResult({
      ...base,
      productName: "中文产品",
      productNameEn: undefined,
      complianceReport: "## 中文报告\n\n需要补充标签。",
      complianceReportEn: undefined,
      reportPackage: {
        ...base.reportPackage,
        complianceReportEn: undefined,
        compliance_report_en: undefined,
      },
      retrievedChunks: base.retrievedChunks.map((chunk) => ({
        ...chunk,
        docName: "中文法规",
        docNameEn: undefined,
      })),
    }, "en");

    expectNoHan(result.productName);
    expectNoHan(result.complianceReport);
    expect(result.complianceReport).toContain("Compliance Analysis Report");
    result.retrievedChunks.forEach((chunk) => expectNoHan(chunk.docName));
  });

  it("does not fall back to Chinese when English profit fields are missing", () => {
    const base = createMockProfitReports()[0];
    const result = localizeProfitReportResult({
      ...base,
      productType: "中文产品",
      productTypeEn: undefined,
      market: "中国",
      marketEn: undefined,
      report: "## 中文利润报告\n\n合规方案更稳健。",
      reportEn: undefined,
      keyConclusion: "中文结论",
      keyConclusionEn: undefined,
      breakevenUnits: "150台",
      breakevenUnitsEn: undefined,
      pricingStrategy: "建议定价 ¥199",
      pricingStrategyEn: undefined,
      riskNote: "中文风险",
      riskNoteEn: undefined,
      conclusions: "- 中文结论",
      conclusionsEn: undefined,
      references: "- 中文引用",
      referencesEn: undefined,
    }, "en");

    expectNoHan(result.productType);
    expectNoHan(result.market);
    expectNoHan(result.report);
    expectNoHan(result.keyConclusion);
    expectNoHan(result.breakevenUnits);
    expectNoHan(result.pricingStrategy);
    expectNoHan(result.riskNote);
    expectNoHan(result.conclusions);
    expectNoHan(result.references);
  });
});
