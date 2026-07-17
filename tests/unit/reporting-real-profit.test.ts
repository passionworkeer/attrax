import { describe, expect, it } from "vitest";
import { buildProfitReport } from "@/lib/reporting";
import type { ScanResult } from "@/lib/types";

function realResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    sessionId: "scan_real_profit",
    scanTime: "2026-07-17T08:00:00Z",
    productCategory: "electronics",
    productName: "真实充电器",
    targetMarkets: ["EU"],
    complianceScore: 35,
    scoreGrade: "D",
    images: [],
    documents: [],
    riskPoints: [],
    checklist: [],
    generatedAt: "2026-07-17T08:01:00Z",
    source: "real",
    ...overrides,
  };
}

describe("buildProfitReport for real sessions", () => {
  it("uses backend profit markdown when structured financial fields are absent", () => {
    const report = buildProfitReport(
      realResult({ reportPackage: { profitReport: { markdown: "# 后端真实成本报告\n\n暂无售价输入。" } } }),
      "zh",
    );

    expect(report).toContain("后端真实成本报告");
    expect(report).not.toContain("¥27");
    expect(report).not.toContain("¥12000");
  });

  it("states that figures are unavailable instead of inventing amounts", () => {
    const report = buildProfitReport(realResult(), "en");

    expect(report).toContain("not available");
    expect(report).not.toContain("¥27");
    expect(report).not.toContain("¥12000");
  });
});
