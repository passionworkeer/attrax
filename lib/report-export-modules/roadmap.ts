/**
 * roadmap.ts — structured compliance roadmap PDF/DOCX export.
 *
 * Renders a compliance roadmap document with:
 *   - Current status overview
 *   - Milestone steps with optional descriptions, cost, and timeline
 *   - Estimated total duration and cost
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

export interface RoadmapContent {
  sessionId: string;
  currentStatus?: string;    // e.g. "PASS" | "WARN" | "REJECTED"
  currentStatusEn?: string;
  totalDays?: number;
  totalCost?: string;
  items: Array<{
    title: string;
    titleEn?: string;
    description?: string;
    descriptionEn?: string;
    cost?: string;
    days?: number;
    status?: string;
    statusEn?: string;
  }>;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function statusLabel(status: string | undefined, locale: Locale): string {
  const v = status?.toUpperCase();
  if (v === "PASS")      return tx("complianceStatus.passed",    locale);
  if (v === "WARN")      return tx("complianceStatus.warning",  locale);
  if (v === "REJECTED") return tx("complianceStatus.rejected", locale);
  if (v === "COMPLETED") return locale === "zh" ? "已完成" : "Completed";
  if (v === "IN_PROGRESS") return locale === "zh" ? "进行中" : "In Progress";
  if (v === "PENDING")  return locale === "zh" ? "待处理" : "Pending";
  return status ?? (locale === "zh" ? "未知" : "Unknown");
}

function statusColor(status: string | undefined): [number, number, number] {
  switch (status?.toUpperCase()) {
    case "PASS":        return [16, 185, 129];
    case "WARN":        return [245, 158, 11];
    case "REJECTED":    return [239, 68, 68];
    case "COMPLETED":   return [16, 185, 129];
    case "IN_PROGRESS": return [59, 130, 246];
    default:            return [156, 163, 175];
  }
}

/* ─── PDF ─────────────────────────────────────────────────────────────────── */

export async function downloadRoadmapReportAsPdf(
  content: RoadmapContent,
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
  const title = L === "zh" ? "合规路线图报告" : "Compliance Roadmap Report";
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

  // ── Current Status + Overview ─────────────────────────────────────────────
  if (content.currentStatus) {
    const c = statusColor(content.currentStatus);
    const statusText = statusLabel(content.currentStatus, L);
    const label = L === "zh" ? "当前状态" : "Current Status";
    const w = doc.getTextWidth(` ${label} ${statusText} `) + 8;

    doc.setFillColor(c[0], c[1], c[2]);
    doc.setDrawColor(c[0], c[1], c[2]);
    doc.setLineWidth(0.4);
    doc.roundedRect(margin, y, w, 9, 2, 2, "FD");
    doc.setFontSize(10);
    doc.setTextColor(255, 255, 255);
    doc.setFont("NotoSansSC", "bold");
    doc.text(` ${label} ${statusText} `, margin + 4, y + 6);
    y += 14;
    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
  }

  // ── Summary row ────────────────────────────────────────────────────────────
  if (content.totalDays || content.totalCost) {
    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);

    if (content.totalDays) {
      const daysLabel = L === "zh" ? `总工期：${content.totalDays} 天` : `Total Duration: ${content.totalDays} days`;
      doc.text(daysLabel, margin, y);
      y += 5;
    }
    if (content.totalCost) {
      const costLabel = L === "zh" ? `预估成本：${content.totalCost}` : `Estimated Cost: ${content.totalCost}`;
      doc.text(costLabel, margin, y);
      y += 5;
    }
    y += 4;
    doc.setDrawColor(220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
  }

  // ── Roadmap Steps ─────────────────────────────────────────────────────────
  const stepTitle = L === "zh" ? "执行步骤" : "Steps";
  const stepNo    = L === "zh" ? "步骤" : "Step";
  const statusCol = L === "zh" ? "状态" : "Status";
  const costCol   = L === "zh" ? "预估成本" : "Est. Cost";
  const durCol    = L === "zh" ? "工期(天)" : "Dur. (days)";

  // Section header
  doc.setFont("NotoSansSC", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(stepTitle, margin, y);
  y += 4;
  doc.setDrawColor(200, 200, 215);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  // Table: Step | Title | Description | Status | Cost | Duration
  const colWidths = [10, 42, 52, 26, 24, 20];
  const rowH = 7;
  const contentW = pageWidth - margin * 2;

  // Header row
  const drawHeaderCell = (text: string, x: number, w: number) => {
    doc.setFillColor(238, 238, 248);
    doc.setDrawColor(200, 200, 220);
    doc.rect(x, y, w, rowH, "FD");
    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 100);
    doc.text(text, x + 2, y + rowH - 1.5);
  };

  let x = margin;
  drawHeaderCell(stepNo,    x, colWidths[0]); x += colWidths[0];
  drawHeaderCell("Title",   x, colWidths[1]); x += colWidths[1];
  drawHeaderCell("Description", x, colWidths[2]); x += colWidths[2];
  drawHeaderCell(statusCol, x, colWidths[3]); x += colWidths[3];
  drawHeaderCell(costCol,   x, colWidths[4]); x += colWidths[4];
  drawHeaderCell(durCol,    x, colWidths[5]);
  y += rowH;

  // Data rows
  for (let i = 0; i < content.items.length; i++) {
    const item = content.items[i];
    const title = L === "zh" ? (item.title ?? item.titleEn ?? "") : (item.titleEn ?? item.title ?? "");
    const desc  = L === "zh" ? (item.description ?? item.descriptionEn ?? "") : (item.descriptionEn ?? item.description ?? "");
    const sLabel = statusLabel(item.status, L);
    const sc     = statusColor(item.status);

    if (y + rowH > pageHeight - margin) { doc.addPage(); y = margin; }

    x = margin;
    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.setDrawColor(225, 225, 235);
    doc.rect(x, y, colWidths[0], rowH, "S");
    doc.text(`${i + 1}`, x + 3, y + rowH - 1.5); x += colWidths[0];

    doc.setTextColor(30, 30, 30);
    doc.rect(x, y, colWidths[1], rowH, "S");
    doc.text(doc.splitTextToSize(title, colWidths[1] - 4)[0] ?? title, x + 2, y + rowH - 1.5); x += colWidths[1];

    doc.setTextColor(80, 80, 80);
    doc.rect(x, y, colWidths[2], rowH, "S");
    doc.text(doc.splitTextToSize(desc, colWidths[2] - 4)[0] ?? desc, x + 2, y + rowH - 1.5); x += colWidths[2];

    doc.setTextColor(sc[0], sc[1], sc[2]);
    doc.rect(x, y, colWidths[3], rowH, "S");
    doc.text(doc.splitTextToSize(sLabel, colWidths[3] - 4)[0] ?? sLabel, x + 2, y + rowH - 1.5); x += colWidths[3];

    doc.setTextColor(80, 80, 80);
    doc.rect(x, y, colWidths[4], rowH, "S");
    doc.text(item.cost ?? "—", x + 2, y + rowH - 1.5); x += colWidths[4];

    doc.rect(x, y, colWidths[5], rowH, "S");
    doc.text(item.days ? String(item.days) : "—", x + 2, y + rowH - 1.5);
    y += rowH;
  }

  y += 4;

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
      ? `合规路线图报告_${content.sessionId}.pdf`
      : `ComplianceRoadmap_${content.sessionId}.pdf`
  );
}

