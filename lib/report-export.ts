/**
 * report-export.ts — public export facade for compliance and profit reports.
 */
export type { Locale } from "./report-export-modules/shared";
export { parseMarkdownToDocx, parseMarkdownToPdfText } from "./report-export-modules/shared";
export { downloadReportAsDocx, downloadReportAsPdf } from "./report-export-modules/compliance";
export { downloadProfitReportAsPdf } from "./report-export-modules/profit-pdf";
export { downloadProfitReportAsDocx } from "./report-export-modules/profit-docx";
