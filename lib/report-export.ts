/**
 * report-export.ts — Export compliance report as PDF or Word (.docx)
 *
 * Locale detection:
 *   Each export function accepts an optional `locale` parameter.
 *   If omitted, the client's locale is auto-detected from localStorage
 *   (set by the i18n provider) or falls back to "zh".
 */
import { jsPDF } from "jspdf";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import type { ComplianceReportResult, ProfitReportResult } from "@/lib/types";
import { getTranslations } from "@/lib/i18n-server";

export type Locale = "zh" | "en";

/** Detect locale from localStorage (set by i18n provider), falling back to "zh". */
function detectLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  const stored = localStorage.getItem("locale") as Locale | null;
  if (stored === "zh" || stored === "en") return stored;
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith("en") ? "en" : "zh";
}

/** Resolve locale parameter with auto-detection fallback. */
function resolveLocale(locale: Locale | undefined): Locale {
  return locale ?? detectLocale();
}

/** Shortcut to look up a nested translation key. */
function tx(key: string, locale: Locale = "zh"): string {
  const keys = key.split(".");
  let value: unknown = getTranslations(locale);
  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }
  return typeof value === "string" ? value : key;
}

function complianceStatusLabel(status: string, locale: Locale): string {
  return tx(`complianceStatus.${status === "PASS" ? "passed" : status === "WARN" ? "warning" : status === "REJECTED" ? "rejected" : "unknown"}`, locale);
}

function marketLabel(market: string, locale: Locale): string {
  return tx(`markets.${market}`, locale);
}

