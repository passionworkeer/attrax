/**
 * tests/unit/rag-client-report-package.test.ts
 *
 * Contract test: the mock report package produced by
 * `lib/mock/scan-result.ts` must round-trip through the strict
 * `validateReportPackage` Zod schema (which mirrors the Pydantic
 * schema in `rag_service/schemas/report_package.py`).
 *
 * If this test fails:
 *   - Either the mock added/removed a field that the backend won't emit
 *   - Or the Pydantic schema changed and `lib/rag-client/report-package-schema.ts`
 *     is out of sync
 *
 * Both should be fixed by editing the schema, not the test.
 */
import { describe, expect, it } from "vitest";
import { createMockComplianceReportResult } from "@/lib/mock/scan-result";
import { validateReportPackage } from "@/lib/rag-client";

describe("mock report package contract", () => {
  it("validateReportPackage accepts the compliance-report mock", () => {
    const mockResult = createMockComplianceReportResult("test-session");
    expect(mockResult.reportPackage).toBeDefined();
    const outcome = validateReportPackage(mockResult.reportPackage);
    if (!outcome.ok) {
      // Surface the exact reason on failure so the test output is actionable.
      throw new Error(`validateReportPackage rejected mock:\n${outcome.errors.join("\n")}`);
    }
    expect(outcome.data).not.toBeNull();
  });

  it("required core fields are present after validation", () => {
    const mockResult = createMockComplianceReportResult("test-session");
    const outcome = validateReportPackage(mockResult.reportPackage);
    expect(outcome.ok).toBe(true);
    const pkg = outcome.data!;
    expect(pkg.complianceReport.length).toBeGreaterThan(0);
    expect(pkg.auditMetadata.schemaVersion).toBe("report-package/v1");
    expect(pkg.auditMetadata.generatedAt.length).toBeGreaterThan(0);
    expect(pkg.auditMetadata.provider).toBe("mock");
    expect(pkg.productDossier.markets).toContain("EU");
    expect(pkg.evidenceBundles.visual.length).toBeGreaterThan(0);
    expect(pkg.evidenceBundles.retrieval.length).toBeGreaterThan(0);
  });

  it("decision verdict/riskLevel live on decisionView top level, nodes carry severity", () => {
    // verdict / riskLevel are first-class on decisionView (frontend schema
    // 9c6a76f promoted them; the real backend emits them at top level too).
    // Each node carries its own `severity` (critical/high/medium/info). The
    // previous assertion expected them on nodes[*].metadata, which the UI
    // normalizer never reads — that direction was wrong.
    const mockResult = createMockComplianceReportResult("test-session");
    const outcome = validateReportPackage(mockResult.reportPackage);
    expect(outcome.ok).toBe(true);
    const dv = outcome.data!.decisionView;
    expect(dv.verdict).toBe("REJECTED");
    expect(dv.riskLevel).toBe("HIGH");
    const visionNode = dv.nodes.find((n) => n.id === "vision");
    expect(visionNode).toBeDefined();
    expect(visionNode?.severity).toBe("high");
  });
});

describe("validateReportPackage rejects malformed input", () => {
  it("rejects empty complianceReport", () => {
    const broken = {
      complianceReport: "",
      profitReport: { markdown: "x" },
      roadmap: { totalDays: 0, totalCost: "", progress: 0, items: [] },
      decisionView: { summary: "", keyFindings: [], recommendedAction: "", nodes: [] },
      evidenceBundles: { visual: [], retrieval: [], generation: [] },
      auditMetadata: { generatedAt: "2026-07-14T00:00:00Z" },
    };
    const outcome = validateReportPackage(broken);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.some((e) => e.includes("complianceReport"))).toBe(true);
  });

  it("rejects missing generatedAt", () => {
    const broken = {
      complianceReport: "ok",
      profitReport: { markdown: "x" },
      roadmap: { totalDays: 0, totalCost: "", progress: 0, items: [] },
      decisionView: { summary: "", keyFindings: [], recommendedAction: "", nodes: [] },
      evidenceBundles: { visual: [], retrieval: [], generation: [] },
      auditMetadata: {},
    };
    const outcome = validateReportPackage(broken);
    expect(outcome.ok).toBe(false);
    expect(outcome.errors.some((e) => e.includes("generatedAt"))).toBe(true);
  });
});
