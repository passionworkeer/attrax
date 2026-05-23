import type { GeneratedReportPackage } from "@/lib/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

export function normalizeReportPackage(raw: unknown): GeneratedReportPackage | undefined {
  if (!isRecord(raw)) return undefined;

  const rawProfit = raw.profitReport ?? raw.profit_report;
  const profitRecord =
    typeof rawProfit === "string"
      ? { markdown: rawProfit }
      : isRecord(rawProfit)
      ? rawProfit
      : undefined;

  const rawRoadmap = isRecord(raw.roadmap) ? raw.roadmap : undefined;
  const rawRoadmapItems = Array.isArray(rawRoadmap?.items) ? rawRoadmap.items : undefined;

  const rawDecision = raw.decisionView ?? raw.decision_view;
  const decisionRecord = isRecord(rawDecision) ? rawDecision : undefined;
  const rawDecisionNodes = Array.isArray(decisionRecord?.nodes) ? decisionRecord.nodes : undefined;
  const rawEvidenceBundles = raw.evidenceBundles ?? raw.evidence_bundles;
  const rawEvidenceBundle = raw.evidenceBundle ?? raw.evidence_bundle;

  return {
    productDossier: isRecord(raw.productDossier)
      ? raw.productDossier
      : isRecord(raw.product_dossier)
      ? raw.product_dossier
      : undefined,
    evidenceBundles: isRecord(rawEvidenceBundles)
      ? rawEvidenceBundles
      : isRecord(rawEvidenceBundle)
      ? rawEvidenceBundle
      : undefined,
    evidenceBundle: isRecord(raw.evidenceBundle)
      ? raw.evidenceBundle
      : isRecord(raw.evidence_bundle)
      ? raw.evidence_bundle
      : undefined,
    auditMetadata: isRecord(raw.auditMetadata)
      ? raw.auditMetadata
      : isRecord(raw.audit_metadata)
      ? raw.audit_metadata
      : undefined,
    complianceReport:
      typeof raw.complianceReport === "string"
        ? raw.complianceReport
        : typeof raw.compliance_report === "string"
        ? raw.compliance_report
        : undefined,
    profitReport: profitRecord
      ? {
          markdown: typeof profitRecord.markdown === "string" ? profitRecord.markdown : undefined,
          keyConclusion:
            typeof profitRecord.keyConclusion === "string"
              ? profitRecord.keyConclusion
              : typeof profitRecord.key_conclusion === "string"
              ? profitRecord.key_conclusion
              : undefined,
          premiumPct:
            typeof profitRecord.premiumPct === "string"
              ? profitRecord.premiumPct
              : typeof profitRecord.premium_pct === "string"
              ? profitRecord.premium_pct
              : undefined,
          breakevenUnits:
            typeof profitRecord.breakevenUnits === "string"
              ? profitRecord.breakevenUnits
              : typeof profitRecord.breakeven_units === "string"
              ? profitRecord.breakeven_units
              : undefined,
          pricingStrategy:
            typeof profitRecord.pricingStrategy === "string"
              ? profitRecord.pricingStrategy
              : typeof profitRecord.pricing_strategy === "string"
              ? profitRecord.pricing_strategy
              : undefined,
          riskNote:
            typeof profitRecord.riskNote === "string"
              ? profitRecord.riskNote
              : typeof profitRecord.risk_note === "string"
              ? profitRecord.risk_note
              : undefined,
          conclusions: typeof profitRecord.conclusions === "string" ? profitRecord.conclusions : undefined,
          references: typeof profitRecord.references === "string" ? profitRecord.references : undefined,
        }
      : undefined,
    roadmap: rawRoadmap
      ? {
          totalDays:
            typeof rawRoadmap.totalDays === "number"
              ? rawRoadmap.totalDays
              : typeof rawRoadmap.total_days === "number"
              ? rawRoadmap.total_days
              : undefined,
          totalCost:
            typeof rawRoadmap.totalCost === "string"
              ? rawRoadmap.totalCost
              : typeof rawRoadmap.total_cost === "string"
              ? rawRoadmap.total_cost
              : undefined,
          progress: typeof rawRoadmap.progress === "number" ? rawRoadmap.progress : undefined,
          items: rawRoadmapItems
            ?.filter(isRecord)
            .map((item) => ({
              id: typeof item.id === "string" || typeof item.id === "number" ? String(item.id) : undefined,
              date: typeof item.date === "string" ? item.date : undefined,
              title: typeof item.title === "string" ? item.title : undefined,
              titleEn:
                typeof item.titleEn === "string"
                  ? item.titleEn
                  : typeof item.title_en === "string"
                  ? item.title_en
                  : undefined,
              description: typeof item.description === "string" ? item.description : undefined,
              descriptionEn:
                typeof item.descriptionEn === "string"
                  ? item.descriptionEn
                  : typeof item.description_en === "string"
                  ? item.description_en
                  : undefined,
              type: item.type as "apply" | "test" | "certify" | "complete" | undefined,
              status: item.status as "pending" | "in-progress" | "completed" | undefined,
              estimatedDays:
                typeof item.estimatedDays === "number"
                  ? item.estimatedDays
                  : typeof item.estimated_days === "number"
                  ? item.estimated_days
                  : undefined,
              cost: typeof item.cost === "string" ? item.cost : undefined,
              documents: normalizeStringArray(item.documents),
              documentsEn: normalizeStringArray(item.documentsEn ?? item.documents_en),
            })),
        }
      : undefined,
    decisionView: decisionRecord
      ? {
          summary: typeof decisionRecord.summary === "string" ? decisionRecord.summary : undefined,
          keyFindings: normalizeStringArray(decisionRecord.keyFindings ?? decisionRecord.key_findings),
          recommendedAction:
            typeof decisionRecord.recommendedAction === "string"
              ? decisionRecord.recommendedAction
              : typeof decisionRecord.recommended_action === "string"
              ? decisionRecord.recommended_action
              : undefined,
          nodes: rawDecisionNodes
            ?.filter(isRecord)
            .map((node) => ({
              id: typeof node.id === "string" || typeof node.id === "number" ? String(node.id) : undefined,
              type: typeof node.type === "string" ? node.type : undefined,
              label: typeof node.label === "string" ? node.label : undefined,
              labelEn:
                typeof node.labelEn === "string"
                  ? node.labelEn
                  : typeof node.label_en === "string"
                  ? node.label_en
                  : undefined,
              icon: typeof node.icon === "string" ? node.icon : undefined,
              status: typeof node.status === "string" ? node.status : undefined,
              duration: typeof node.duration === "string" ? node.duration : undefined,
              confidence: typeof node.confidence === "number" ? node.confidence : undefined,
              reasoning: typeof node.reasoning === "string" ? node.reasoning : undefined,
              reasoningEn:
                typeof node.reasoningEn === "string"
                  ? node.reasoningEn
                  : typeof node.reasoning_en === "string"
                  ? node.reasoning_en
                  : undefined,
            })),
        }
      : undefined,
  };
}
