import { describe, it, expect } from "vitest";
import { synthesizeFinancialSummaryIfMissing } from "@/lib/pipeline/profit-report";
import type { ScanResult, ReportPackage } from "@/lib/types";

/**
 * Audit 2026-09-13 §10.2 — keep unknown money unknown.
 *
 * The reference session's structuredFields.costComparison was all zeros
 * with finance validation "valid", so the page displayed $0.00 as if it
 * were a real quote while the report text said 待询价. The synthesizer
 * must treat an all-zero comparison as no-data (null → the fallback
 * renders 待询价 / "—"), and must accept negative gp (losses) now that
 * the schema allows them.
 */
function scanResultWithCostComparison(
  barebone: Record<string, number>,
  compliant: Record<string, number>,
): ScanResult {
  const reportPackage = {
    profitReport: {
      markdown: "",
      structuredFields: {
        currency: "USD",
        costComparison: { barebone, compliant },
      },
    },
  } as unknown as ReportPackage;
  return {
    sessionId: "scan_finance",
    scanTime: "2026-09-13T00:00:00Z",
    productCategory: "electronics",
    targetMarkets: ["EU"],
    complianceScore: 65,
    scoreGrade: "C",
    images: [],
    documents: [],
    riskPoints: [],
    checklist: [],
    generatedAt: "2026-09-13T00:00:00Z",
    reportPackage,
  } as unknown as ScanResult;
}

const ZERO_SUMMARY = {
  bom: 0, packaging: 0, cert: 0, epr: 0,
  logistics: 0, warranty: 0, asp: 0, total: 0, gp: 0,
};

describe("synthesizeFinancialSummaryIfMissing — unknown vs quoted money", () => {
  it("returns null for an all-zero costComparison (no real quote)", () => {
    const result = scanResultWithCostComparison(ZERO_SUMMARY, ZERO_SUMMARY);
    expect(synthesizeFinancialSummaryIfMissing(result)).toBeNull();
  });

  it("returns a summary for a genuinely zero-cost free item when the other side has data", () => {
    // barebone all-zero (free to make), compliant carries real cert cost —
    // the pair as a whole carries information, so it must not be dropped
    // (plan: 不要通过"所有零都禁止"误伤真实免费项目). sourceStatus is absent
    // → model estimate → values render with the 估算 marker (§10.2).
    const result = scanResultWithCostComparison(
      ZERO_SUMMARY,
      { bom: 1, packaging: 0.5, cert: 0.2, epr: 0, logistics: 0.3, warranty: 0, asp: 2, total: 2, gp: 0 },
    );
    const summary = synthesizeFinancialSummaryIfMissing(result);
    expect(summary).not.toBeNull();
    expect(summary?.trueNetProfit).toBe("$0.00（估）");
    expect(summary?.complianceCost).toBe("$0.20（估）");
  });

  it("renders plain values when sourceStatus is quoted", () => {
    const result = scanResultWithCostComparison(
      ZERO_SUMMARY,
      { bom: 1, packaging: 0.5, cert: 0.2, epr: 0, logistics: 0.3, warranty: 0, asp: 2, total: 2, gp: 0 },
    );
    (
      (result.reportPackage as unknown as { profitReport: { structuredFields: Record<string, unknown> } })
        .profitReport.structuredFields
    ).sourceStatus = "quoted";
    const summary = synthesizeFinancialSummaryIfMissing(result);
    expect(summary?.trueNetProfit).toBe("$0.00");
    expect(summary?.complianceCost).toBe("$0.20");
  });

  it("accepts a negative gp (loss) and formats it as an estimate", () => {
    const result = scanResultWithCostComparison(
      ZERO_SUMMARY,
      { bom: 3, packaging: 0.5, cert: 0.2, epr: 0, logistics: 0.3, warranty: 0, asp: 2, total: 4, gp: -2 },
    );
    const summary = synthesizeFinancialSummaryIfMissing(result);
    expect(summary).not.toBeNull();
    expect(summary?.trueNetProfit).toBe("$-2.00（估）");
  });

  it("returns null when structuredFields are missing entirely", () => {
    const result = {
      sessionId: "s",
      reportPackage: { profitReport: { markdown: "" } },
    } as unknown as ScanResult;
    expect(synthesizeFinancialSummaryIfMissing(result)).toBeNull();
  });
});
