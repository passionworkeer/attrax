/**
 * tests/unit/profit-report-structured-fields.test.ts
 *
 * Tests for `applyStructuredProfitFields`. The RAG generator does not
 * yet emit `structuredFields` (see docs/MOCK-REAL-MAPPING.md §5) but
 * the frontend now has a contract in place so when it does, parsing
 * gracefully prefers JSON over the fragile markdown regex.
 */
import { describe, expect, it } from "vitest";
import {
  applyStructuredProfitFields,
  extractCostSummary,
  isStructuredProfitFields,
  type StructuredProfitFields,
} from "@/lib/pipeline/profit-report";
import type { ProfitReportResult } from "@/lib/types";

const BASE: ProfitReportResult = {
  sessionId: "s1",
  productType: "USB-C adapter",
  market: "EU",
  report: "## Cost analysis",
  barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6, asp: 19.99, gp: 0.71, warranty: 0.45, total: 15.95 },
  compliant: { bom: 11.8, packaging: 0.55, cert: 0.35, epr: 0.28, logistics: 6.1, asp: 29.99, gp: 7.46, warranty: 0.75, total: 19.63 },
  bareboneRiskExposure: 6800,
  compliantRiskExposure: 600,
  keyConclusion: "fallback conclusion",
  generatedAt: "2026-07-14T00:00:00Z",
  premiumPct: "23%",
  breakevenUnits: "545 台",
  pricingStrategy: "fallback strategy",
  riskNote: "fallback risk note",
  conclusions: "",
  references: "",
  bareboneGpm: 0,
  compliantGpm: 0,
};

describe("applyStructuredProfitFields", () => {
  it("returns the base unchanged when fields are undefined", () => {
    expect(applyStructuredProfitFields(BASE, undefined)).toEqual(BASE);
  });

  it("overrides cost comparison when provided", () => {
    const fields: StructuredProfitFields = {
      costComparison: {
        barebone: { bom: 99.5, total: 199.0 },
        compliant: { bom: 110.0, total: 230.0 },
      },
    };
    const out = applyStructuredProfitFields(BASE, fields);
    expect(out.barebone.bom).toBe(99.5);
    expect(out.barebone.total).toBe(199.0);
    expect(out.compliant.bom).toBe(110.0);
    // Unprovided fields fall through
    expect(out.compliant.asp).toBe(BASE.compliant.asp);
  });

  it("overrides breakeven, pricing, risk exposure when provided", () => {
    const fields: StructuredProfitFields = {
      breakeven: { units: 295, currency: "USD" },
      pricing: { strategy: "推荐 $39.99 上架", premiumPct: "37%" },
      risk: { bareboneExposure: 9200, compliantExposure: 480 },
    };
    const out = applyStructuredProfitFields(BASE, fields);
    expect(out.breakevenUnits).toBe("295");
    expect(out.pricingStrategy).toBe("推荐 $39.99 上架");
    expect(out.premiumPct).toBe("37%");
    expect(out.bareboneRiskExposure).toBe(9200);
    expect(out.compliantRiskExposure).toBe(480);
  });

  it("accepts breakeven units as a string", () => {
    const fields: StructuredProfitFields = { breakeven: { units: "182 units" } };
    const out = applyStructuredProfitFields(BASE, fields);
    expect(out.breakevenUnits).toBe("182 units");
  });

  it("type guard accepts well-formed fields", () => {
    expect(isStructuredProfitFields({ costComparison: { barebone: { bom: 1 } } })).toBe(true);
    expect(isStructuredProfitFields({})).toBe(true);
  });

  it("type guard rejects non-object values", () => {
    expect(isStructuredProfitFields(null)).toBe(false);
    expect(isStructuredProfitFields("string")).toBe(false);
    expect(isStructuredProfitFields(42)).toBe(false);
  });

  it("does not mutate the base result", () => {
    const fields: StructuredProfitFields = { costComparison: { barebone: { bom: 999 } } };
    const beforeBom = BASE.barebone.bom;
    applyStructuredProfitFields(BASE, fields);
    expect(BASE.barebone.bom).toBe(beforeBom);
  });
});

describe("extractCostSummary still works on its own", () => {
  it("parses a typical markdown cost table", () => {
    const md = `### 一、成本对比

| 成本项 | 裸奔模式 | 合规模式 |
| --- | ---: | ---: |
| BOM | $9.20 | $11.80 |
| 包装与印刷 | $0.25 | $0.55 |
| **总直接成本** | **$15.95** | **$19.63** |
`;
    const out = extractCostSummary(md);
    expect(out.barebone.bom).toBeCloseTo(9.2);
    expect(out.compliant.bom).toBeCloseTo(11.8);
    expect(out.barebone.total).toBeCloseTo(15.95);
    expect(out.compliant.total).toBeCloseTo(19.63);
  });
});
