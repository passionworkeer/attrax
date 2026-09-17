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
import type { ComplianceReportResult, ScanResult } from "@/lib/types";
import { prepareComplianceReport } from "@/lib/report-localization";
import { buildInspectionResultViewModel } from "@/lib/result/inspection-view-model";
import { assessReview } from "@/lib/result/review-assessment";
import { assessmentConclusion, buildReview, reviewStatusLabel } from "@/lib/result/review-model";
import { checkLabel } from "@/lib/result/check-labels";
import { appendInspectionAnnexToPdf } from "./inspection-annex";
import type { Locale } from "./shared";
import {
  complianceStatusLabel,
  docxTable,
  downloadBlob,
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
    ...(result.retrievedChunks ?? []).map((chunk, index) => [
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
    ...(result.documents ?? []).map((document, index) => [
      String(index + 1),
      locale === "en" ? document.nameEn ?? document.name : document.name,
      document.type.toUpperCase(),
      formatFileSize(document.size, locale),
    ]),
  ];
}

type PdfColor = [number, number, number];

function statusPalette(status: ComplianceReportResult["complianceStatus"]): {
  accent: PdfColor;
  soft: PdfColor;
} {
  if (status === "PASS") return { accent: [16, 185, 129], soft: [236, 253, 245] };
  if (status === "WARN") return { accent: [245, 158, 11], soft: [255, 251, 235] };
  return { accent: [239, 68, 68], soft: [254, 242, 242] };
}

function drawComplianceDashboard(
  doc: jsPDF,
  result: ComplianceReportResult,
  rawResult: Partial<ScanResult>,
  locale: Locale,
  markets: string,
  statusText: string,
  reportTitle: string,
  pageWidth: number,
  margin: number,
): { y: number; displayTitle: string } {
  const contentWidth = pageWidth - margin * 2;
  const market = result.targetMarkets[0];
  let reviewData: {
    review: ReturnType<typeof buildReview>;
    assessment: ReturnType<typeof assessReview>;
    facts: ReturnType<typeof assessReview>["rows"];
  } | null = null;
  try {
    if (market && Array.isArray(rawResult.riskPoints) && Array.isArray(rawResult.inspectionFindings)) {
      const review = buildReview(rawResult as ScanResult, market);
      const assessment = assessReview(review);
      reviewData = { review, assessment, facts: assessment.rows.filter((row) => row.factRecorded) };
    }
  } catch {
    reviewData = null;
  }
  const effectiveStatus = result.complianceStatus === "UNKNOWN" && reviewData ? "WARN" : result.complianceStatus;
  const palette = statusPalette(effectiveStatus);
  const displayTitle = reviewData?.review.vm.product.title || result.productName || (locale === "zh" ? "产品合规预检" : "Product compliance pre-check");
  const displayScore = reviewData?.assessment.score ?? result.complianceScore;
  const decisionLabel = reviewData ? reviewStatusLabel(reviewData.review.status, locale) : statusText;
  let y = margin;

  doc.setFont("NotoSansSC", "bold");
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(reportTitle, margin, y);
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`${displayTitle} · ${markets}`, pageWidth - margin, y, { align: "right" });
  y += 6;
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.8);
  doc.line(margin, y, margin + 30, y);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin + 30, y, pageWidth - margin, y);
  y += 7;

  const scoreW = 44;
  const cardH = 39;
  doc.setFillColor(241, 247, 250);
  doc.setDrawColor(186, 211, 222);
  doc.roundedRect(margin, y, contentWidth, cardH, 4, 4, "FD");
  doc.setFillColor(222, 238, 245);
  doc.roundedRect(margin + 5, y + 5, scoreW, cardH - 10, 3, 3, "F");
  doc.setFont("NotoSansSC", "bold");
  doc.setFontSize(24);
  doc.setTextColor(palette.accent[0], palette.accent[1], palette.accent[2]);
  doc.text(String(displayScore ?? "—"), margin + 10, y + 22);
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 101, 116);
  doc.text("/ 100", margin + 31, y + 22);
  doc.text(locale === "zh" ? "当前证据支持度" : "Evidence support", margin + 10, y + 30);

  const metaX = margin + 57;
  doc.setFont("NotoSansSC", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(24, 55, 72);
  doc.text(displayTitle, metaX, y + 11);
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 101, 116);
  doc.text(`${locale === "zh" ? "判断市场" : "Market"}  ${markets}`, metaX, y + 21);
  const metrics = reviewData
    ? `${locale === "zh" ? "判断覆盖" : "Coverage"}  ${reviewData.assessment.decided.length}/${reviewData.assessment.regulatory.length}   ·   ${locale === "zh" ? "有据支持" : "Supported"}  ${reviewData.assessment.supported}   ·   ${locale === "zh" ? "需核对" : "Review"}  ${reviewData.assessment.attention.length}`
    : `${locale === "zh" ? "等级" : "Grade"}  ${result.scoreGrade}   ·   ${locale === "zh" ? "法规证据" : "Evidence"}  ${result.retrievedChunks?.length ?? 0}   ·   ${locale === "zh" ? "资料" : "Files"}  ${result.documents?.length ?? 0}`;
  doc.text(metrics, metaX, y + 30);

  const badgeText = `${locale === "zh" ? "结论" : "Status"} · ${decisionLabel}`;
  const badgeWidth = Math.min(Math.max(doc.getTextWidth(badgeText) + 9, 28), 58);
  doc.setFillColor(palette.soft[0], palette.soft[1], palette.soft[2]);
  doc.setDrawColor(palette.accent[0], palette.accent[1], palette.accent[2]);
  doc.roundedRect(pageWidth - margin - badgeWidth - 5, y + 7, badgeWidth, 8, 2, 2, "FD");
  doc.setFont("NotoSansSC", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(palette.accent[0], palette.accent[1], palette.accent[2]);
  doc.text(badgeText, pageWidth - margin - badgeWidth - 0.5, y + 12.5);
  y += cardH + 7;

  if (reviewData && market) {
      const { review, assessment, facts } = reviewData;
      const conclusion = assessmentConclusion({
        title: review.vm.product.title,
        market,
        factCount: facts.length,
        assessment,
        locale,
      });
      const conclusionLines = doc.splitTextToSize(conclusion, contentWidth - 12) as string[];
      const conclusionH = Math.max(20, conclusionLines.length * 4.5 + 11);
      doc.setFillColor(239, 246, 255);
      doc.setDrawColor(191, 219, 254);
      doc.roundedRect(margin, y, contentWidth, conclusionH, 3, 3, "FD");
      doc.setFont("NotoSansSC", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(30, 64, 175);
      doc.text(locale === "zh" ? "总体评价" : "Overall assessment", margin + 5, y + 7);
      doc.setFont("NotoSansSC", "normal");
      doc.setFontSize(8.3);
      doc.setTextColor(51, 65, 85);
      doc.text(conclusionLines, margin + 5, y + 13);
      y += conclusionH + 6;

      if (assessment.attention.length) {
        doc.setFont("NotoSansSC", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(15, 23, 42);
        doc.text(locale === "zh" ? `${assessment.attention.length} 项需优先核对` : `${assessment.attention.length} priority checks`, margin, y + 4);
        y += 8;
        for (const row of assessment.attention.slice(0, 4)) {
          const blocked = row.claim?.status === "blocked";
          const reason = row.claim?.reason || row.check.bestObservation?.description || (locale === "zh" ? "证据尚未闭环" : "Evidence remains open");
          const reasonLines = doc.splitTextToSize(reason, contentWidth - 48) as string[];
          const itemH = Math.max(12, reasonLines.length * 4 + 6);
          doc.setFillColor(blocked ? 254 : 255, blocked ? 242 : 251, blocked ? 242 : 235);
          doc.setDrawColor(blocked ? 252 : 253, blocked ? 165 : 230, blocked ? 165 : 138);
          doc.roundedRect(margin, y, contentWidth, itemH, 2.5, 2.5, "FD");
          doc.setFont("NotoSansSC", "bold");
          doc.setFontSize(8.2);
          doc.setTextColor(blocked ? 153 : 146, blocked ? 27 : 64, blocked ? 27 : 14);
          doc.text(`#${row.number} · ${checkLabel(row.check.checkId, locale, row.check.title)}`, margin + 4, y + 7);
          doc.setFont("NotoSansSC", "normal");
          doc.setFontSize(7.8);
          doc.setTextColor(71, 85, 105);
          doc.text(reasonLines, margin + 43, y + 6.5);
          y += itemH + 3;
        }
      }
  }

  return { y: y + 3, displayTitle };
}

function detailedReportMarkdown(markdown: string, locale: Locale): string {
  const marker = locale === "zh" ? "## 市场结论与证据索引" : "## Market conclusions and evidence index";
  const markerIndex = markdown.indexOf(marker);
  let detail = markerIndex >= 0 ? markdown.slice(markerIndex) : markdown;
  const inputMarker = locale === "zh" ? "## 本次分析输入记录" : "## Analysis input record";
  const revisionMarker = locale === "zh" ? "## 版本变化" : "## Revision changes";
  const inputIndex = detail.indexOf(inputMarker);
  if (inputIndex >= 0) {
    const revisionIndex = detail.indexOf(revisionMarker, inputIndex + inputMarker.length);
    detail = revisionIndex >= 0
      ? `${detail.slice(0, inputIndex)}\n\n${detail.slice(revisionIndex)}`
      : detail.slice(0, inputIndex);
  }
  return detail
    .replace(/^\s*\/regulations\/\S+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function downloadReportAsPdf(input: ComplianceReportResult, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const result = prepareComplianceReport(input, L);
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
    const statusText = complianceStatusLabel(result.complianceStatus, L);
    const rawResult = input as Partial<ScanResult> & ComplianceReportResult;

    const dashboard = drawComplianceDashboard(doc, result, rawResult, L, markets, statusText, reportTitle, pageWidth, margin);
    y = dashboard.y;
    await yieldToMainThread();

    // ── Report Content ────────────────────────────────────
    const yRef = { cur: y };
    await renderMarkdownPdf(doc, yRef, margin, pageWidth, pageHeight, detailedReportMarkdown(result.complianceReport, L), yieldToMainThread);

    if ((result.retrievedChunks?.length ?? 0) > 0) {
      pdfSectionTitle(doc, yRef, margin, pageWidth, pageHeight, L === "zh" ? "法规证据命中明细" : "Retrieved Evidence Details");
      pdfDrawTable(doc, yRef, margin, pageWidth, pageHeight, evidenceRows(result, L), [10, 24, 74, 32, 16]);
      await yieldToMainThread();
    }

    if ((result.documents ?? []).length > 0) {
      pdfSectionTitle(doc, yRef, margin, pageWidth, pageHeight, L === "zh" ? "上传原始资料清单" : "Uploaded Source Files");
      pdfDrawTable(doc, yRef, margin, pageWidth, pageHeight, documentRows(result, L), [10, 88, 24, 22]);
      await yieldToMainThread();
    }
    y = yRef.cur;

    // ── Image evidence annex (plan 2026-09-14 §4.5, J06) ──────────────────
    // Only checklist-mode scans carry inspection observations/findings; demo
    // and legacy sessions leave them undefined and the annex is skipped
    // (a VM over an empty entity set adds nothing but the disclaimer).
    if ((rawResult.inspectionObservations?.length ?? 0) > 0 || (rawResult.inspectionFindings?.length ?? 0) > 0) {
      try {
        const inspectionVM = buildInspectionResultViewModel({
          result: rawResult as unknown as ScanResult,
          sessionId: result.sessionId,
        });
        await appendInspectionAnnexToPdf(doc, inspectionVM, {
          sessionId: result.sessionId,
          locale: L,
          margin,
        });
      } catch (annexError) {
        // The annex is additive — a failure here must never destroy the core
        // report the user already has. Log-and-continue (J06: 导出前校验的
        // 降级路径要明确，不静默也不中断主报告).
        console.warn("[report-export] inspection annex skipped:", annexError);
      }
    }

    // ── Footer on each page ────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      if (i > 1) {
        doc.setFont("NotoSansSC", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(reportTitle, margin, 10);
        doc.text(`${dashboard.displayTitle} · ${markets}`, pageWidth - margin, 10, { align: "right" });
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.25);
        doc.line(margin, 14, pageWidth - margin, 14);
      }
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
    downloadBlob(doc.output("blob"), filenameBase);
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
    const result = prepareComplianceReport(input, L);
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

          ...(result.documents && result.documents.length > 0
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
  const filename = L === "zh"
    ? `合规报告_${result.sessionId}_${result.complianceStatus}.docx`
    : `ComplianceReport_${result.sessionId}_${result.complianceStatus}.docx`;
  downloadBlob(blob, filename);
  } catch (error) {
    throw new Error(
      `Failed to export compliance DOCX report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
