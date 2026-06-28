/**
 * report-download.ts — lazy entry point for report export actions.
 *
 * Unlike `lib/report-export.ts`, this module has NO static imports of
 * `jspdf` or `docx`. Each `download*` wrapper dynamic-imports its target
 * module on first invocation, so the heavy export libraries are kept out
 * of the initial page bundle and only loaded when a user actually clicks
 * an export button.
 *
 * UI components (ComplianceReportView, ProfitReportView, ReportPanels)
 * should prefer this module over `@/lib/report-export`.
 */
import type { ComplianceReportResult, ProfitReportResult } from "@/lib/types";
import type { Locale } from "./report-export-modules/shared";
import type { DecisionContent } from "./report-export-modules/decision";
import type { RoadmapContent } from "./report-export-modules/roadmap";

const complianceModule = () => import("./report-export-modules/compliance");
const profitPdfModule = () => import("./report-export-modules/profit-pdf");
const profitDocxModule = () => import("./report-export-modules/profit-docx");
const decisionModule = () => import("./report-export-modules/decision");
const roadmapModule = () => import("./report-export-modules/roadmap");

export function downloadReportAsPdf(result: ComplianceReportResult, locale?: Locale): Promise<void> {
  return complianceModule().then((m) => m.downloadReportAsPdf(result, locale));
}

export function downloadReportAsDocx(result: ComplianceReportResult, locale?: Locale): Promise<void> {
  return complianceModule().then((m) => m.downloadReportAsDocx(result, locale));
}

export function downloadProfitReportAsPdf(result: ProfitReportResult, locale?: Locale): Promise<void> {
  return profitPdfModule().then((m) => m.downloadProfitReportAsPdf(result, locale));
}

export function downloadProfitReportAsDocx(result: ProfitReportResult, locale?: Locale): Promise<void> {
  return profitDocxModule().then((m) => m.downloadProfitReportAsDocx(result, locale));
}

export function downloadDecisionReportAsPdf(content: DecisionContent, locale?: Locale): Promise<void> {
  return decisionModule().then((m) => m.downloadDecisionReportAsPdf(content, locale));
}

export function downloadDecisionReportAsDocx(content: DecisionContent, locale?: Locale): Promise<void> {
  return decisionModule().then((m) => m.downloadDecisionReportAsDocx(content, locale));
}

export function downloadRoadmapReportAsPdf(content: RoadmapContent, locale?: Locale): Promise<void> {
  return roadmapModule().then((m) => m.downloadRoadmapReportAsPdf(content, locale));
}

export function downloadRoadmapReportAsDocx(content: RoadmapContent, locale?: Locale): Promise<void> {
  return roadmapModule().then((m) => m.downloadRoadmapReportAsDocx(content, locale));
}
