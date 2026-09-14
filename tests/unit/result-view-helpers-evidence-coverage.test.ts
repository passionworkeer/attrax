import { describe, it, expect } from "vitest";
import { computeEvidenceCoverage } from "@/lib/result-view-helpers";
import type { ScanResult, RiskPoint } from "@/lib/types";

/**
 * Audit 2026-09-13 P0-3: the result page used to render "85%" evidence
 * coverage as a hard-coded constant regardless of scan content. The real
 * coverage has to be derived from the report package: a finding is
 * "covered" when it has at least one citation AND a bbox with non-zero
 * width/height.
 *
 * Audit 2026-09-14 J05 (plan §4.4 layer 2): the citation layer used to
 * concatenate evidencePack + citations (19 entries counted as 38) and
 * treat fallback_article_only as "已对照原文". New contract:
 *   - citations de-duplicated by (doc_id, article_id, quote, span)
 *   - matchedCitations/verbatimMatchedCount = matched + non-empty quote
 *   - articleLocatedCount = fallback_article_only (NOT verbatim-verified)
 *   - empty citation set → no 100%, status stays unknown with ratio 0
 */
describe("computeEvidenceCoverage", () => {
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

  it("returns status 'unknown' when there are no findings", () => {
    const result = { riskPoints: [] } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.status).toBe("unknown");
    expect(coverage.ratio).toBe(0);
    expect(coverage.totalFindings).toBe(0);
  });

  it("classifies every covered finding as 'complete'", () => {
    const result = {
      riskPoints: [
        risk({
          riskId: "r1",
          bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
          regulations: [{ regId: "x", code: "x", name: "x", market: "EU", summary: "", sourceUrl: "#" }],
        }),
        risk({
          riskId: "r2",
          bbox: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          regulations: [{ regId: "y", code: "y", name: "y", market: "EU", summary: "", sourceUrl: "#" }],
        }),
      ],
      reportPackage: { citations: [], evidencePack: [] },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.status).toBe("complete");
    expect(coverage.ratio).toBe(1);
    expect(coverage.coveredFindings).toBe(2);
    expect(coverage.totalFindings).toBe(2);
  });

  it("counts unmatched citations but does not count zero-bbox findings", () => {
    const result = {
      riskPoints: [
        // No bbox, has citation → uncovered (treat bbox as missing evidence)
        risk({ riskId: "r1", regulations: [{ regId: "x", code: "x", name: "x", market: "EU", summary: "", sourceUrl: "#" }] }),
        // Has bbox and citation → covered
        risk({
          riskId: "r2",
          bbox: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 },
          regulations: [{ regId: "y", code: "y", name: "y", market: "EU", summary: "", sourceUrl: "#" }],
        }),
      ],
      reportPackage: {
        evidencePack: [
          { doc_id: "EU-X", article_id: "art-1", quote: "q", matchStatus: "matched" },
          { doc_id: "EU-X", article_id: "art-2", quote: "q2", matchStatus: "unmatched" },
        ],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.status).toBe("partial");
    expect(coverage.coveredFindings).toBe(1);
    expect(coverage.totalFindings).toBe(2);
    expect(coverage.totalCitations).toBe(2);
    expect(coverage.matchedCitations).toBe(1);
    expect(coverage.verbatimMatchedCount).toBe(1);
    expect(coverage.unmatchedCitations).toBe(1);
  });

  it("classifies zero covered findings as 'minimal'", () => {
    const result = {
      riskPoints: [
        risk({ riskId: "r1" }),
        risk({ riskId: "r2", bbox: { x: 0, y: 0, w: 0, h: 0 } }),
      ],
      reportPackage: {},
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.status).toBe("minimal");
    expect(coverage.ratio).toBe(0);
  });

  it("falls back to evidence_pack snake_case key", () => {
    const result = {
      riskPoints: [risk({ riskId: "r1" })],
      reportPackage: {
        evidence_pack: [{ doc_id: "EU-X", article_id: "art-1", quote: "matched text", match_status: "matched" }],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(1);
    expect(coverage.matchedCitations).toBe(1);
  });

  // ── J05 (2026-09-14): evidence-status layering ─────────────────────────

  it("does not double-count citations that appear in both citations and evidencePack", () => {
    // Case B of the audit: 19 citations whose (doc_id, article_id, quote,
    // span) twin entries are also in the deduplicated evidencePack — the
    // old concat made 38. De-duplication must collapse them.
    const citation = {
      doc_id: "EU-2009-48",
      article_id: "art-10",
      quote: "玩具不得危害安全",
      quote_span: [10, 20] as [number, number],
      match_status: "fallback_article_only",
    };
    const result = {
      riskPoints: [risk({ riskId: "r1" })],
      reportPackage: {
        citations: [citation, { ...citation }],
        evidencePack: [citation],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(1);
    expect(coverage.articleLocatedCount).toBe(1);
    expect(coverage.matchedCitations).toBe(0);
  });

  it("keeps distinct quotes of the same article as separate citations", () => {
    // Same article, genuinely different quotes → two verifiable claims.
    const result = {
      riskPoints: [risk({ riskId: "r1" })],
      reportPackage: {
        citations: [
          { doc_id: "EU-X", article_id: "art-1", quote: "first distinct quote", match_status: "matched" },
          { doc_id: "EU-X", article_id: "art-1", quote: "second distinct quote", match_status: "fallback_article_only" },
        ],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(2);
    expect(coverage.verbatimMatchedCount).toBe(1);
    expect(coverage.articleLocatedCount).toBe(1);
    expect(coverage.distinctRegulationsCount).toBe(1);
  });

  it("treats fallback_article_only as located-but-not-verbatim, never as matched", () => {
    // The audit's exact failure mode: all citations were fallback (quote
    // empty, provenance llm_paraphrase_unverified) yet the page claimed
    // "已对照原文". fallback must land in articleLocatedCount only.
    const result = {
      riskPoints: [risk({ riskId: "r1" })],
      reportPackage: {
        citations: [
          { doc_id: "EU-2023-1542", article_id: "art-77", quote: "", match_status: "fallback_article_only" },
          { doc_id: "EU-2023-1542", article_id: "art-13", quote: "paraphrase not in source", match_status: "fallback_article_only" },
        ],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(2);
    expect(coverage.articleLocatedCount).toBe(2);
    expect(coverage.matchedCitations).toBe(0);
    expect(coverage.verbatimMatchedCount).toBe(0);
    expect(coverage.unmatchedCitations).toBe(0);
  });

  it("requires a non-empty quote for a citation to count as verbatim matched", () => {
    // match_quote() returns a vacuous "matched" for empty quotes on a real
    // article; the coverage layer must not count vacuous matches as
    // verbatim verification.
    const result = {
      riskPoints: [risk({ riskId: "r1" })],
      reportPackage: {
        citations: [
          { doc_id: "EU-X", article_id: "art-1", quote: "", match_status: "matched" },
          { doc_id: "EU-X", article_id: "art-2", quote: "real verbatim quote", match_status: "matched" },
        ],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.verbatimMatchedCount).toBe(1);
    expect(coverage.matchedCitations).toBe(1);
    // The vacuous match is neither verbatim-verified nor article-located
    // by fallback semantics — it falls into the unmatched remainder.
    expect(coverage.unmatchedCitations).toBe(1);
  });

  it("counts unmatched and missing-status citations as unmatched", () => {
    const result = {
      riskPoints: [risk({ riskId: "r1" })],
      reportPackage: {
        citations: [
          { doc_id: "EU-X", article_id: "art-1", quote: "q", match_status: "unmatched" },
          { doc_id: "EU-X", article_id: "art-2", quote: "q" },
        ],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(2);
    expect(coverage.unmatchedCitations).toBe(2);
    expect(coverage.matchedCitations).toBe(0);
    expect(coverage.articleLocatedCount).toBe(0);
  });

  it("ignores citation entries without a doc_id (cannot link to any regulation)", () => {
    const result = {
      riskPoints: [risk({ riskId: "r1" })],
      reportPackage: {
        citations: [
          { article_id: "art-1", quote: "q", match_status: "matched" },
          { doc_id: "EU-X", article_id: "art-1", quote: "q", match_status: "matched" },
        ],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(1);
    expect(coverage.distinctRegulationsCount).toBe(1);
  });

  it("never reports 100% or a matched claim when the citation set is empty", () => {
    // 分母为 0：空 citations 不得显示 100%（coverageLabel 的兜底由结果页
    // 渲染；此处保证数据契约 ratio=0、status=unknown、matched=0）。
    const result = {
      riskPoints: [risk({ riskId: "r1" })],
      reportPackage: { citations: [], evidencePack: [] },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(0);
    expect(coverage.matchedCitations).toBe(0);
    expect(coverage.verbatimMatchedCount).toBe(0);
    // Findings exist but nothing to verify citations against → ratio is
    // derived from finding grounding (bbox), NOT from citations; and the
    // citation denominator is 0 so no 0/0 → 100% is possible.
    expect(coverage.status).toBe("minimal");
    expect(coverage.ratio).toBe(0);
  });

  it("keeps status 'unknown' with ratio 0 when there are no findings, even with citations present", () => {
    const result = {
      riskPoints: [],
      reportPackage: {
        citations: [{ doc_id: "EU-X", article_id: "art-1", quote: "q", match_status: "matched" }],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.status).toBe("unknown");
    expect(coverage.ratio).toBe(0);
    expect(coverage.totalCitations).toBe(1);
    expect(coverage.matchedCitations).toBe(1);
  });
});
