/**
 * Red-team tests for computeEvidenceCoverage (plan 2026-09-14 §4.4 layer 2,
 * J05). The exact adversarial constructions called out in the review:
 *
 *   a. 19 completely identical citations → totalCitations must be 1
 *   b. fallback_article_only → matchedCitations must NOT include it
 *   c. all citations unverified → ratio must be 0 (never 100%)
 */
import { describe, expect, it } from "vitest";
import { computeEvidenceCoverage } from "@/lib/result-view-helpers";
import type { RiskPoint, ScanResult } from "@/lib/types";

function risk(overrides: Partial<RiskPoint>): RiskPoint {
  return {
    riskId: overrides.riskId ?? "risk-1",
    title: overrides.title ?? "t",
    severity: overrides.severity ?? "warning",
    confidence: overrides.confidence ?? 0.8,
    imageId: overrides.imageId,
    bbox: overrides.bbox ?? { x: 0, y: 0, w: 0, h: 0 },
    regulations: overrides.regulations ?? [],
    recommendedAction: overrides.recommendedAction ?? "",
    ...overrides,
  } as RiskPoint;
}

function groundedRisk(id: string): RiskPoint {
  return risk({
    riskId: id,
    bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
    regulations: [{ regId: "r", code: "c", name: "n", market: "EU", summary: "", sourceUrl: "#" }],
  });
}

describe("computeEvidenceCoverage — adversarial (J05)", () => {
  it("19 completely identical citations collapse to totalCitations=1 (audit case B)", () => {
    // Every field identical: the de-dup key (doc_id|article_id|quote|span)
    // must merge all 19 raw entries AND the evidencePack twin into ONE.
    const identical = {
      doc_id: "EU-2009-48",
      article_id: "art-10",
      official_citation: "Directive 2009/48/EC",
      quote: "同一引文文本",
      quote_span: [12, 30] as [number, number],
      match_status: "fallback_article_only",
    };
    const result = {
      riskPoints: [groundedRisk("r1")],
      reportPackage: {
        citations: Array.from({ length: 19 }, () => ({ ...identical })),
        evidencePack: [identical],
      },
    } as unknown as ScanResult;

    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(1);
    expect(coverage.distinctRegulationsCount).toBe(1);
  });

  it("fallback_article_only is never counted in matchedCitations (已对照原文 must stay false)", () => {
    const result = {
      riskPoints: [groundedRisk("r1")],
      reportPackage: {
        citations: [
          { doc_id: "EU-2009-48", article_id: "art-11", quote: "警告语要求摘要", match_status: "fallback_article_only" },
          { doc_id: "EU-2009-48", article_id: "art-11", quote: "", match_status: "fallback_article_only" },
        ],
      },
    } as unknown as ScanResult;

    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(2);
    expect(coverage.articleLocatedCount).toBe(2);
    expect(coverage.matchedCitations).toBe(0);
    expect(coverage.verbatimMatchedCount).toBe(0);
  });

  it("all-unverified citations keep the finding coverage ratio at 0, never 100%", () => {
    // One finding with no grounding (no bbox), two DISTINCT citations missing
    // their match_status entirely (J05: missing status ≠ matched). The old
    // code path could render this as "100% 已对照原文" via 0/0 or via counting
    // the missing-status entries as matched.
    const result = {
      riskPoints: [risk({ riskId: "r1", regulations: [{ regId: "x", code: "x", name: "x", market: "EU", summary: "", sourceUrl: "#" }] })],
      reportPackage: {
        citations: [
          { doc_id: "EU-2023-1542", article_id: "art-13", quote: "电池要求" },
          { doc_id: "EU-2023-1542", article_id: "art-77", quote: "护照要求" },
        ],
      },
    } as unknown as ScanResult;

    const coverage = computeEvidenceCoverage(result);
    expect(coverage.ratio).toBe(0);
    expect(coverage.status).toBe("minimal");
    expect(coverage.matchedCitations).toBe(0);
    // Both entries have no status → unmatched pool, never matched.
    expect(coverage.unmatchedCitations).toBe(2);
    expect(coverage.verbatimMatchedCount).toBe(0);
  });

  it("a vacuous matched status with an empty quote does not count as verbatim", () => {
    // match_quote() returns a vacuous "matched" for empty quotes; the
    // coverage layer must not launder it into 已对照原文.
    const result = {
      riskPoints: [groundedRisk("r1")],
      reportPackage: {
        citations: [
          { doc_id: "EU-X", article_id: "art-1", quote: "", match_status: "matched" },
        ],
      },
    } as unknown as ScanResult;

    const coverage = computeEvidenceCoverage(result);
    expect(coverage.matchedCitations).toBe(0);
    expect(coverage.verbatimMatchedCount).toBe(0);
    expect(coverage.articleLocatedCount).toBe(0);
    expect(coverage.unmatchedCitations).toBe(1);
  });

  it("empty citation set with grounded findings never reports 100% matched claims", () => {
    const result = {
      riskPoints: [groundedRisk("r1")],
      reportPackage: { citations: [], evidencePack: [] },
    } as unknown as ScanResult;

    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(0);
    expect(coverage.matchedCitations).toBe(0);
    // ratio is finding-grounding based (bbox) — this finding IS grounded,
    // so ratio can legitimately be 1; but no citation claim may appear.
    expect(coverage.status).toBe("complete");
    expect(coverage.matchedCitations).toBe(0);
    expect(coverage.verbatimMatchedCount).toBe(0);
  });
});
