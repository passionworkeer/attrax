import { describe, it, expect } from "vitest";
import { computeEvidenceCoverage } from "@/lib/result-view-helpers";
import type { ScanResult, RiskPoint } from "@/lib/types";

/**
 * Audit 2026-09-13 P0-3: the result page used to render "85%" evidence
 * coverage as a hard-coded constant regardless of scan content. The real
 * coverage has to be derived from the report package: a finding is
 * "covered" when it has at least one citation AND a bbox with non-zero
 * width/height.
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
          { matchStatus: "matched" },
          { matchStatus: "unmatched" },
        ],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.status).toBe("partial");
    expect(coverage.coveredFindings).toBe(1);
    expect(coverage.totalFindings).toBe(2);
    expect(coverage.totalCitations).toBe(2);
    expect(coverage.matchedCitations).toBe(1);
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
        evidence_pack: [{ match_status: "matched" }],
      },
    } as unknown as ScanResult;
    const coverage = computeEvidenceCoverage(result);
    expect(coverage.totalCitations).toBe(1);
    expect(coverage.matchedCitations).toBe(1);
  });
});