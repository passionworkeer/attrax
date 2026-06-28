/**
 * report-export.ts — public export facade for all report types.
 *
 * This is the original API surface, kept for unit tests and any non-UI
 * caller that wants the straightforward static imports. It DOES pull in
 * `jspdf` and `docx` statically — UI components that need to keep those
 * out of the initial page bundle should import the lazy `download*`
 * wrappers from `@/lib/report-download` instead.
 */
export type { Locale } from "./report-export-modules/shared";
export { parseMarkdownToPdfText } from "./report-export-modules/markdown-text";
export { parseMarkdownToDocx } from "./report-export-modules/shared";
export { downloadReportAsPdf, downloadReportAsDocx } from "./report-export-modules/compliance";
export { downloadProfitReportAsPdf } from "./report-export-modules/profit-pdf";
export { downloadProfitReportAsDocx } from "./report-export-modules/profit-docx";
export { downloadDecisionReportAsPdf, downloadDecisionReportAsDocx } from "./report-export-modules/decision";
export { downloadRoadmapReportAsPdf, downloadRoadmapReportAsDocx } from "./report-export-modules/roadmap";
export type { DecisionContent } from "./report-export-modules/decision";
export type { RoadmapContent } from "./report-export-modules/roadmap";
