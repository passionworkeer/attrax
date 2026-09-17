import { describe, expect, it } from "vitest";
import { factRiskContext } from "@/lib/result/fact-risk-context";

const FACT_IDS = [
  "toy.age_range.label",
  "common.product.overview",
  "common.nameplate.readability",
  "common.certification_marks.visible",
  "common.brand_model.visible",
  "common.warning_text.language",
  "common.packaging.info",
  "common.defects.visible",
];

describe("fact risk legal context", () => {
  it("gives every LEGO fact a specific reason, evidence gap and legal basis", () => {
    const contexts = FACT_IDS.map(checkId => factRiskContext(checkId, "US", "zh"));
    for (const context of contexts) {
      expect(context.summary.length).toBeGreaterThan(18);
      expect(context.explanation.length).toBeGreaterThan(60);
      expect(context.evidenceToVerify.length).toBeGreaterThan(12);
      expect(context.citations.length).toBeGreaterThan(0);
      expect(context.citations.every(citation => citation.matchStatus === "matched")).toBe(true);
    }
    expect(new Set(contexts.map(context => context.summary)).size).toBe(FACT_IDS.length);
  });

  it("links age grading to the four-factor rule instead of treating 18+ as dispositive", () => {
    const context = factRiskContext("toy.age_range.label", "US", "zh");
    expect(context.explanation).toContain("不允许仅凭这一标签");
    expect(context.citations.map(citation => citation.officialCitation)).toEqual([
      "16 CFR § 1200.2(a)",
      "16 CFR § 1200.2(c)(1)",
    ]);
  });

  it("keeps an explicit non-US fallback without inventing a legal citation", () => {
    const context = factRiskContext("toy.age_range.label", "EU", "zh");
    expect(context.citations).toEqual([]);
    expect(context.explanation).toContain("不把产品事实本身直接判为合规或不合规");
  });
});
