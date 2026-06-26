import type { RegulationUpdate, RiskLevel } from "./types";

export const riskRank: Record<RiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const searchableText = (regulation: RegulationUpdate) =>
  [
    regulation.market,
    regulation.title,
    regulation.titleEn,
    regulation.summary,
    regulation.summaryEn,
    regulation.sourceAgency,
    regulation.sourceAgencyEn,
    regulation.status,
    regulation.statusEn,
    regulation.businessImpact,
    regulation.businessImpactEn,
    ...regulation.affectedCategories,
    ...regulation.affectedCategoriesEn,
    ...regulation.requirements,
    ...regulation.requirementsEn,
    ...regulation.recommendedActions,
    ...regulation.recommendedActionsEn,
  ]
    .join(" ")
    .toLowerCase();

export const daysUntil = (date: string, now = Date.now()) =>
  Math.ceil((new Date(date).getTime() - now) / (1000 * 60 * 60 * 24));

export const enrichRegulation = (regulation: RegulationUpdate) => ({
  ...regulation,
  daysUntilEffective: daysUntil(regulation.effectiveDate),
});
