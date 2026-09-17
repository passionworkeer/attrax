import type { buildReview } from "./review-model";
import type { ComplianceReportResult, ScoreGrade } from "@/lib/types";

// These checks describe identity/appearance, not a legal conformity test.
const FACT_CHECKS = new Set([
  "toy.age_range.label",
  "common.brand_model.visible", "common.nameplate.readability", "common.product.overview",
  "common.certification_marks.visible", "electronics.marks.certification_region",
  "common.warning_text.language", "common.packaging.info",
  "common.defects.visible",
  "electronics.interface.plug_pins", "3c.ports.visible",
]);

const LIMITED_VISUAL_CHECKS = new Set([
  "toy.small_parts.visible",
  "toy.magnets_cords.visible",
  "toy.sharp_edges.visible",
]);

const FACT_VISIBILITIES = new Set(["present_readable", "absent_in_visible_scope"]);

const FACT_RISK_RELATIONS: Record<string, RegExp> = {
  "toy.age_range.label": /warnings|small_parts/,
  "common.product.overview": /small_parts|magnets_cords|sharp_edges/,
  "common.nameplate.readability": /batch_traceability|traceability/,
  "common.brand_model.visible": /batch_traceability|traceability/,
  "common.certification_marks.visible": /mechanical_physical|chemical_migration|certificat|conformity/,
  "electronics.marks.certification_region": /electrical|certificat|conformity/,
  "common.warning_text.language": /warnings|warning/,
  "common.packaging.info": /warnings|warning|batch_traceability|traceability/,
  "common.defects.visible": /sharp_edges|defects/,
  "electronics.interface.plug_pins": /electrical|plug/,
  "3c.ports.visible": /electrical|port|interface/,
};

/** Equal-weight, evidence-gated score. It is never a probability of approval. */
export function assessReview(review: ReturnType<typeof buildReview>) {
  const rows = review.vm.checks.map((check, index) => {
    const claim = review.claims.find(c => c.checkId === check.checkId);
    const informationOnly = FACT_CHECKS.has(check.checkId);
    const factRecorded = informationOnly && (check.observations || []).some(o =>
      FACT_VISIBILITIES.has(o.visibility) && !!(o.observedText || o.description));
    const limitedVisual = LIMITED_VISUAL_CHECKS.has(check.checkId);
    const verified = !!claim && !claim.verificationIssues.length;
    const decided = !informationOnly && verified && ["supported", "blocked", "not_applicable"].includes(claim.status);
    return {check, claim, decided, informationOnly, factRecorded, limitedVisual, number: String(index + 1).padStart(2, "0")};
  });
  const decided = rows.filter(r => r.decided);
  const scored = decided.filter(r => r.claim?.status !== "not_applicable");
  const supported = scored.filter(r => r.claim?.status === "supported").length;
  const blocked = scored.filter(r => r.claim?.status === "blocked").length;
  const pending = rows.filter(r => !r.decided && !r.factRecorded);
  const regulatory = rows.filter(r => !r.informationOnly);
  const criticalUnknown = pending.some(r => /safety|test|battery_compartment/.test(r.check.checkId));
  const unresolved = regulatory.filter(r => !r.decided);
  const attention = regulatory
    .filter(r => r.claim?.status === "blocked" || !r.decided)
    .sort((a, b) => Number(b.claim?.status === "blocked") - Number(a.claim?.status === "blocked"));
  const applicableCount = regulatory.length - decided.filter(r => r.claim?.status === "not_applicable").length;
  const canAssess = review.scoringEligible && applicableCount > 0;
  const systemIssues = pending.filter(r => r.claim?.verificationIssues.some(issue =>
    ["legal_quote_unverified", "invalid_or_out_of_market_citation", "scope_only_legal_basis", "invalid_document_excerpt", "invalid_observation", "reason_missing"].includes(issue)));
  return {rows, regulatory, decided, pending, supported, blocked, scored: scored.length,
    unresolved, attention, applicableCount, criticalUnknown, systemIssues,
    score: canAssess ? Math.floor(supported / applicableCount * 100) : null};
}

export type ReviewAssessment = ReturnType<typeof assessReview>;
export type FactRiskLevel = "low" | "medium" | "high";
export type FactRiskReason = "blocked" | "unresolved" | "limited_visual" | "none";
export type FactRiskDetail = {
  level: FactRiskLevel;
  reason: FactRiskReason;
  relatedCheckIds: string[];
};

/**
 * Product facts are not compliance verdicts. This badge summarizes the
 * evidence state of related regulatory checks so the user can triage where
 * the identified fact needs attention without relabeling the fact itself as
 * a pass or failure.
 */
export function factRiskLevel(
  row: ReviewAssessment["rows"][number],
  assessment: ReviewAssessment,
): FactRiskLevel {
  return factRiskDetail(row, assessment).level;
}

/**
 * Explain why an identity fact receives a triage badge. The badge is not a
 * conformity verdict for the fact itself; it mirrors the state of related
 * regulatory checks so the user can understand what needs attention next.
 */
export function factRiskDetail(
  row: ReviewAssessment["rows"][number],
  assessment: ReviewAssessment,
): FactRiskDetail {
  const relation = FACT_RISK_RELATIONS[row.check.checkId];
  if (!relation) return { level: "low", reason: "none", relatedCheckIds: [] };
  const related = assessment.regulatory.filter(candidate => relation.test(candidate.check.checkId));
  const blocked = related.filter(candidate => candidate.claim?.status === "blocked" && candidate.decided);
  if (blocked.length) {
    return { level: "high", reason: "blocked", relatedCheckIds: blocked.map(candidate => candidate.check.checkId) };
  }
  const unresolved = related.filter(candidate => !candidate.decided);
  if (unresolved.length) {
    return { level: "medium", reason: "unresolved", relatedCheckIds: unresolved.map(candidate => candidate.check.checkId) };
  }
  const limitedVisual = related.filter(candidate => candidate.limitedVisual);
  if (limitedVisual.length) {
    return { level: "medium", reason: "limited_visual", relatedCheckIds: limitedVisual.map(candidate => candidate.check.checkId) };
  }
  return { level: "low", reason: "none", relatedCheckIds: related.map(candidate => candidate.check.checkId) };
}

function gradeForScore(score: number): ScoreGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

/** Keep the reader and both binary downloads on the same evidence score. */
export function applyReviewAssessment<T extends ComplianceReportResult>(
  report: T,
  assessment: ReturnType<typeof assessReview>,
): T {
  if (assessment.score === null) return report;
  return {
    ...report,
    complianceScore: assessment.score,
    scoreGrade: gradeForScore(assessment.score),
  };
}
