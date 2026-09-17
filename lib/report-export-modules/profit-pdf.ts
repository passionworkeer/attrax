import { jsPDF } from "jspdf";
import type { ProfitReportResult } from "@/lib/types";
import { localizeProfitReportResult } from "@/lib/report-localization";
import { buildProfitRenderModelFromProfitReport } from "@/lib/pipeline/profit-report";
import type { Locale } from "./shared";
import {
  downloadBlob,
  embedFont,
  pdfCheckBreak,
  pdfSectionTitle,
  resolveLocale,
  yieldToMainThread,
} from "./shared";
import {
  type ProfitMetricCard,
  type ProfitRenderModel,
} from "./profit-render-model";

/**
 * Legacy entry point for callers that only have a `ProfitReportResult`
 * (e.g. the result-page "成本利润说明" export button). Internally rebuilds a
 * `ProfitRenderModel` via `buildProfitRenderModelFromProfitReport` so the
 * downloaded PDF matches `/profit/[sessionId]` byte-for-byte — same metric
 * labels, same hero/net/compliance numbers, same chain breakdown, same risk
 * items. New callers should prefer `downloadProfitModelAsPdf` directly.
 */
export async function downloadProfitReportAsPdf(input: ProfitReportResult, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const result = localizeProfitReportResult(input, L);
    const model = buildProfitRenderModelFromProfitReport(result, L);
    await downloadProfitModelAsPdf(model);
  } catch (error) {
    throw new Error(
      `Failed to export profit PDF report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Render a profit PDF directly from the unified `ProfitRenderModel`. This is
 * the production path used by `/profit/[sessionId]`'s export panel — it
 * guarantees the downloaded PDF shows byte-for-byte the same labels, numbers,
 * and bare-mode caveat the user is looking at on screen.
 */
export async function downloadProfitModelAsPdf(model: ProfitRenderModel): Promise<void> {
  try {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await embedFont(doc);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;
    const y = { cur: margin };
    const ccy = model.currencySymbol;

  // ── Header bar ────────────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.setFont("NotoSansSC", "normal");
  doc.text(model.title, margin, y.cur);
  y.cur += 5;
  doc.setDrawColor(220);
  doc.line(margin, y.cur, pageWidth - margin, y.cur);
  y.cur += 7;

  // ── Title + subtitle (matches page.tsx) ───────────────────────────────────
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.setFont("NotoSansSC", "bold");
  doc.text(model.title, margin, y.cur);
  y.cur += 7;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.setFont("NotoSansSC", "normal");
  doc.text(`${model.productName} · ${model.marketLabel} · ${model.generatedAtLabel}`, margin, y.cur);
  y.cur += 10;

  // ── 4 metric cards (matches page.tsx grid) ─────────────────────────────────
  // On-screen the metric value uses `text-white` on a dark `blaze-panel`
  // background, which renders the value in white. PDFs/DOCXs have a *light*
  // page background, so the page's "white" tone must invert to a dark text
  // color (#073b54, the panel-foreground color used throughout the page) for
  // the value to remain visible. The `isCore` card additionally gets a pale
  // orange fill so the featured "核心结果" stands out the same way it does on
  // screen via the orange glow.
  const metricValueColor = (tone: ProfitMetricCard["tone"]): [number, number, number] => {
    switch (tone) {
      case "green": return [16, 185, 129];
      case "white": return [7, 59, 84]; // #073b54 — page dark text
      case "orange": return [244, 162, 97];
      case "blue": return [76, 201, 240];
      case "alert": return [249, 115, 96];
      default: return [7, 59, 84];
    }
  };
  const cardW = (contentWidth - 6) / 4;
  for (let i = 0; i < model.metrics.length; i++) {
    const m = model.metrics[i];
    const x = margin + i * (cardW + 2);
    if (m.isCore) {
      doc.setFillColor(255, 248, 240); // #FFF8F0 — pale orange feature fill
      doc.setDrawColor(60, 60, 60);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y.cur, cardW, 32, 2, 2, "FD");
    } else {
      doc.setDrawColor(60, 60, 60);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y.cur, cardW, 32, 2, 2, "S");
    }
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.setFont("NotoSansSC", "normal");
    doc.text(m.label, x + 3, y.cur + 5);
    const [r, g, b] = metricValueColor(m.tone);
    doc.setTextColor(r, g, b);
    doc.setFontSize(18);
    doc.setFont("NotoSansSC", "bold");
    doc.text(m.value, x + 3, y.cur + 18);
    if (m.unit) {
      doc.setFontSize(8);
      doc.setFont("NotoSansSC", "normal");
      doc.setTextColor(110, 110, 110);
      doc.text(m.unit, x + 3, y.cur + 27);
    }
    if (m.bareRiskCaveat) {
      doc.setFontSize(7);
      doc.setTextColor(255, 90, 77);
      doc.setFont("NotoSansSC", "normal");
      // Trim the caveat for the card so it fits. Page wraps it, but we keep
      // the full string verbatim — same caveat the user sees.
      const caveatLines = doc.splitTextToSize(m.bareRiskCaveat, cardW - 6) as string[];
      caveatLines.slice(0, 2).forEach((line, lineIdx) => {
        doc.text(line, x + 3, y.cur + 30 + lineIdx * 3);
      });
    }
  }
  y.cur += 38;

  await yieldToMainThread();

  // ── Section: 全链路成本明细 (cost impact board) ─────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, model.chainNodes.length > 0 ? "全链路成本明细" : "Cost Breakdown");
  // Top 3 summary cards (retail / chain cost / final net)
  const topW = (contentWidth - 4) / 3;
  const topLabels = ["售价基线", "全链路成本", "最终净利润"];
  const topValues = [
    `${ccy}${(model.costBoard.finalNetNumber + model.chainNodes.reduce((s, n) => s + n.amount, 0)).toFixed(2)}`,
    `${ccy}${model.chainNodes.reduce((s, n) => s + n.amount, 0).toFixed(2)}`,
    model.costBoard.finalNetValue,
  ];
  for (let i = 0; i < 3; i++) {
    const x = margin + i * (topW + 2);
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(x, y.cur, topW, 18, 2, 2, "S");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.setFont("NotoSansSC", "normal");
    doc.text(topLabels[i], x + 3, y.cur + 5);
    doc.setFontSize(13);
    if (i === 2) {
      doc.setTextColor(22, 128, 150);
    } else {
      doc.setTextColor(40, 40, 40);
    }
    doc.setFont("NotoSansSC", "bold");
    doc.text(topValues[i], x + 3, y.cur + 14);
  }
  y.cur += 22;

  // Diagnostic line (margin signal)
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.setFont("NotoSansSC", "normal");
  doc.text(model.costBoard.marginSignal, margin, y.cur);
  y.cur += 6;

  // ── Section: 成本节点流 (6 nodes) ────────────────────────────────────────
  const nodeW = (contentWidth - 10) / 6;
  for (let i = 0; i < model.chainNodes.length; i++) {
    const n = model.chainNodes[i];
    const x = margin + i * (nodeW + 2);
    // Chain-node cards live on a white PDF background — white text on white
    // would be invisible, so use the panel dark text color for the label
    // and amount. The thin color stripe at the bottom is purely decorative.
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(x, y.cur, nodeW, 28, 2, 2, "S");
    doc.setFontSize(7);
  doc.setTextColor(105, 105, 105);
    doc.setFont("NotoSansSC", "normal");
    doc.text(`0${i + 1}`, x + 3, y.cur + 5);
    doc.setTextColor(34, 127, 149);
    doc.setFont("NotoSansSC", "bold");
    doc.text(`${n.share.toFixed(1)}%`, x + nodeW - 12, y.cur + 5);
    doc.setFontSize(8);
    doc.setTextColor(7, 59, 84); // #073b54 — panel dark text
    doc.setFont("NotoSansSC", "bold");
    doc.text(n.label, x + 3, y.cur + 12);
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.setFont("NotoSansSC", "normal");
    const detailLines = doc.splitTextToSize(n.detail, nodeW - 6) as string[];
    detailLines.slice(0, 2).forEach((line, lineIdx) => {
      doc.text(line, x + 3, y.cur + 17 + lineIdx * 3);
    });
    doc.setFontSize(11);
    doc.setTextColor(7, 59, 84);
    doc.setFont("NotoSansSC", "bold");
    doc.text(n.displayAmount, x + 3, y.cur + 25);
    // Color stripe at bottom of node
    doc.setFillColor(n.color);
    doc.rect(x + 3, y.cur + 27, nodeW - 6, 1, "F");
  }
  y.cur += 32;

  await yieldToMainThread();

  // ── Section: 售价分配结果 (stacked bar legend) ───────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "售价分配结果");
  const totalShare = model.chainNodes.reduce((s, n) => s + n.share, 0) + model.costBoard.finalNetShare;
  const barY = y.cur;
  doc.setFillColor(240, 240, 240);
  doc.roundedRect(margin, barY, contentWidth, 10, 2, 2, "F");
  let cursor = margin;
  for (const n of model.chainNodes) {
    if (n.share <= 0) continue;
    const segW = (n.share / Math.max(totalShare, 1)) * contentWidth;
    doc.setFillColor(n.color);
    doc.rect(cursor, barY, segW, 10, "F");
    cursor += segW;
  }
  const finalSegW = (model.costBoard.finalNetShare / Math.max(totalShare, 1)) * contentWidth;
  if (finalSegW > 0) {
    doc.setFillColor(model.finalNetGradientEnd);
    doc.rect(cursor, barY, finalSegW, 10, "F");
  }
  y.cur += 14;

  // Legend below bar
  doc.setFontSize(7);
    doc.setTextColor(105, 105, 105);
  doc.setFont("NotoSansSC", "normal");
  for (const item of model.stackLegend) {
    doc.setFillColor(item.color);
    doc.rect(margin, y.cur, 2, 2, "F");
    doc.text(`${item.label} ${item.displayAmount}`, margin + 4, y.cur + 1.5);
    y.cur += 4;
  }
  y.cur += 2;

  await yieldToMainThread();

  // ── Section: 不合规最高风险 (4 risk items) ──────────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "不合规最高风险");
  const riskW = (contentWidth - 6) / Math.max(model.riskExposureItems.length, 1);
  for (let i = 0; i < model.riskExposureItems.length; i++) {
    const r = model.riskExposureItems[i];
    const x = margin + i * (riskW + 2);
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(x, y.cur, riskW, 18, 2, 2, "S");
    doc.setFontSize(8);
    doc.setTextColor(185, 90, 80);
    doc.setFont("NotoSansSC", "bold");
    const riskLines = doc.splitTextToSize(r.label, riskW - 4) as string[];
    riskLines.slice(0, 3).forEach((line, lineIdx) => {
      doc.text(line, x + 2, y.cur + 5 + lineIdx * 4);
    });
  }
  y.cur += 22;

  await yieldToMainThread();

  // ── Optional: 后端 LLM 成本详述 ──────────────────────────────────────────
  if (model.backendMarkdown) {
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, model.backendMarkdownTitle);
    doc.setFontSize(9);
    doc.setTextColor(110, 110, 110);
    doc.setFont("NotoSansSC", "normal");
    const mdLines = doc.splitTextToSize(model.backendMarkdown, contentWidth) as string[];
    for (const line of mdLines) {
      const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, 5);
      if (ny !== y.cur) y.cur = ny;
      doc.text(line, margin, y.cur);
      y.cur += 4;
    }
    y.cur += 4;
  }

  await yieldToMainThread();

  // ── Footer on each page ──────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.text(
      `${model.title} · ${model.sessionId} · 第 ${i}/${pageCount} 页`,
      pageWidth / 2,
      pageHeight - 6,
      { align: "center" }
    );
  }

  const filename = `${model.exportBasename}_${model.sessionId}.pdf`;
  downloadBlob(doc.output("blob"), filename);
  } catch (error) {
    throw new Error(
      `Failed to export profit PDF report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
