/**
 * decision.ts — structured AI decision report PDF/DOCX export.
 *
 * Accepts a DecisionContent object and renders a formatted document with:
 *   - Overall verdict (PASS / WARN / REJECTED)
 *   - Risk level badge
 *   - Key reasons / findings
 *   - Recommended action
 *   - Node evidence (optional)
 *
 * Both zh (Chinese labels) and en (English labels) variants.
 */

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
import type { Locale } from "./shared";
import { embedFont, mkBullet, mkSectionH, resolveLocale, tx } from "./shared";

/* ─── Shared type ─────────────────────────────────────────────────────────── */

export interface DecisionContent {
  sessionId: string;
  verdict?: string;          // "PASS" | "WARN" | "REJECTED" | string
  riskLevel?: string;        // "HIGH" | "MEDIUM" | "LOW" | string
  summary?: string;
  keyFindings?: string[];
  recommendedAction?: string;
  nodesEvidence?: Array<{
    type?: string;
    label?: string;
    labelEn?: string;
    reasoning?: string;
    reasoningEn?: string;
  }>;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function riskColor(risk: string | undefined): [number, number, number] {
  switch (risk?.toUpperCase()) {
    case "HIGH":   return [239, 68, 68];
    case "MEDIUM": return [245, 158, 11];
    case "LOW":    return [16, 185, 129];
    default:       return [100, 100, 100];
  }
}

function verdictStatusLabel(verdict: string | undefined, locale: Locale): string {
  const v = verdict?.toUpperCase();
  if (v === "PASS")     return tx("complianceStatus.passed",    locale);
  if (v === "WARN")     return tx("complianceStatus.warning",  locale);
  if (v === "REJECTED") return tx("complianceStatus.rejected", locale);
  return locale === "zh" ? "未知" : "Unknown";
}

/* ─── PDF ─────────────────────────────────────────────────────────────────── */

export async function downloadDecisionReportAsPdf(
  content: DecisionContent,
  locale?: Locale,
): Promise<void> {
  const L = resolveLocale(locale);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await embedFont(doc);

  const pageWidth  = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin     = 20;
  let y            = margin;

  const t = (key: string) => tx(key, L);

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setTextColor(180);
  doc.text(t("report.title"), margin, y);
  y += 6;
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ── Title ─────────────────────────────────────────────────────────────────
  const title = L === "zh" ? "AI 决策报告" : "AI Decision Report";
  doc.setFontSize(20);
  doc.setTextColor(30, 30, 30);
  doc.setFont("NotoSansSC", "bold");
  doc.text(title, margin, y);
  y += 9;
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text(`${t("report.sessionId")}：${content.sessionId}`, margin, y);
  y += 8;
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ── Verdict + Risk Level cards ─────────────────────────────────────────────
  const verdictColor = riskColor(content.riskLevel);
  const statusText   = verdictStatusLabel(content.verdict, L);
  const riskText     = content.riskLevel
    ? (L === "zh" ? `风险等级：${content.riskLevel}` : `Risk Level: ${content.riskLevel}`)
    : "";

  const verdictW = doc.getTextWidth(` ${statusText} `) + 6;
  const riskW   = content.riskLevel ? doc.getTextWidth(` ${riskText} `) + 6 : 0;
  const totalBadgeW = verdictW + (riskW ? riskW + 4 : 0);

  doc.setFillColor(verdictColor[0], verdictColor[1], verdictColor[2]);
  doc.setDrawColor(verdictColor[0], verdictColor[1], verdictColor[2]);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, verdictW, 9, 2, 2, "FD");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.setFont("NotoSansSC", "bold");
  doc.text(` ${statusText} `, margin + 3, y + 6);

  if (riskW > 0) {
    doc.setFillColor(verdictColor[0] * 0.85, verdictColor[1] * 0.85, verdictColor[2] * 0.85);
    doc.setDrawColor(verdictColor[0], verdictColor[1], verdictColor[2]);
    doc.roundedRect(margin + verdictW + 4, y, riskW, 9, 2, 2, "FD");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.setFont("NotoSansSC", "bold");
    doc.text(` ${riskText} `, margin + verdictW + 7, y + 6);
  }

  y += 14;
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ── Summary ────────────────────────────────────────────────────────────────
  if (content.summary) {
    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(L === "zh" ? "决策摘要" : "Summary", margin, y);
    y += 5;
    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const summaryLines = doc.splitTextToSize(content.summary, pageWidth - margin * 2);
    doc.text(summaryLines, margin, y);
    y += summaryLines.length * 5 + 8;
  }

  // ── Key Findings ───────────────────────────────────────────────────────────
  if (content.keyFindings && content.keyFindings.length > 0) {
    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(L === "zh" ? "关键发现" : "Key Findings", margin, y);
    y += 5;
    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    for (const finding of content.keyFindings) {
      if (y + 6 > pageHeight - margin) { doc.addPage(); y = margin; }
      doc.text(`  • ${finding}`, margin, y);
      y += 6;
    }
    y += 4;
  }