/* ─── DOCX ─────────────────────────────────────────────────────────────────── */

export async function downloadRoadmapReportAsDocx(
  content: RoadmapContent,
  locale?: Locale,
): Promise<void> {
  const L = resolveLocale(locale);
  const children: Array<Paragraph | Table> = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({
        text: L === "zh" ? "合规路线图报告" : "Compliance Roadmap Report",
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

  // Summary row (total days + cost)
  if (content.totalDays || content.totalCost) {
    const summaryRows: string[][] = [[]];
    if (content.totalDays) {
      summaryRows[0].push(
        L === "zh" ? `总工期：${content.totalDays} 天` : `Total Duration: ${content.totalDays} days`
      );
    }
    if (content.totalCost) {
      summaryRows[0].push(
        L === "zh" ? `预估成本：${content.totalCost}` : `Estimated Cost: ${content.totalCost}`
      );
    }
    if (summaryRows[0].length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({
            children: summaryRows[0].map((cell) =>
              new TableCell({
                children: [new Paragraph({
                  children: [new TextRun({ text: cell, bold: true, size: 22, color: "555555" })],
                  alignment: AlignmentType.CENTER,
                })],
                width: { size: 100 / summaryRows[0].length, type: WidthType.PERCENTAGE },
                shading: { fill: "F5F5F8", type: "solid" },
              })
            ),
          })],
          borders: {
            top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE },
            insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "DDDDDD" },
          },
        })
      );
      children.push(new Paragraph({ text: "" }));
    }
  }

  // Steps section
  if (content.items.length > 0) {
    children.push(mkSectionH(L === "zh" ? "执行步骤" : "Steps"));

    for (let i = 0; i < content.items.length; i++) {
      const item = content.items[i];
      const title = L === "zh" ? (item.title ?? item.titleEn ?? "") : (item.titleEn ?? item.title ?? "");
      const desc  = L === "zh" ? (item.description ?? item.descriptionEn ?? "") : (item.descriptionEn ?? item.description ?? "");
      const sLabel = statusLabel(item.status, L);
      const sc     = statusColor(item.status);
      const hexColor = `#${sc[0].toString(16).padStart(2, "0")}${sc[1].toString(16).padStart(2, "0")}${sc[2].toString(16).padStart(2, "0")}`;

      const stepLines: string[] = [`**${L === "zh" ? `步骤 ${i + 1}` : `Step ${i + 1}`}: ${title}**`];
      if (desc)        stepLines.push(desc);
      if (item.cost)   stepLines.push(`${L === "zh" ? "预估成本" : "Est. Cost"}: ${item.cost}`);
      if (item.days)   stepLines.push(`${L === "zh" ? "工期" : "Duration"}: ${item.days} ${L === "zh" ? "天" : "days"}`);
      stepLines.push(`${L === "zh" ? "状态" : "Status"}: ${sLabel}`);

      children.push(
        new Paragraph({
          children: [new TextRun({ text: stepLines.join("  |  "), size: 22, color: hexColor })],
          spacing: { after: 80 },
          indent: { left: 360 },
        })
      );
    }
    children.push(new Paragraph({ text: "" }));
  }

  // Current status
  if (content.currentStatus) {
    const c = statusColor(content.currentStatus);
    const sLabel = statusLabel(content.currentStatus, L);
    const hexColor = `#${c[0].toString(16).padStart(2, "0")}${c[1].toString(16).padStart(2, "0")}${c[2].toString(16).padStart(2, "0")}`;
    children.push(mkSectionH(L === "zh" ? "当前状态" : "Current Status"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: sLabel, bold: true, size: 24, color: hexColor })],
        spacing: { after: 100 },
      })
    );
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
    ? `合规路线图报告_${content.sessionId}.docx`
    : `ComplianceRoadmap_${content.sessionId}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}