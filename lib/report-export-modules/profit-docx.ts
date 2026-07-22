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
import type { ProfitReportResult, ScanResult } from "@/lib/types";
import { localizeProfitReportResult } from "@/lib/report-localization";
import type { Locale } from "./shared";
import {
  downloadBlob,
  mkSectionH,
  resolveLocale,
} from "./shared";
import {
  buildProfitRenderModel,
  type ProfitMetricCard,
  type ProfitRenderModel,
} from "./profit-render-model";

/**
 * Legacy wrapper for `ProfitReportResult` → DOCX. Internally builds the same
 * RenderModel used by `downloadProfitModelAsDocx`. New callers should prefer
 * the model-based entry point so the exported DOCX matches the on-screen UI
 * byte-for-byte.
 */
export async function downloadProfitReportAsDocx(input: ProfitReportResult, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const result = localizeProfitReportResult(input, L);
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
    await downloadProfitModelAsDocx(model);
  } catch (error) {
    throw new Error(
      `Failed to export profit DOCX report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Build a DOCX from the unified `ProfitRenderModel`. Mirrors the layout used
 * in `downloadProfitModelAsPdf` so both formats show the same labels, numbers,
 * bare-mode caveat, and backend LLM block.
 */
export async function downloadProfitModelAsDocx(model: ProfitRenderModel): Promise<void> {
  try {
    const ccy = model.currencySymbol;
    const children: Array<Paragraph | Table> = [];

    // ── Title + subtitle ────────────────────────────────────────────────────
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: model.title, bold: true, size: 36, color: "C41E3A" })],
        spacing: { after: 200 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `${model.productName} · ${model.marketLabel} · ${model.generatedAtLabel}`,
            size: 22,
            color: "666666",
          }),
        ],
        spacing: { after: 240 },
      }),
    );

    // ── 4 metric cards as a 4-column table ──────────────────────────────────
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: model.metrics.map((m) => metricCell(m, ccy)),
          }),
        ],
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
        },
      }),
      new Paragraph({ text: "" }),
    );

    // ── Section: 全链路成本明细 ────────────────────────────────────────────
    children.push(mkSectionH("全链路成本明细"));

    // Top 3 summary cards (retail / chain / final net)
    const totalChainCost = model.chainNodes.reduce((s, n) => s + n.amount, 0);
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              summaryCardCell("售价基线", `${ccy}128`, "333333"),
              summaryCardCell("全链路成本", `${ccy}${totalChainCost.toFixed(0)}`, "333333"),
              summaryCardCell("最终净利润", model.costBoard.finalNetValue, "168096"),
            ],
          }),
        ],
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.NONE },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
        },
      }),
      new Paragraph({ text: "" }),
    );

    // AI margin signal + buffer + dominant cost (3 small cards)
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              smallCardCell("AI 利润判断", model.costBoard.marginSignal, "F8FAFC"),
              smallCardCell("距 ¥8 利润底线", model.costBoard.breakEvenBufferLabel, "F8FAFC"),
              smallCardCell("最大成本来源", `${model.costBoard.dominantCost.label} ${model.costBoard.dominantCost.amountLabel} · ${model.costBoard.dominantCost.shareLabel}`, "F8FAFC"),
            ],
          }),
        ],
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
        },
      }),
      new Paragraph({ text: "" }),
    );

    // 6 chain cost node cards
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: model.chainNodes.map((n) => chainNodeCell(n)),
          }),
        ],
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
        },
      }),
      new Paragraph({ text: "" }),
    );

    // ── Section: 售价分配结果 (stacked bar legend table) ───────────────────
    children.push(mkSectionH("售价分配结果"));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: model.stackLegend.map((item) => legendCell(item)),
          }),
        ],
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
        },
      }),
      new Paragraph({ text: "" }),
    );

    // ── Section: 不合规最高风险 ────────────────────────────────────────────
    children.push(mkSectionH("不合规最高风险"));
    if (model.riskExposureItems.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: model.riskExposureItems.map((r) => riskCell(r)),
            }),
          ],
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
            left: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
            right: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
            insideHorizontal: { style: BorderStyle.NONE },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "DDDDDD" },
          },
        }),
      );
    }
    children.push(new Paragraph({ text: "" }));

    // ── Optional: 后端 LLM 成本详述 ─────────────────────────────────────────
    if (model.backendMarkdown) {
      children.push(mkSectionH(model.backendMarkdownTitle));
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: model.backendMarkdownBadge,
              bold: true,
              size: 20,
              color: "C41E3A",
            }),
          ],
          spacing: { after: 120 },
        }),
      );
      for (const line of model.backendMarkdown.split("\n")) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line || " ", size: 20, color: "374151" })],
            spacing: { after: 60 },
          }),
        );
      }
    }

    // ── Footer ──────────────────────────────────────────────────────────────
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${model.title} · ${model.sessionId} · ${new Date(model.generatedAt).toLocaleString("zh-CN")}`,
            size: 18,
            color: "888888",
          }),
        ],
        spacing: { before: 320 },
      }),
    );

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
    downloadBlob(blob, `${model.exportBasename}_${model.sessionId}.docx`);
  } catch (error) {
    throw new Error(
      `Failed to export profit DOCX report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

// ─── Cell helpers ──────────────────────────────────────────────────────────

function metricCell(m: ProfitMetricCard, ccy: string): TableCell {
  const toneColor = (() => {
    switch (m.tone) {
      case "green": return "10B981";
      case "white": return "FFFFFF";
      case "orange": return "F4A261";
      case "blue": return "4CC9F0";
      case "alert": return "F97360";
      default: return "FFFFFF";
    }
  })();

  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: m.label, bold: true, size: 18, color: "666666" })],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: m.value, bold: true, size: 28, color: toneColor })],
      spacing: { after: 40 },
    }),
  ];
  if (m.unit) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: m.unit, size: 16, color: "888888" })],
        spacing: { after: 40 },
      }),
    );
  }
  if (m.bareRiskCaveat) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: m.bareRiskCaveat, size: 14, color: "FF5A4D", bold: true })],
        spacing: { after: 40 },
      }),
    );
  }

  return new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    children,
    shading: m.isCore ? { fill: "FFF8F0", type: "solid" } : undefined,
    margins: { top: 110, bottom: 110, left: 130, right: 130 },
  });
}

function summaryCardCell(label: string, value: string, valueColor: string): TableCell {
  return new TableCell({
    width: { size: 33, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: label, size: 18, color: "888888" })],
        spacing: { after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({ text: value, bold: true, size: 26, color: valueColor })],
        spacing: { after: 0 },
      }),
    ],
    margins: { top: 110, bottom: 110, left: 130, right: 130 },
  });
}

function smallCardCell(label: string, value: string, fill: string): TableCell {
  return new TableCell({
    width: { size: 33, type: WidthType.PERCENTAGE },
    shading: { fill, type: "solid" },
    children: [
      new Paragraph({
        children: [new TextRun({ text: label, size: 16, color: "888888" })],
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: value, bold: true, size: 20, color: "1F2937" })],
        spacing: { after: 0 },
      }),
    ],
    margins: { top: 110, bottom: 110, left: 130, right: 130 },
  });
}

function chainNodeCell(n: ProfitRenderModel["chainNodes"][number]): TableCell {
  const colorNoHash = n.color.replace(/^#/, "").toUpperCase();
  return new TableCell({
    width: { size: 16, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: `${n.share.toFixed(1)}%`, size: 16, color: colorNoHash, bold: true })],
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: n.label, size: 18, color: "1F2937", bold: true })],
        spacing: { after: 40 },
      }),
      new Paragraph({
        children: [new TextRun({ text: n.detail, size: 14, color: "666666" })],
        spacing: { after: 60 },
      }),
      new Paragraph({
        children: [new TextRun({ text: n.displayAmount, size: 22, color: "1F2937", bold: true })],
        spacing: { after: 0 },
      }),
    ],
    margins: { top: 110, bottom: 110, left: 130, right: 130 },
  });
}

function legendCell(item: ProfitRenderModel["stackLegend"][number]): TableCell {
  const colorNoHash = item.color.replace(/^#/, "").toUpperCase();
  return new TableCell({
    width: { size: 12, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: `■ ${item.label} ${item.displayAmount}`, size: 14, color: colorNoHash, bold: !!item.isFinal }),
        ],
        spacing: { after: 0 },
      }),
    ],
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
  });
}

function riskCell(r: ProfitRenderModel["riskExposureItems"][number]): TableCell {
  return new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: "⚠ " + r.label, size: 18, color: "B95A50", bold: true })],
        spacing: { after: 0 },
      }),
    ],
    margins: { top: 130, bottom: 130, left: 130, right: 130 },
  });
}