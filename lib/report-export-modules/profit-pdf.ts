import { jsPDF } from "jspdf";
import type { ProfitReportResult, ScanResult } from "@/lib/types";
import { localizeProfitReportResult } from "@/lib/report-localization";
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
  buildProfitRenderModel,
  type ProfitMetricCard,
  type ProfitRenderModel,
} from "./profit-render-model";

/**
 * `downloadProfitReportAsPdf` keeps the legacy `ProfitReportResult` signature
 * for backwards compatibility (older tests / any non-UI caller). It internally
 * rebuilds a `ProfitRenderModel` from the result so the PDF still benefits
 * from the unified layout. Prefer `downloadProfitModelAsPdf` for new code.
 */
export async function downloadProfitReportAsPdf(input: ProfitReportResult, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const result = localizeProfitReportResult(input, L);
    // Build a synthetic ScanResult + FinancialSummary so we can leverage the
    // shared `buildProfitRenderModel`. The legacy ProfitReportResult predates
    // the unified RenderModel — we map CostSummary → FinancialSummary here so
    // the wrapper still works for old callers (existing test fixtures).
    const syntheticResult: ScanResult = {
      sessionId: result.sessionId,
      scanTime: result.generatedAt,
      productName: result.productType,
      productNameEn: result.productType,
      targetMarkets: [result.market as ScanResult["targetMarkets"][number]],
      productCategory: "other",
      images: [],
      documents: [],
      generatedAt: result.generatedAt,
      reportPackage: { profitReport: { markdown: result.report ?? "" } },
      complianceScore: 0,
      scoreGrade: "C",
      financialSummary: {
        estimatedHeroicProfit: `$${result.barebone.gp.toFixed(2)}`,
        trueNetProfit: `$${result.compliant.gp.toFixed(2)}`,
        complianceCost: `$${(result.compliant.cert + result.compliant.epr + Math.max(result.compliant.packaging - result.barebone.packaging, 0)).toFixed(2)}`,
        monthlyNetProfit: result.pricingStrategy || "—",
        targetVolumeLabel: "—",
        riskExposureItems: [
          "单日最高罚款 ¥180 万",
          "全店永久封停",
          "货物强制扣毁",
          "跨境集体诉讼",
        ],
        costBreakdown: [],
      },
      riskPoints: [],
      checklist: [],
    };
    const model = buildProfitRenderModel({
      result: syntheticResult,
      financialSummary: syntheticResult.financialSummary!,
      profitMode: "compliant",
      locale: L,
    });
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
  doc.setTextColor(180);
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
  doc.setTextColor(140);
  doc.setFont("NotoSansSC", "normal");
  doc.text(`${model.productName} · ${model.marketLabel} · ${model.generatedAtLabel}`, margin, y.cur);
  y.cur += 10;

  // ── 4 metric cards (matches page.tsx grid) ─────────────────────────────────
  const halfW = (contentWidth - 4) / 2;
  const toneColor = (tone: ProfitMetricCard["tone"]): [number, number, number] => {
    switch (tone) {
      case "green": return [16, 185, 129];
      case "white": return [255, 255, 255];
      case "orange": return [244, 162, 97];
      case "blue": return [76, 201, 240];
      case "alert": return [249, 115, 96];
      default: return [255, 255, 255];
    }
  };
  const cardW = (contentWidth - 6) / 4;
  for (let i = 0; i < model.metrics.length; i++) {
    const m = model.metrics[i];
    const x = margin + i * (cardW + 2);
    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y.cur, cardW, 32, 2, 2, "S");
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.setFont("NotoSansSC", "normal");
    doc.text(m.label, x + 3, y.cur + 5);
    const [r, g, b] = toneColor(m.tone);
    doc.setTextColor(r, g, b);
    doc.setFontSize(18);
    doc.setFont("NotoSansSC", "bold");
    doc.text(m.value, x + 3, y.cur + 18);
    if (m.unit) {
      doc.setFontSize(8);
      doc.setFont("NotoSansSC", "normal");
      doc.setTextColor(180, 180, 180);
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
    `${ccy}128`,
    `${ccy}${model.chainNodes.reduce((s, n) => s + n.amount, 0).toFixed(0)}`,
    model.costBoard.finalNetValue,
  ];
  for (let i = 0; i < 3; i++) {
    const x = margin + i * (topW + 2);
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(x, y.cur, topW, 18, 2, 2, "S");
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
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
  doc.setTextColor(220, 220, 220);
  doc.setFont("NotoSansSC", "normal");
  doc.text(model.costBoard.marginSignal, margin, y.cur);
  y.cur += 6;

  // ── Section: 成本节点流 (6 nodes) ────────────────────────────────────────
  const nodeW = (contentWidth - 10) / 6;
  for (let i = 0; i < model.chainNodes.length; i++) {
    const n = model.chainNodes[i];
    const x = margin + i * (nodeW + 2);
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(x, y.cur, nodeW, 28, 2, 2, "S");
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    doc.setFont("NotoSansSC", "normal");
    doc.text(`0${i + 1}`, x + 3, y.cur + 5);
    doc.setTextColor(34, 127, 149);
    doc.setFont("NotoSansSC", "bold");
    doc.text(`${n.share.toFixed(1)}%`, x + nodeW - 12, y.cur + 5);
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.setFont("NotoSansSC", "bold");
    doc.text(n.label, x + 3, y.cur + 12);
    doc.setFontSize(7);
    doc.setTextColor(170, 170, 170);
    doc.setFont("NotoSansSC", "normal");
    const detailLines = doc.splitTextToSize(n.detail, nodeW - 6) as string[];
    detailLines.slice(0, 2).forEach((line, lineIdx) => {
      doc.text(line, x + 3, y.cur + 17 + lineIdx * 3);
    });
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
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
  doc.setTextColor(170, 170, 170);
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
    doc.setTextColor(200, 200, 200);
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
    doc.setTextColor(200, 200, 200);
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