export function parseMarkdownToDocx(text: string): Paragraph[] {
  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: line.slice(4), bold: true, size: 24 })],
          spacing: { before: 240, after: 120 },
        })
      );
      continue;
    }
    if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: line.slice(3), bold: true, size: 28 })],
          spacing: { before: 360, after: 160 },
        })
      );
      continue;
    }
    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: line.slice(2), bold: true, size: 32 })],
          spacing: { before: 480, after: 200 },
        })
      );
      continue;
    }

    // List items
    if (/^[-*] /.test(line)) {
      const content = line.replace(/^[-*] /, "").replace(/\*\*(.*?)\*\*/g, "$1");
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${content}`, size: 22 })],
          indent: { left: 360 },
          spacing: { after: 60 },
        })
      );
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const content = line.replace(/^\d+\. /, "").replace(/\*\*(.*?)\*\*/g, "$1");
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: content, size: 22 })],
          indent: { left: 360 },
          spacing: { after: 60 },
        })
      );
      continue;
    }

    // Regular paragraph — remove markdown bold
    const clean = line.replace(/\*\*(.*?)\*\*/g, "$1");
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: clean, size: 22 })],
        spacing: { after: 100 },
      })
    );
  }

  return paragraphs;
}

export function parseMarkdownToPdfText(text: string): string {
  return text
    .replace(/#{1,3}\s+/g, "\n")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\[(\d+)\]/g, "[$1]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function downloadReportAsPdf(result: ComplianceReportResult, locale?: Locale): Promise<void> {
  const L = resolveLocale(locale);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Embed Noto Sans SC (supports Chinese) before any text is written.
  const fontBuffer = await fetch("/fonts/NotoSansSC-Regular.ttf").then((r) => r.arrayBuffer());
  const fontBlob = new Blob([fontBuffer], { type: "font/truetype" });
  const fontUrl = URL.createObjectURL(fontBlob);
  try {
    doc.addFont(fontUrl, "NotoSansSC", "normal");
    doc.setFont("NotoSansSC", "normal");
  } finally {
    URL.revokeObjectURL(fontUrl);
  }

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
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
  const fillR = Math.round(scoreColor[0] * 0.1);
  const fillG = Math.round(scoreColor[1] * 0.1);
  const fillB = Math.round(scoreColor[2] * 0.1);
  doc.setFillColor(fillR, fillG, fillB);
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

  // ── Report Content ────────────────────────────────────
  doc.setTextColor(30, 30, 30);
  const reportText = parseMarkdownToPdfText(result.complianceReport);
  const lines = doc.splitTextToSize(reportText, contentWidth);

  for (const line of lines) {
    if (y + 6 > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    if (line === "") {
      y += 4;
      continue;
    }
    doc.setFontSize(9);
    doc.text(String(line), margin, y);
    y += 5;
  }

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
}

export async function downloadReportAsDocx(result: ComplianceReportResult, locale?: Locale): Promise<void> {
  const L = resolveLocale(locale);
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
}

// ── Profit Report helpers ──────────────────────────────────────────────────────

async function embedFont(doc: jsPDF): Promise<void> {
  const fontBuffer = await fetch("/fonts/NotoSansSC-Regular.ttf").then((r) => r.arrayBuffer());
  const fontBlob = new Blob([fontBuffer], { type: "font/truetype" });
  const fontUrl = URL.createObjectURL(fontBlob);
  try {
    doc.addFont(fontUrl, "NotoSansSC", "normal");
    doc.setFont("NotoSansSC", "normal");
  } finally {
    URL.revokeObjectURL(fontUrl);
  }
}

function pdfCheckBreak(doc: jsPDF, y: number, margin: number, pageHeight: number, needed = 14): { y: number; newPage: boolean } {
  if (y + needed > pageHeight - margin) {
    doc.addPage();
    return { y: margin, newPage: true };
  }
  return { y, newPage: false };
}

function pdfSectionTitle(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, title: string): void {
  const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, 16);
  y.cur = ny;
  y.cur += 3;
  doc.setFont("NotoSansSC", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(title, margin, y.cur);
  y.cur += 4;
  doc.setDrawColor(200, 200, 215);
  doc.setLineWidth(0.4);
  doc.line(margin, y.cur, pageWidth - margin, y.cur);
  y.cur += 4;
}

function pdfDrawTable(
  doc: jsPDF,
  y: { cur: number },
  margin: number,
  pageWidth: number,
  pageHeight: number,
  rows: string[][],
  colWidths: number[],
  rowH = 6.5,
): void {
  const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, rows.length * rowH + 4);
  y.cur = ny;

  const contentW = pageWidth - margin * 2;
  const computedWidths = colWidths.length
    ? colWidths
    : Array(rows[0]?.length ?? 4).fill(contentW / (rows[0]?.length ?? 4));

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const isHeader = ri === 0;
    let x = margin;
    for (let ci = 0; ci < row.length; ci++) {
      const cw = computedWidths[ci] ?? (contentW / row.length);
      if (isHeader) {
        doc.setFillColor(238, 238, 248);
        doc.setDrawColor(200, 200, 220);
        doc.rect(x, y.cur, cw, rowH, "FD");
      } else {
        doc.setDrawColor(225, 225, 235);
        doc.rect(x, y.cur, cw, rowH, "S");
      }
      doc.setFont("NotoSansSC", isHeader ? "bold" : "normal");
      doc.setFontSize(8);
      doc.setTextColor(isHeader ? 80 : 40, isHeader ? 80 : 40, isHeader ? 100 : 40);
      const cell = row[ci] ?? "";
      const textX = ci === 0 ? x + 2 : x + cw - 2;
      const align = ci === 0 ? "left" : "right";
      doc.text(cell, textX, y.cur + rowH - 1.5, { align });
      x += cw;
    }
    y.cur += rowH;
  }
  y.cur += 4;
}

function pdfBody(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, text: string, size = 9): void {
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(size);
  doc.setTextColor(50, 50, 50);
  const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
  const needed = lines.length * (size * 0.5) + 3;
  const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, needed);
  y.cur = ny;
  doc.text(lines, margin, y.cur);
  y.cur += needed - 3;
}

function pdfBullet(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, text: string): void {
  const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, 7);
  y.cur = ny;
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  const clean = text.replace(/^\d+[\.\)]\s*/, "• ").replace(/\*\*(.*?)\*\*/g, "$1");
  doc.text(`  ${clean}`, margin, y.cur);
  y.cur += 6;
}

export async function downloadProfitReportAsPdf(result: ProfitReportResult, locale?: Locale): Promise<void> {
  const L = resolveLocale(locale);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await embedFont(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  const y = { cur: margin };

  // Translation shortcuts
  const rp = (k: string) => tx(`report.${k}`, L);
  const lblNoCompliance = rp("labels.noCompliance");
  const lblWithCompliance = rp("labels.withCompliance");
  const colCostItem = rp("columns.costItem");
  const colBomCost = rp("columns.bomCost");
  const colPackaging = rp("columns.packaging");
  const colCertAmort = rp("columns.certAmortization");
  const colEprFee = rp("columns.eprFee");
  const colAfterSales = rp("columns.afterSales");
  const colWarranty = rp("columns.warranty");
  const colLogistics = rp("columns.logistics");
  const colTotalCost = rp("columns.totalDirectCost");
  const colRevenue = rp("columns.revenue");
  const colAvgPrice = rp("columns.avgPrice");
  const colGrossProfit = rp("columns.grossProfit");
  const colGrossMargin = rp("columns.grossMargin");
  const lblGrossProfit = rp("cards.grossProfit");
  const lblRiskExposure = rp("cards.riskExposure");
  const lblBreakevenUnits = rp("cards.breakevenUnits");
  const lblPricingAdvice = rp("cards.pricingAdvice");
  const lblMode = L === "zh" ? "模式" : "Mode";
  const lblAnalysis = L === "zh" ? "分析项" : "Analysis Item";
  const lblDiff = L === "zh" ? "差值" : "Diff.";
  const lblExplanation = L === "zh" ? "说明" : "Notes";
  const lblCompliancePremium = L === "zh" ? "合规溢价" : "Compliance Premium";
  const lblBreakeven = L === "zh" ? "盈亏平衡台数" : "Break-even Units";
  const lblSuggestedPrice = L === "zh" ? "建议定价" : "Suggested Price";
  const lblRiskAdjNet = L === "zh" ? "经风险调整净收益" : "Risk-Adjusted Net";
  const lblZeroRisk = L === "zh" ? "零风险敞口" : "Zero risk exposure";
  const lblSeizureRisk = L === "zh" ? "35-50% 扣押概率" : "35-50% seizure probability";
  const lblPricingStrategy = L === "zh" ? "定价策略" : "Pricing Strategy";
  const lblFullReport = L === "zh" ? "完整分析报告" : "Full Analysis Report";

  // Currency symbol based on locale (reports are CNY)
  const ccy = "¥";
  const dateFmt = L === "zh" ? "zh-CN" : "en-US";

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setTextColor(180);
  doc.setFont("NotoSansSC", "normal");
  doc.text(rp("profitTitle"), margin, y.cur);
  y.cur += 5;
  doc.setDrawColor(220);
  doc.line(margin, y.cur, pageWidth - margin, y.cur);
  y.cur += 7;

  // ── Title ────────────────────────────────────────────────────────────────
  const title = rp("title");
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.setFont("NotoSansSC", "bold");
  doc.text(title, margin, y.cur);
  y.cur += 7;
  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.setFont("NotoSansSC", "normal");
  const lblProduct = tx("report.labels.product", L);
  const lblMkt = tx("report.labels.market", L);
  doc.text(`${lblProduct}：${result.productType}　　${lblMkt}：${result.market}　　${new Date(result.generatedAt).toLocaleDateString(dateFmt)}`, margin, y.cur);
  y.cur += 10;

  // ── Summary Cards ────────────────────────────────────────────────────────
  const halfW = (contentWidth - 4) / 2;
  const renderCard = (
    x: number, label: string, gp: number, risk: number,
    bg: number[], border: number[], fg: number[],
  ) => {
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y.cur, halfW, 24, 2, 2, "FD");
    doc.setFontSize(8);
    doc.setTextColor(fg[0], fg[1], fg[2]);
    doc.text(label, x + 4, y.cur + 5);
    doc.setFontSize(17);
    doc.text(`${ccy}${gp.toFixed(0)}`, x + 4, y.cur + 13);
    doc.setFontSize(7.5);
    doc.text(`${lblRiskExposure} ${ccy}${risk.toFixed(0)}`, x + 4, y.cur + 20);
  };

  renderCard(margin, lblNoCompliance, result.barebone.gp, result.bareboneRiskExposure, [255, 238, 238], [200, 60, 60], [180, 50, 50]);
  renderCard(margin + halfW + 4, lblWithCompliance, result.compliant.gp, result.compliantRiskExposure, [238, 255, 244], [50, 180, 100], [30, 150, 70]);
  y.cur += 30;

  // ── Section 1: Cost Comparison ──────────────────────────────────────────
  const s1Title = `${rp("costComparison")}（${lblWithCompliance} vs ${lblNoCompliance}）`;
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, s1Title);
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, [
    [colCostItem, lblNoCompliance, lblWithCompliance, lblDiff],
    [colBomCost, `${ccy}${result.barebone.bom.toFixed(2)}`, `${ccy}${result.compliant.bom.toFixed(2)}`, `${ccy}${(result.compliant.bom - result.barebone.bom).toFixed(2)}`],
    [colPackaging, `${ccy}${result.barebone.packaging.toFixed(2)}`, `${ccy}${result.compliant.packaging.toFixed(2)}`, `${ccy}${(result.compliant.packaging - result.barebone.packaging).toFixed(2)}`],
    [colCertAmort, `${ccy}${result.barebone.cert.toFixed(2)}`, `${ccy}${result.compliant.cert.toFixed(2)}`, `${ccy}${(result.compliant.cert - result.barebone.cert).toFixed(2)}`],
    [colEprFee, `${ccy}${result.barebone.epr.toFixed(2)}`, `${ccy}${result.compliant.epr.toFixed(2)}`, `${ccy}${(result.compliant.epr - result.barebone.epr).toFixed(2)}`],
    [`${colAfterSales}/${colWarranty}`, `${ccy}${result.barebone.warranty.toFixed(2)}`, `${ccy}${result.compliant.warranty.toFixed(2)}`, `${ccy}${(result.compliant.warranty - result.barebone.warranty).toFixed(2)}`],
    [colLogistics, `${ccy}${result.barebone.logistics.toFixed(2)}`, `${ccy}${result.compliant.logistics.toFixed(2)}`, `${ccy}${(result.compliant.logistics - result.barebone.logistics).toFixed(2)}`],
    [colTotalCost, `${ccy}${result.barebone.total.toFixed(2)}`, `${ccy}${result.compliant.total.toFixed(2)}`, `${ccy}${(result.compliant.total - result.barebone.total).toFixed(2)}`],
  ], [58, 28, 28, 28]);

  // ── Section 2: Revenue Comparison ─────────────────────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, rp("revenueComparison"));
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, [
    [colRevenue, lblNoCompliance, lblWithCompliance, lblDiff],
    [`${colAvgPrice}（ASP）`, `${ccy}${result.barebone.asp.toFixed(2)}`, `${ccy}${result.compliant.asp.toFixed(2)}`, `${ccy}${(result.compliant.asp - result.barebone.asp).toFixed(2)}`],
    [`${colGrossProfit}`, `${ccy}${result.barebone.gp.toFixed(2)}`, `${ccy}${result.compliant.gp.toFixed(2)}`, `${ccy}${(result.compliant.gp - result.barebone.gp).toFixed(2)}`],
    [colGrossMargin, `${result.bareboneGpm.toFixed(1)}%`, `${result.compliantGpm.toFixed(1)}%`, "—"],
  ], [58, 28, 28, 28]);

  // ── Section 3: Risk-Adjusted Net Income ──────────────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, rp("riskAdjustedRevenue"));
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, [
    [lblMode, colGrossProfit, lblRiskExposure, lblRiskAdjNet],
    [lblWithCompliance, `${ccy}${result.compliant.gp.toFixed(2)}`, result.compliantRiskExposure === 0 ? lblZeroRisk : `${ccy}${result.compliantRiskExposure.toFixed(0)}`, `${ccy}${(result.compliant.gp - result.compliantRiskExposure / 100).toFixed(2)}`],
    [lblNoCompliance, `${ccy}${result.barebone.gp.toFixed(2)}`, lblSeizureRisk, `${ccy}${(result.barebone.gp - result.bareboneRiskExposure / 100).toFixed(2)}`],
  ], [40, 26, 40, 36]);

  if (result.riskNote) {
    pdfBullet(doc, y, margin, pageWidth, pageHeight, result.riskNote);
  }

  // ── Section 4: Breakeven Analysis ───────────────────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, rp("breakEvenAnalysis"));
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, [
    [lblAnalysis, lblNoCompliance, lblWithCompliance, lblExplanation],
    [lblCompliancePremium, "—", result.premiumPct || "—", result.premiumPct ? `${L === "zh" ? "成本增加" : "Cost increase"} ${result.premiumPct}` : "—"],
    [lblBreakevenUnits, "—", result.breakevenUnits || "—", result.breakevenUnits ? `${L === "zh" ? "约" : "Approx."} ${result.breakevenUnits}` : "—"],
    [lblSuggestedPrice, "—", `${ccy}${result.compliant.asp.toFixed(0)}`, result.pricingStrategy || "—"],
  ], [40, 26, 36, 40]);

  if (result.pricingStrategy) {
    pdfBullet(doc, y, margin, pageWidth, pageHeight, `${lblPricingStrategy}：${result.pricingStrategy}`);
  }

  // ── Section 5: Conclusions ──────────────────────────────────────────────
  const conclusionText = result.conclusions || result.keyConclusion || "";
  if (conclusionText) {
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, rp("keyConclusions"));
    for (const line of conclusionText.split("\n").filter(Boolean)) {
      pdfBullet(doc, y, margin, pageWidth, pageHeight, line);
    }
  }

  // ── Section 6: References ──────────────────────────────────────────────
  if (result.references) {
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, rp("regulationCitations"));
    for (const line of result.references.split("\n").filter(Boolean)) {
      const clean = line.replace(/^[-*]\s*/, "• ");
      pdfBullet(doc, y, margin, pageWidth, pageHeight, clean);
    }
  }

  // ── Fallback: Full markdown report ─────────────────────────────────────
  if (!result.references && !result.conclusions && result.report) {
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, lblFullReport);
    pdfBody(doc, y, margin, pageWidth, pageHeight, parseMarkdownToPdfText(result.report), 8.5);
  }

  // ── Footer on each page ──────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    doc.text(
      `${rp("profitTitle")} · ${result.sessionId} · ${L === "zh" ? "第" : "Page"} ${i}/${pageCount}`,
      pageWidth / 2,
      pageHeight - 6,
      { align: "center" }
    );
  }

  doc.save(L === "zh" ? `成本利润分析报告_${result.sessionId}.pdf` : `CostProfitAnalysisReport_${result.sessionId}.pdf`);
}

// ── DOCX Profit Export ────────────────────────────────────────────────────────

function mkCell(text: string, isHeader = false, color = "333333"): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: isHeader, size: 20, color })] })],
    shading: isHeader ? { fill: "EEEEF8", type: "solid" } : undefined,
  });
}

function mkSectionH(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 28 })],
    spacing: { before: 320, after: 120 },
  });
}

function mkBullet(text: string): Paragraph {
  const clean = text.replace(/^\d+[\.\)]\s*/, "• ").replace(/\*\*(.*?)\*\*/g, "$1");
  return new Paragraph({
    children: [new TextRun({ text: clean, size: 22 })],
    indent: { left: 360 },
    spacing: { after: 80 },
  });
}

function docxTable(rows: string[][], colColors: string[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, ri) =>
      new TableRow({
        children: row.map((cell, ci) => mkCell(cell, ri === 0, ri === 0 ? "555555" : colColors[ci] || "333333")),
      })
    ),
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB" },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB" },
      left: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB" },
      right: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
    },
  });
}

export async function downloadProfitReportAsDocx(result: ProfitReportResult, locale?: Locale): Promise<void> {
  const L = resolveLocale(locale);
  const ccy = "¥";
  const dateFmt = L === "zh" ? "zh-CN" : "en-US";

  // Translation shortcuts
  const rp = (k: string) => tx(`report.${k}`, L);
  const lblNoCompliance = rp("labels.noCompliance");
  const lblWithCompliance = rp("labels.withCompliance");
  const colCostItem = rp("columns.costItem");
  const colBomCost = rp("columns.bomCost");
  const colPackaging = rp("columns.packaging");
  const colCertAmort = rp("columns.certAmortization");
  const colEprFee = rp("columns.eprFee");
  const colAfterSales = rp("columns.afterSales");
  const colWarranty = rp("columns.warranty");
  const colLogistics = rp("columns.logistics");
  const colTotalCost = rp("columns.totalDirectCost");
  const colRevenue = rp("columns.revenue");
  const colAvgPrice = rp("columns.avgPrice");
  const colGrossProfit = rp("columns.grossProfit");
  const colGrossMargin = rp("columns.grossMargin");
  const lblGrossProfit = rp("cards.grossProfit");
  const lblRiskExposure = rp("cards.riskExposure");
  const lblMode = L === "zh" ? "模式" : "Mode";
  const lblAnalysis = L === "zh" ? "分析项" : "Analysis Item";
  const lblDiff = L === "zh" ? "差值" : "Diff.";
  const lblExplanation = L === "zh" ? "说明" : "Notes";
  const lblCompliancePremium = L === "zh" ? "合规溢价" : "Compliance Premium";
  const lblBreakeven = L === "zh" ? "盈亏平衡台数" : "Break-even Units";
  const lblSuggestedPrice = L === "zh" ? "建议定价" : "Suggested Price";
  const lblRiskAdjNet = L === "zh" ? "经风险调整净收益" : "Risk-Adjusted Net";
  const lblZeroRisk = L === "zh" ? "零风险敞口" : "Zero risk exposure";
  const lblSeizureRisk = L === "zh" ? "35-50% 扣押概率" : "35-50% seizure probability";
  const lblPricingStrategy = L === "zh" ? "定价策略" : "Pricing Strategy";
  const lblFullReport = L === "zh" ? "完整分析报告" : "Full Analysis Report";

  const costRows: string[][] = [
    [colCostItem, lblNoCompliance, lblWithCompliance, lblDiff],
    [colBomCost, `${ccy}${result.barebone.bom.toFixed(2)}`, `${ccy}${result.compliant.bom.toFixed(2)}`, `${ccy}${(result.compliant.bom - result.barebone.bom).toFixed(2)}`],
    [colPackaging, `${ccy}${result.barebone.packaging.toFixed(2)}`, `${ccy}${result.compliant.packaging.toFixed(2)}`, `${ccy}${(result.compliant.packaging - result.barebone.packaging).toFixed(2)}`],
    [colCertAmort, `${ccy}${result.barebone.cert.toFixed(2)}`, `${ccy}${result.compliant.cert.toFixed(2)}`, `${ccy}${(result.compliant.cert - result.barebone.cert).toFixed(2)}`],
    [colEprFee, `${ccy}${result.barebone.epr.toFixed(2)}`, `${ccy}${result.compliant.epr.toFixed(2)}`, `${ccy}${(result.compliant.epr - result.barebone.epr).toFixed(2)}`],
    [`${colAfterSales}/${colWarranty}`, `${ccy}${result.barebone.warranty.toFixed(2)}`, `${ccy}${result.compliant.warranty.toFixed(2)}`, `${ccy}${(result.compliant.warranty - result.barebone.warranty).toFixed(2)}`],
    [colLogistics, `${ccy}${result.barebone.logistics.toFixed(2)}`, `${ccy}${result.compliant.logistics.toFixed(2)}`, `${ccy}${(result.compliant.logistics - result.barebone.logistics).toFixed(2)}`],
    [colTotalCost, `${ccy}${result.barebone.total.toFixed(2)}`, `${ccy}${result.compliant.total.toFixed(2)}`, `${ccy}${(result.compliant.total - result.barebone.total).toFixed(2)}`],
  ];

  const revenueRows: string[][] = [
    [colRevenue, lblNoCompliance, lblWithCompliance, lblDiff],
    [`${colAvgPrice}（ASP）`, `${ccy}${result.barebone.asp.toFixed(2)}`, `${ccy}${result.compliant.asp.toFixed(2)}`, `${ccy}${(result.compliant.asp - result.barebone.asp).toFixed(2)}`],
    [`${colGrossProfit}`, `${ccy}${result.barebone.gp.toFixed(2)}`, `${ccy}${result.compliant.gp.toFixed(2)}`, `${ccy}${(result.compliant.gp - result.barebone.gp).toFixed(2)}`],
    [colGrossMargin, `${result.bareboneGpm.toFixed(1)}%`, `${result.compliantGpm.toFixed(1)}%`, "—"],
  ];

  const riskRows: string[][] = [
    [lblMode, colGrossProfit, lblRiskExposure, lblRiskAdjNet],
    [lblWithCompliance, `${ccy}${result.compliant.gp.toFixed(2)}`, result.compliantRiskExposure === 0 ? lblZeroRisk : `${ccy}${result.compliantRiskExposure.toFixed(0)}`, `${ccy}${result.compliant.gp.toFixed(2)}`],
    [lblNoCompliance, `${ccy}${result.barebone.gp.toFixed(2)}`, lblSeizureRisk, `${ccy}${(result.barebone.gp - result.bareboneRiskExposure / 100).toFixed(2)}`],
  ];

  const breakevenRows: string[][] = [
    [lblAnalysis, lblNoCompliance, lblWithCompliance, lblExplanation],
    [lblCompliancePremium, "—", result.premiumPct || "—", result.premiumPct ? `${L === "zh" ? "成本增加" : "Cost increase"} ${result.premiumPct}` : "—"],
    [lblBreakeven, "—", result.breakevenUnits || "—", result.breakevenUnits ? `${L === "zh" ? "约" : "Approx."} ${result.breakevenUnits}` : "—"],
    [lblSuggestedPrice, "—", `${ccy}${result.compliant.asp.toFixed(0)}`, result.pricingStrategy || "—"],
  ];

  const conclusionParas: Paragraph[] = [];
  const conclusionText = result.conclusions || result.keyConclusion || "";
  if (conclusionText) {
    for (const line of conclusionText.split("\n").filter(Boolean)) {
      conclusionParas.push(mkBullet(line));
    }
  }

  const refParas: Paragraph[] = [];
  if (result.references) {
    for (const line of result.references.split("\n").filter(Boolean)) {
      const clean = line.replace(/^[-*]\s*/, "• ");
      refParas.push(mkBullet(clean));
    }
  }

  const lblSessionId = rp("sessionId");
  const lblGeneratedAt = rp("generatedAt");
  const brand = rp("brand");

  const doc = new Document({
    styles: {
      paragraphStyles: [{ id: "Normal", name: "Normal", run: { font: "Arial", size: 22 } }],
    },
    sections: [
      {
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 900 } } },
        children: [
          // Title
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: rp("profitTitle"), bold: true, size: 36, color: "C41E3A" })],
            spacing: { after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `${tx("report.labels.product", L)}：${result.productType}　　${tx("report.labels.market", L)}：${result.market}　　${tx("report.labels.date", L)}：${new Date(result.generatedAt).toLocaleDateString(dateFmt)}`, size: 22, color: "666666" })],
            spacing: { after: 240 },
          }),

          // Summary cards
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({
              children: [
                new TableCell({ children: [
                  new Paragraph({ children: [new TextRun({ text: lblNoCompliance, bold: true, size: 20, color: "CC4444" })], spacing: { after: 80 } }),
                  new Paragraph({ children: [new TextRun({ text: `${lblGrossProfit}：${ccy}${result.barebone.gp.toFixed(0)}`, size: 24, bold: true, color: "CC4444" })], spacing: { after: 60 } }),
                  new Paragraph({ children: [new TextRun({ text: `${lblRiskExposure}：${ccy}${result.bareboneRiskExposure.toFixed(0)}`, size: 20, color: "994444" })], spacing: { after: 0 } }),
                ], width: { size: 50, type: WidthType.PERCENTAGE }, shading: { fill: "FFF0F0", type: "solid" } }),
                new TableCell({ children: [
                  new Paragraph({ children: [new TextRun({ text: lblWithCompliance, bold: true, size: 20, color: "1E8A46" })], spacing: { after: 80 } }),
                  new Paragraph({ children: [new TextRun({ text: `${lblGrossProfit}：${ccy}${result.compliant.gp.toFixed(0)}`, size: 24, bold: true, color: "1E8A46" })], spacing: { after: 60 } }),
                  new Paragraph({ children: [new TextRun({ text: `${lblRiskExposure}：${ccy}${result.compliantRiskExposure.toFixed(0)}`, size: 20, color: "1A6636" })], spacing: { after: 0 } }),
                ], width: { size: 50, type: WidthType.PERCENTAGE }, shading: { fill: "F0FFF5", type: "solid" } }),
              ],
            })],
            borders: {
              top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "DDDDDD" },
            },
          }),

          new Paragraph({ text: "" }),

          // Section 1
          mkSectionH(`${rp("costComparison")}（${lblWithCompliance} vs ${lblNoCompliance}）`),
          docxTable(costRows, ["BB3333", "1A7A40", "333333"]),
          new Paragraph({ text: "" }),

          // Section 2
          mkSectionH(rp("revenueComparison")),
          docxTable(revenueRows, ["BB3333", "1A7A40", "333333"]),
          new Paragraph({ text: "" }),

          // Section 3
          mkSectionH(rp("riskAdjustedRevenue")),
          docxTable(riskRows, ["BB3333", "1A7A40", "333333"]),
          ...(result.riskNote ? [mkBullet(result.riskNote)] : []),
          new Paragraph({ text: "" }),

          // Section 4
          mkSectionH(rp("breakEvenAnalysis")),
          docxTable(breakevenRows, ["BB3333", "1A7A40", "333333"]),
          ...(result.pricingStrategy ? [mkBullet(`${lblPricingStrategy}：${result.pricingStrategy}`)] : []),
          new Paragraph({ text: "" }),

          // Section 5
          ...(conclusionParas.length > 0
            ? [mkSectionH(rp("keyConclusions")), ...conclusionParas, new Paragraph({ text: "" })]
            : []),

          // Section 6
          ...(refParas.length > 0
            ? [mkSectionH(rp("regulationCitations")), ...refParas, new Paragraph({ text: "" })]
            : []),

          // Fallback full report
          ...(!result.references && !result.conclusions && result.report
            ? [mkSectionH(lblFullReport), ...parseMarkdownToDocx(result.report), new Paragraph({ text: "" })]
            : []),

          // Footer
          new Paragraph({
            children: [new TextRun({ text: `${lblSessionId}：${result.sessionId}  |  ${lblGeneratedAt}：${new Date(result.generatedAt).toLocaleString(dateFmt)}  |  ${brand}`, size: 18, color: "888888" })],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = L === "zh" ? `成本利润分析报告_${result.sessionId}.docx` : `CostProfitAnalysisReport_${result.sessionId}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
