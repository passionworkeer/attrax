import type {
  ChecklistItem,
  ComplianceReportResult,
  ProfitReportResult,
  RegulationRef,
  RiskPoint,
  ScanResult,
} from "@/lib/types";

type ReportLocale = "zh" | "en";

const HAN_TEXT_RE = /\p{Script=Han}/u;

function isEnglish(locale?: ReportLocale): boolean {
  return locale === "en";
}

export function containsHan(value: string | null | undefined): boolean {
  return HAN_TEXT_RE.test(value ?? "");
}

function normalizeEnglishSymbols(value: string): string {
  return value
    .replace(/¥\s*/g, "CNY ")
    .replace(/\s+/g, " ")
    .trim();
}

export function englishText(value: string | null | undefined, fallback = "TBD"): string {
  if (typeof value !== "string") return fallback;
  const normalized = normalizeEnglishSymbols(value);
  if (!normalized || containsHan(normalized)) return fallback;
  return normalized;
}

export function englishArray(values: string[] | undefined, fallback: string[] = ["TBD"]): string[] {
  const safeValues = (values ?? [])
    .map((value) => englishText(value, ""))
    .filter((value) => value.length > 0);
  return safeValues.length ? safeValues : fallback;
}

function pickLocalized(primary: string, localized: string | undefined, locale?: ReportLocale, fallback = "TBD"): string {
  if (!isEnglish(locale)) return primary;
  const safeLocalized = englishText(localized, "");
  if (safeLocalized) return safeLocalized;
  return englishText(primary, fallback);
}

function englishComplianceReportFallback(result: ComplianceReportResult): string {
  const product = englishText(result.productNameEn ?? result.productName, "this product");
  const markets = result.targetMarkets.length ? result.targetMarkets.join(", ") : "target markets";
  const evidenceCount = result.retrievedChunks.length;
  return [
    `## Compliance Analysis Report: ${product}`,
    "",
    `Overall status: ${result.complianceStatus}. Overall score: ${result.complianceScore}/100.`,
    "",
    `Target markets: ${markets}. Retrieved evidence records: ${evidenceCount}.`,
    "",
    "### Required Review",
    "",
    "- Confirm product label, model, manufacturer, importer or responsible-party information, and batch traceability.",
    "- Complete the technical file, declaration documents, test reports, and marketplace evidence package before launch.",
    "- Re-run the assessment after any material, supplier, labeling, firmware, packaging, or target-market change.",
  ].join("\n");
}

function englishProfitReportFallback(result: ProfitReportResult): string {
  const product = englishText(result.productTypeEn ?? result.productType, "this product");
  const market = englishText(result.marketEn ?? result.market, "target market");
  const conclusion = englishText(
    result.keyConclusionEn ?? result.keyConclusion,
    "Review the compliant scenario against certification cost, margin, and residual risk before launch.",
  );
  return [
    `## Cost and Profit Analysis: ${product}`,
    "",
    `Market: ${market}. Currency: ${result.currency ?? "CNY"}.`,
    "",
    "| Scenario | Gross Profit Margin | Net Income | Risk Exposure |",
    "| --- | --- | --- | --- |",
    `| Barebone | ${result.bareboneGpm ?? "TBD"}% | ${result.barebone.gp ?? "TBD"} | ${result.bareboneRiskExposure ?? "TBD"} |`,
    `| Compliant | ${result.compliantGpm ?? "TBD"}% | ${result.compliant.gp ?? "TBD"} | ${result.compliantRiskExposure ?? "TBD"} |`,
    "",
    "### Conclusion",
    "",
    conclusion,
  ].join("\n");
}

function localizeRegulation(regulation: RegulationRef, locale?: ReportLocale): RegulationRef {
  if (!isEnglish(locale)) return regulation;
  return {
    ...regulation,
    name: pickLocalized(regulation.name, regulation.nameEn, locale, regulation.code || "Regulation document"),
    summary: pickLocalized(regulation.summary, regulation.summaryEn, locale, "Summary pending"),
  };
}

