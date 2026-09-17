/**
 * Regression tests for the deterministic evidence-based compliance score
 * (v1-result-adapter, evidenceScore — 2026-09-17).
 *
 * Adversarial-eval finding this guards against: every production scan graded
 * 65/C because the coarse rollup mapped both HIGH and MEDIUM LLM riskLevel to
 * "warning". The score must now come from the server-built (deterministic)
 * findings, NOT from LLM-assigned riskLevel.
 *
 * Formula: 100 − 22·critical − 14·high − 8·medium − 3·low (clamp 0–100);
 * any pending decisionView node caps the score at 84 (an open evidence
 * chain must not grade A). Grades: A≥85 / B≥70 / C≥55 / D<55.
 */
import { describe, expect, it } from "vitest";
import { normalizeV1ScanResult } from "@/lib/rag-client/v1-result-adapter";
import type { V1SessionData } from "@/lib/rag-client/v1-adapter";

function finding(
  severity: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    findingId: `f-${severity}-${Math.random().toString(36).slice(2, 6)}`,
    checkId: "check-nameplate",
    title: "铭牌信息",
    assessment: "evidence_needed",
    severity,
    applicability: "applicable",
    suggestedAction: "补充铭牌近照",
    ...overrides,
  };
}

function session(
  findings: Record<string, unknown>[],
  decisionNodes: Array<Record<string, unknown>> = [],
  extraResult: Record<string, unknown> = {},
): V1SessionData {
  return {
    sessionId: "scan_score1",
    status: "ready",
    progress: 100,
    stageText: "complete",
    category: "electronics",
    markets: ["EU"],
    createdAt: "2026-09-17T08:00:00Z",
    updatedAt: "2026-09-17T08:01:00Z",
    assets: [],
    result: {
      sessionId: "scan_score1",
      productCategory: "electronics",
      targetMarkets: ["EU"],
      retrievedChunks: [],
      reportPackage: {
        findings,
        decisionView: { nodes: decisionNodes },
        roadmap: { items: [] },
        auditMetadata: { provider: "minimax", generatedAt: "2026-09-17T08:01:00Z" },
      },
      ...extraResult,
    },
    error: null,
  } as unknown as V1SessionData;
}

