import { jsPDF } from "jspdf";
import type { ProfitReportResult } from "@/lib/types";
import type { Locale } from "./shared";
import {
  embedFont,
  parseMarkdownToPdfText,
  pdfBody,
  pdfBullet,
  pdfDrawTable,
  pdfSectionTitle,
  resolveLocale,
  tx,
} from "./shared";

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
