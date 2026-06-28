import { jsPDF } from "jspdf";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { ComplianceReportResult } from "@/lib/types";
import { localizeComplianceReportResult } from "@/lib/report-localization";
import type { Locale } from "./shared";
import {
  complianceStatusLabel,
  docxTable,
  embedFont,
  marketLabel,
  mkSectionH,
  parseMarkdownToDocx,
  pdfDrawTable,
  pdfSectionTitle,
  renderMarkdownPdf,
  resolveLocale,
  tx,
  yieldToMainThread,
} from "./shared";

function formatFileSize(size: number, locale: Locale): string {
  if (!Number.isFinite(size) || size <= 0) return locale === "zh" ? "未知" : "Unknown";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function evidenceRows(result: ComplianceReportResult, locale: Locale): string[][] {
  return [
    locale === "zh"
      ? ["#", "市场", "法规/文件", "条款", "匹配度"]
      : ["#", "Market", "Regulation / Document", "Article", "Score"],
    ...result.retrievedChunks.map((chunk, index) => [
      String(index + 1),
      chunk.region,
      locale === "en" ? chunk.docNameEn ?? chunk.docName : chunk.docName,
      chunk.articleNo,
      chunk.score.toFixed(2),
    ]),
  ];
}

function documentRows(result: ComplianceReportResult, locale: Locale): string[][] {
  return [
    locale === "zh" ? ["#", "原始文件", "类型", "大小"] : ["#", "Source File", "Type", "Size"],
    ...result.documents.map((document, index) => [
      String(index + 1),
      locale === "en" ? document.nameEn ?? document.name : document.name,
      document.type.toUpperCase(),
      formatFileSize(document.size, locale),
    ]),
  ];
}

export async function downloadReportAsPdf(input: ComplianceReportResult, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const result = localizeComplianceReportResult(input, L);
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    // Embed Noto Sans SC (supports Chinese) before any text is written.
    await embedFont(doc);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let y = margin;

    const markets = result.targetMarkets.map((m) => marketLabel(m, L)).join(L === "zh" ? "、" : ", ");
    const reportTitle = tx("report.title", L);
    const reportFooter = tx("report.footer", L);
    const lblGrade = tx("report.labels.productGrade", L);
    const lblCategory = tx("report.labels.productCategory", L);
    const lblMarket = tx("report.labels.productMarket", L);
    const statusText = complianceStatusLabel(result.complianceStatus, L);

    // ── Header ────────────────────────────────────────────
    doc.setFontSize(10);
    doc.setTextColor(180);
    doc.text(reportTitle, margin, y);
    y += 6;
    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // Yield after the header so the UI can paint a loading indicator before
    // the heavy scoring/section rendering begins.
    await yieldToMainThread();

    // ── Score & Meta ───────────────────────────────────────
    const scoreColor = result.complianceStatus === "PASS"
      ? [16, 185, 129]
      : result.complianceStatus === "WARN"
      ? [245, 158, 11]
      : [239, 68, 68];
    doc.setFontSize(48);
    doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.text(String(result.complianceScore), margin, y + 14);
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text(`${lblGrade}：${result.scoreGrade}`, margin + 28, y + 8);
    doc.text(`${lblCategory}：${result.productCategory}`, margin + 28, y + 16);
    doc.text(`${lblMarket}：${markets}`, margin + 28, y + 24);
    y += 36;

    // ── Status badge ─────────────────────────────────────
    const badgeFill = result.complianceStatus === "PASS"
      ? [236, 253, 245]
      : result.complianceStatus === "WARN"
        ? [255, 251, 235]
        : [254, 242, 242];
    doc.setFillColor(badgeFill[0], badgeFill[1], badgeFill[2]);
    doc.setDrawColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.setLineWidth(0.4);
    const statusW = doc.getTextWidth(` ${statusText} `) + 4;
    doc.roundedRect(margin, y, statusW, 7, 1.5, 1.5, "FD");
    doc.setFontSize(9);
    doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.text(` ${statusText} `, margin + 2, y + 5);
    y += 12;

    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    await yieldToMainThread();

    // ── Report Content ────────────────────────────────────
    const yRef = { cur: y };
    await renderMarkdownPdf(doc, yRef, margin, pageWidth, pageHeight, result.complianceReport, yieldToMainThread);

    if (result.retrievedChunks.length > 0) {
      pdfSectionTitle(doc, yRef, margin, pageWidth, pageHeight, L === "zh" ? "法规证据命中明细" : "Retrieved Evidence Details");
      pdfDrawTable(doc, yRef, margin, pageWidth, pageHeight, evidenceRows(result, L), [10, 24, 74, 32, 16]);
      await yieldToMainThread();
    }

    if (result.documents.length > 0) {
      pdfSectionTitle(doc, yRef, margin, pageWidth, pageHeight, L === "zh" ? "上传原始资料清单" : "Uploaded Source Files");
      pdfDrawTable(doc, yRef, margin, pageWidth, pageHeight, documentRows(result, L), [10, 88, 24, 22]);
      await yieldToMainThread();
    }
    y = yRef.cur;

    // ── Footer on each page ────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(180, 180, 180);
      doc.text(
        `${reportFooter} · ${result.sessionId} · ${L === "zh" ? "第" : "Page"} ${i} / ${pageCount} ${L === "zh" ? "页" : ""}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: "center" }
      );
    }

    const filenameBase = L === "zh"
      ? `合规报告_${result.sessionId}_${result.complianceStatus}.pdf`
      : `ComplianceReport_${result.sessionId}_${result.complianceStatus}.pdf`;
    doc.save(filenameBase);
  } catch (error) {
    throw new Error(
      `Failed to export compliance PDF report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function downloadReportAsDocx(input: ComplianceReportResult, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const result = localizeComplianceReportResult(input, L);
    const markets = result.targetMarkets.map((m) => marketLabel(m, L)).join(L === "zh" ? "、" : ", ");
    const statusText = complianceStatusLabel(result.complianceStatus, L);
  const title = tx("report.title", L);
  const lblScore = tx("report.comprehensiveScore", L);
  const lblGrade = tx("report.labels.productGrade", L);
  const lblCategory = tx("report.labels.productCategory", L);
  const lblMarket = tx("report.labels.productMarket", L);
  const lblStatus = tx("report.labels.complianceStatus", L);
  const lblSessionId = tx("report.sessionId", L);
  const lblGeneratedAt = tx("report.generatedAt", L);
  const brand = tx("report.brand", L);
  const dateFmt = L === "zh" ? "zh-CN" : "en-US";

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: { font: "Arial", size: 22 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 900 },
          },
        },
        children: [
          // ── Title ──────────────────────────────
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [
              new TextRun({
                text: title,
                bold: true,
                size: 36,
                color: "C41E3A",
              }),
            ],
            spacing: { after: 200 },
          }),

          // ── Score box ─────────────────────────
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: `${result.complianceScore}`, bold: true, size: 64, color: "C41E3A" })],
                        alignment: AlignmentType.CENTER,
                      }),
                      new Paragraph({
                        children: [new TextRun({ text: lblScore, size: 18, color: "888888" })],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    width: { size: 25, type: WidthType.PERCENTAGE },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun({ text: `${lblGrade}：${result.scoreGrade}`, size: 22 })], spacing: { after: 80 } }),
                      new Paragraph({ children: [new TextRun({ text: `${lblCategory}：${result.productCategory}`, size: 22 })], spacing: { after: 80 } }),
                      new Paragraph({ children: [new TextRun({ text: `${lblMarket}：${markets}`, size: 22 })], spacing: { after: 80 } }),
                      new Paragraph({ children: [new TextRun({ text: `${lblStatus}：${statusText}`, size: 22, bold: true })] }),
                    ],
                    width: { size: 75, type: WidthType.PERCENTAGE },
                  }),
                ],
              }),
            ],
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
          }),

          new Paragraph({ text: "" }),

          // ── Report sections ─────────────────────
          ...parseMarkdownToDocx(result.complianceReport),

          ...(result.retrievedChunks.length > 0
            ? [
                mkSectionH(L === "zh" ? "法规证据命中明细" : "Retrieved Evidence Details"),
                docxTable(evidenceRows(result, L), ["475569", "475569", "475569", "475569", "475569"]),
                new Paragraph({ text: "" }),
              ]
            : []),

          ...(result.documents.length > 0
            ? [
                mkSectionH(L === "zh" ? "上传原始资料清单" : "Uploaded Source Files"),
                docxTable(documentRows(result, L), ["475569", "475569", "475569", "475569"]),
                new Paragraph({ text: "" }),
              ]
            : []),

          // ── Footer ─────────────────────────────
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [
              new TextRun({ text: `${lblSessionId}：${result.sessionId}  |  ${lblGeneratedAt}：${new Date(result.generatedAt).toLocaleString(dateFmt)}  |  ${brand}`, size: 18, color: "888888" }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = L === "zh"
      ? `合规报告_${result.sessionId}_${result.complianceStatus}.docx`
      : `ComplianceReport_${result.sessionId}_${result.complianceStatus}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error(
      `Failed to export compliance DOCX report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
