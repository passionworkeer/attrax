/**
 * report-export.ts — public export facade for all report types.
 */
export type { Locale } from "./report-export-modules/shared";
export { parseMarkdownToDocx, parseMarkdownToPdfText } from "./report-export-modules/shared";
export { downloadReportAsPdf, downloadReportAsDocx } from "./report-export-modules/compliance";
export { downloadProfitReportAsPdf } from "./report-export-modules/profit-pdf";
export { downloadProfitReportAsDocx } from "./report-export-modules/profit-docx";
export { downloadDecisionReportAsPdf } from "./report-export-modules/decision";
export { downloadDecisionReportAsDocx } from "./report-export-modules/decision";
export { downloadRoadmapReportAsPdf } from "./report-export-modules/roadmap";
export { downloadRoadmapReportAsDocx } from "./report-export-modules/roadmap";