  // ── Recommended Action ────────────────────────────────────────────────────
  if (content.recommendedAction) {
    if (y + 6 > pageHeight - margin) { doc.addPage(); y = margin; }
    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(L === "zh" ? "建议行动" : "Recommended Action", margin, y);
    y += 5;
    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const actionLines = doc.splitTextToSize(content.recommendedAction, pageWidth - margin * 2);
    doc.text(actionLines, margin, y);
    y += actionLines.length * 5 + 8;
  }

  // ── Node Evidence ───────────────────────────────────────────────────────────
  if (content.nodesEvidence && content.nodesEvidence.length > 0) {
    if (y + 6 > pageHeight - margin) { doc.addPage(); y = margin; }
    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(L === "zh" ? "节点证据" : "Node Evidence", margin, y);
    y += 5;
    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);
    for (const node of content.nodesEvidence) {
      if (y + 6 > pageHeight - margin) { doc.addPage(); y = margin; }
      const label = L === "zh"
        ? (node.label ?? node.labelEn ?? node.type ?? "")
        : (node.labelEn ?? node.label ?? node.type ?? "");
      const reasoning = L === "zh"
        ? (node.reasoning ?? node.reasoningEn ?? "")
        : (node.reasoningEn ?? node.reasoning ?? "");
      doc.text(`  • ${label}：${reasoning}`, margin, y);
      y += 6;
    }
    y += 4;
  }

  // ── Footer ────────────────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(
      `${tx("report.title", L)} · ${L === "zh" ? "第" : "Page"} ${i}/${pageCount}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: "center" }
    );
  }

  doc.save(
    L === "zh"
      ? `AI决策报告_${content.sessionId}.pdf`
      : `AIDecisionReport_${content.sessionId}.pdf`
  );
}

/* ─── DOCX ──────────────────────────────────────────────────────────────────── */

export async function downloadDecisionReportAsDocx(
  content: DecisionContent,
  locale?: Locale,
): Promise<void> {
  const L = resolveLocale(locale);
  const verdictColor = riskColor(content.riskLevel);
  const statusText   = verdictStatusLabel(content.verdict, L);

  const children: Array<Paragraph | Table> = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({
        text: L === "zh" ? "AI 决策报告" : "AI Decision Report",
        bold: true, size: 36, color: "C41E3A",
      })],
      spacing: { after: 160 },
    })
  );

  // Session meta
  children.push(
    new Paragraph({
      children: [new TextRun({
        text: `${tx("report.sessionId", L)}：${content.sessionId}`,
        size: 18, color: "888888",
      })],
      spacing: { after: 200 },
    })
  );

  // Verdict + Risk summary table
  const hexColor = `#${verdictColor[0].toString(16).padStart(2, "0")}${verdictColor[1].toString(16).padStart(2, "0")}${verdictColor[2].toString(16).padStart(2, "0")}`;
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: statusText, bold: true, size: 28, color: hexColor })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: L === "zh" ? "裁决" : "Verdict", size: 18, color: "888888" })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              width: { size: 50, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({
                    text: content.riskLevel ?? "—",
                    bold: true, size: 28, color: hexColor,
                  })],
                  alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                  children: [new TextRun({ text: L === "zh" ? "风险等级" : "Risk Level", size: 18, color: "888888" })],
                  alignment: AlignmentType.CENTER,
                }),
              ],
              width: { size: 50, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
      ],
      borders: {
        top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
        left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
        insideHorizontal: { style: BorderStyle.NONE },
        insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "DDDDDD" },
      },
    })
  );
  children.push(new Paragraph({ text: "" }));

  // Summary
  if (content.summary) {
    children.push(mkSectionH(L === "zh" ? "决策摘要" : "Summary"));
    children.push(
      new Paragraph({ children: [new TextRun({ text: content.summary, size: 22 })], spacing: { after: 100 } })
    );
  }

  // Key Findings
  if (content.keyFindings && content.keyFindings.length > 0) {
    children.push(mkSectionH(L === "zh" ? "关键发现" : "Key Findings"));
    content.keyFindings.forEach((f) => children.push(mkBullet(f)));
    children.push(new Paragraph({ text: "" }));
  }

  // Recommended Action
  if (content.recommendedAction) {
    children.push(mkSectionH(L === "zh" ? "建议行动" : "Recommended Action"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: content.recommendedAction, size: 22 })],
        spacing: { after: 100 },
      })
    );
    children.push(new Paragraph({ text: "" }));
  }

  // Node Evidence
  if (content.nodesEvidence && content.nodesEvidence.length > 0) {
    children.push(mkSectionH(L === "zh" ? "节点证据" : "Node Evidence"));
    content.nodesEvidence.forEach((node) => {
      const label = L === "zh"
        ? (node.label ?? node.labelEn ?? node.type ?? "")
        : (node.labelEn ?? node.label ?? node.type ?? "");
      const reasoning = L === "zh"
        ? (node.reasoning ?? node.reasoningEn ?? "")
        : (node.reasoningEn ?? node.reasoning ?? "");
      if (label || reasoning) {
        children.push(mkBullet(`${label}${reasoning ? `：${reasoning}` : ""}`));
      }
    });
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [{ id: "Normal", name: "Normal", run: { font: "Arial", size: 22 } }],
    },
    sections: [
      {
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 900 } } },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = L === "zh"
    ? `AI决策报告_${content.sessionId}.docx`
    : `AIDecisionReport_${content.sessionId}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}