function localizeRiskPoint(risk: RiskPoint, locale?: ReportLocale): RiskPoint {
  if (!isEnglish(locale)) return risk;
  return {
    ...risk,
    title: pickLocalized(risk.title, risk.titleEn, locale, "Risk item"),
    description: pickLocalized(risk.description, risk.descriptionEn, locale, "Risk description pending"),
    regulations: risk.regulations.map((regulation) => localizeRegulation(regulation, locale)),
    recommendedAction: pickLocalized(risk.recommendedAction, risk.recommendedActionEn, locale, "Action plan pending"),
  };
}

function localizeChecklistItem(item: ChecklistItem, locale?: ReportLocale): ChecklistItem {
  if (!isEnglish(locale)) return item;
  return {
    ...item,
    category: pickLocalized(item.category, item.categoryEn, locale, "Checklist"),
    title: pickLocalized(item.title, item.titleEn, locale, "Checklist item"),
    requiredMaterials: englishArray(item.requiredMaterialsEn ?? item.requiredMaterials, ["Required material TBD"]),
    recommendedLab: item.recommendedLab
      ? pickLocalized(item.recommendedLab, item.recommendedLabEn, locale, "Lab TBD")
      : item.recommendedLabEn,
    estimatedTime: item.estimatedTime
      ? pickLocalized(item.estimatedTime, item.estimatedTimeEn, locale, "Timeline TBD")
      : item.estimatedTimeEn,
  };
}

export function localizeScanResult(result: ScanResult, locale?: ReportLocale): ScanResult {
  if (!isEnglish(locale)) return result;
  return {
    ...result,
    productName: result.productName
      ? pickLocalized(result.productName, result.productNameEn, locale, "this product")
      : result.productNameEn,
    documents: result.documents.map((document) => ({
      ...document,
      name: pickLocalized(document.name, document.nameEn, locale, "Source file"),
    })),
    riskPoints: result.riskPoints.map((risk) => localizeRiskPoint(risk, locale)),
    checklist: result.checklist.map((item) => localizeChecklistItem(item, locale)),
  };
}

export function localizeComplianceReportResult(
  result: ComplianceReportResult,
  locale?: ReportLocale,
): ComplianceReportResult {
  if (!isEnglish(locale)) return result;
  const reportPackage = result.reportPackage ?? (result as ComplianceReportResult & { report_package?: typeof result.reportPackage }).report_package;
  const complianceReportEn =
    result.complianceReportEn ??
    reportPackage?.complianceReportEn ??
    reportPackage?.compliance_report_en;

  return {
    ...result,
    productName: result.productName
      ? pickLocalized(result.productName, result.productNameEn, locale, "this product")
      : result.productNameEn,
    complianceReport: englishText(complianceReportEn, "") || englishText(result.complianceReport, "") || englishComplianceReportFallback(result),
    retrievedChunks: result.retrievedChunks.map((chunk) => ({
      ...chunk,
      docName: pickLocalized(chunk.docName, chunk.docNameEn, locale, chunk.regId || "Regulation document"),
    })),
    documents: (result.documents ?? []).map((document) => {
      const withEnglishName = document as typeof document & { nameEn?: string };
      return {
        ...document,
        name: pickLocalized(document.name, withEnglishName.nameEn, locale, "Source file"),
      };
    }),
  };
}

export function localizeProfitReportResult(
  result: ProfitReportResult,
  locale?: ReportLocale,
): ProfitReportResult {
  if (!isEnglish(locale)) return result;
  return {
    ...result,
    productType: pickLocalized(result.productType, result.productTypeEn, locale, "this product"),
    market: pickLocalized(result.market, result.marketEn, locale, "target market"),
    report: englishText(result.reportEn, "") || englishText(result.report, "") || englishProfitReportFallback(result),
    keyConclusion: pickLocalized(result.keyConclusion, result.keyConclusionEn, locale, "Conclusion pending"),
    breakevenUnits: pickLocalized(result.breakevenUnits, result.breakevenUnitsEn, locale, "TBD"),
    pricingStrategy: pickLocalized(result.pricingStrategy, result.pricingStrategyEn, locale, "Pricing strategy pending"),
    riskNote: pickLocalized(result.riskNote, result.riskNoteEn, locale, "Risk note pending"),
    conclusions: pickLocalized(result.conclusions, result.conclusionsEn, locale, "Conclusion pending"),
    references: pickLocalized(result.references, result.referencesEn, locale, "References pending"),
  };
}
