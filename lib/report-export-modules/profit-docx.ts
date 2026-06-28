import {
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
import type { ProfitReportResult } from "@/lib/types";
import { localizeProfitReportResult } from "@/lib/report-localization";
import type { Locale } from "./shared";
import {
  docxTable,
  mkBullet,
  mkSectionH,
  parseMarkdownToDocx,
  resolveLocale,
  tx,
} from "./shared";

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  EUR: "€",
  GBP: "£",
  USD: "$",
  JPY: "¥",
};

function currencySymbol(currency?: string): string {
  return currency ? (CURRENCY_SYMBOLS[currency.toUpperCase()] ?? "$") : "$";
}

export async function downloadProfitReportAsDocx(input: ProfitReportResult, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const result = localizeProfitReportResult(input, L);
  const ccy = currencySymbol(result.currency);
  const dateFmt = L === "zh" ? "zh-CN" : "en-US";
  const colon = L === "zh" ? "：" : ": ";
  const metaGap = L === "zh" ? "　　" : "    ";
  const aspSuffix = L === "zh" ? "（ASP）" : " (ASP)";

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
    [`${colAvgPrice}${aspSuffix}`, `${ccy}${result.barebone.asp.toFixed(2)}`, `${ccy}${result.compliant.asp.toFixed(2)}`, `${ccy}${(result.compliant.asp - result.barebone.asp).toFixed(2)}`],
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
            children: [new TextRun({ text: `${tx("report.labels.product", L)}${colon}${result.productType}${metaGap}${tx("report.labels.market", L)}${colon}${result.market}${metaGap}${tx("report.labels.date", L)}${colon}${new Date(result.generatedAt).toLocaleDateString(dateFmt)}`, size: 22, color: "666666" })],
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
          mkSectionH(L === "zh" ? `${rp("costComparison")}（${lblWithCompliance} vs ${lblNoCompliance}）` : `${rp("costComparison")} (${lblWithCompliance} vs ${lblNoCompliance})`),
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
          ...(result.pricingStrategy ? [mkBullet(`${lblPricingStrategy}${colon}${result.pricingStrategy}`)] : []),
          new Paragraph({ text: "" }),

          // Section 5
          ...(conclusionParas.length > 0
            ? [mkSectionH(rp("keyConclusions")), ...conclusionParas, new Paragraph({ text: "" })]
            : []),

          // Section 6
          ...(refParas.length > 0
            ? [mkSectionH(rp("regulationCitations")), ...refParas, new Paragraph({ text: "" })]
            : []),

          // Full report appendix
          ...(result.report
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
  } catch (error) {
    throw new Error(
      `Failed to export profit DOCX report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