describe("evidence-based compliance score (deterministic formula)", () => {
  it("single severity deductions: critical −22, high −14, medium −8, low −3", () => {
    expect(normalizeV1ScanResult(session([finding("critical")]))?.complianceScore).toBe(78);
    expect(normalizeV1ScanResult(session([finding("high")]))?.complianceScore).toBe(86);
    expect(normalizeV1ScanResult(session([finding("medium")]))?.complianceScore).toBe(92);
    expect(normalizeV1ScanResult(session([finding("low")]))?.complianceScore).toBe(97);
  });

  it("unknown severity does not deduct (the scan did not claim a problem)", () => {
    const result = normalizeV1ScanResult(session([finding("unknown")]));
    expect(result?.complianceScore).toBe(100);
    expect(result?.scoreGrade).toBe("A");
  });

  it("severity is case-insensitive", () => {
    expect(
      normalizeV1ScanResult(session([finding("CRITICAL")]))?.complianceScore,
    ).toBe(78);
  });

  it("real electronics shape (1 medium + 6 low) scores 74/B", () => {
    const findings = [finding("medium"), ...Array.from({ length: 6 }, () => finding("low"))];
    const result = normalizeV1ScanResult(session(findings));
    expect(result?.complianceScore).toBe(74);
    expect(result?.scoreGrade).toBe("B");
  });

  it("real toy shape (5 low + 1 pending decision node) caps at 84/B", () => {
    const findings = Array.from({ length: 5 }, () => finding("low"));
    const result = normalizeV1ScanResult(session(findings, [
      { id: "n1", status: "success" },
      { id: "n2", status: "pending" },
    ]));
    // 100 − 15 = 85 would be A, but the pending evidence gap caps at 84.
    expect(result?.complianceScore).toBe(84);
    expect(result?.scoreGrade).toBe("B");
  });

  it("clamps at 0 when deductions exceed 100", () => {
    const findings = Array.from({ length: 5 }, () => finding("critical"));
    const result = normalizeV1ScanResult(session(findings));
    expect(result?.complianceScore).toBe(0);
    expect(result?.scoreGrade).toBe("D");
  });

  it("grade boundaries: 55→C, 54→D, 70→B, 85→A", () => {
    // 100 − (22 + 14 + 3×3) = 55 → C
    const c = normalizeV1ScanResult(
      session([finding("critical"), finding("high"), finding("low"), finding("low"), finding("low")]),
    );
    expect(c?.complianceScore).toBe(55);
    expect(c?.scoreGrade).toBe("C");

    // 100 − (22 + 8×3) = 54 → D
    const d = normalizeV1ScanResult(
      session([finding("critical"), finding("medium"), finding("medium"), finding("medium")]),
    );
    expect(d?.complianceScore).toBe(54);
    expect(d?.scoreGrade).toBe("D");

    // 100 − 10×3 = 70 → B
    const b = normalizeV1ScanResult(session(Array.from({ length: 10 }, () => finding("low"))));
    expect(b?.complianceScore).toBe(70);
    expect(b?.scoreGrade).toBe("B");

    // 100 − 5×3 = 85 → A
    const a = normalizeV1ScanResult(session(Array.from({ length: 5 }, () => finding("low"))));
    expect(a?.complianceScore).toBe(85);
    expect(a?.scoreGrade).toBe("A");
  });

  it("REGRESSION: LLM riskLevel must NOT override the evidence score", () => {
    // Adversarial-eval root cause: decisionView.riskLevel=HIGH forced every
    // scan to 65/C. With deterministic findings present, the LLM field is
    // display-only.
    const result = normalizeV1ScanResult(
      session([finding("low"), finding("low")], [
        { id: "n1", status: "success" },
      ], {}),
    );
    // Force HIGH via a separate decisionView field on the package.
    const withHighRisk = normalizeV1ScanResult({
      ...session([finding("low"), finding("low")]),
      result: {
        ...session([finding("low"), finding("low")]).result,
        reportPackage: {
          findings: [finding("low"), finding("low")],
          decisionView: {
            riskLevel: "HIGH",
            nodes: [{ id: "n1", status: "success" }],
          },
          roadmap: { items: [] },
          auditMetadata: { provider: "minimax", generatedAt: "2026-09-17T08:01:00Z" },
        },
      },
    } as unknown as V1SessionData);
    expect(withHighRisk?.complianceScore).toBe(94);
    expect(withHighRisk?.complianceScore).not.toBe(65);
    expect(result?.complianceScore).toBe(94);
  });

  it("non-issue assessments (resolved/no_issue) do not deduct; falls back to legacy 90/A", () => {
    const findings = [
      finding("critical", { assessment: "resolved" }),
      finding("high", { assessment: "no_issue" }),
    ];
    const result = normalizeV1ScanResult(session(findings));
    // All findings filtered out → evidenceFindings empty → legacy rollup
    // (no status/riskLevel → "info" 90/A). The critical/high severities of
    // non-issue findings must not leak into the score either way.
    expect(result?.complianceScore).toBe(90);
    expect(result?.complianceScore).toBeGreaterThanOrEqual(90);
    expect(result?.scoreGrade).toBe("A");
  });

  it("mixed assessments: only suspected_issue/evidence_needed/confirmed_issue deduct", () => {
    const findings = [
      finding("medium", { assessment: "evidence_needed" }),
      finding("critical", { assessment: "confirmed_issue" }),
      finding("high", { assessment: "suspected_issue" }),
      finding("critical", { assessment: "resolved" }),
    ];
    // 100 − 8 − 22 − 14 = 56 → C
    const result = normalizeV1ScanResult(session(findings));
    expect(result?.complianceScore).toBe(56);
    expect(result?.scoreGrade).toBe("C");
  });
});

describe("legacy score fallback (no findings — demo/legacy shapes unchanged)", () => {
  it("decisionView-only rollup still maps warning → 65/C", () => {
    const result = normalizeV1ScanResult(session([], [
      {
        id: "risk-label",
        label: "铭牌信息不完整",
        reasoning: "输入输出参数缺失",
        severity: "medium",
        status: "warning",
        confidence: 0.86,
      },
    ]));
    expect(result?.complianceScore).toBe(65);
    expect(result?.scoreGrade).toBe("C");
  });

  it("HIGH riskLevel without findings still follows the coarse rollup (65/C)", () => {
    const result = normalizeV1ScanResult(session([], [
      { id: "n1", status: "warning", severity: "medium" },
    ], {}));
    void result;
    // Build via riskLevel directly on the package decisionView.
    const withRisk = normalizeV1ScanResult({
      ...session([]),
      result: {
        ...session([]).result,
        reportPackage: {
          findings: [],
          decisionView: { riskLevel: "HIGH", nodes: [] },
          roadmap: { items: [] },
          auditMetadata: { provider: "minimax", generatedAt: "2026-09-17T08:01:00Z" },
        },
      },
    } as unknown as V1SessionData);
    expect(withRisk?.complianceScore).toBe(65);
  });
});
