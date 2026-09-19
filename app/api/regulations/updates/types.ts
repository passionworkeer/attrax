export type RiskLevel = "critical" | "high" | "medium" | "low";
export type ChangeType = "new" | "revision" | "enforcement" | "consultation";

export interface RegulationUpdate {
  id: string;
  market: string;
  title: string;
  titleEn: string;
  publishDate: string;
  effectiveDate: string;
  affectedCategories: string[];
  affectedCategoriesEn: string[];
  summary: string;
  summaryEn: string;
  sourceAgency: string;
  sourceAgencyEn: string;
  sourceUrl: string;
  riskLevel: RiskLevel;
  changeType: ChangeType;
  status: string;
  statusEn: string;
  businessImpact: string;
  businessImpactEn: string;
  requirements: string[];
  requirementsEn: string[];
  recommendedActions: string[];
  recommendedActionsEn: string[];
  lastVerifiedAt: string;
  // Added by the route via `enrichRegulation`. Optional on the type so
  // the watchdog pipeline (which synthesises an effectiveDate but does
  // not compute the window) can omit it without lying about the field.
  daysUntilEffective?: number;
}
