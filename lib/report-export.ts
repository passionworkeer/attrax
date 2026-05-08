/**
 * report-export.ts — Export compliance report as PDF or Word (.docx)
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

const STATUS_LABELS: Record<string, string> = {
  PASS: "通过",
  WARN: "警告",
  REJECTED: "拒绝",
  UNKNOWN: "未知",
};

const MARKET_LABELS: Record<string, string> = {
  EU: "欧盟",
  US: "美国",
  UK: "英国",
  CN: "中国",
  AU: "澳大利亚",
  SA: "沙特",
  AE: "阿联酋",
};

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

export async function downloadReportAsPdf(result: ComplianceReportResult): Promise<void> {
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

  const MARKET_LABELS_PDF: Record<string, string> = {
    EU: "欧盟", US: "美国", UK: "英国", CN: "中国",
    AU: "澳大利亚", SA: "沙特", AE: "阿联酋",
  };
  const markets = result.targetMarkets.map((m) => MARKET_LABELS_PDF[m] ?? m).join("、");

  // ── Header ────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setTextColor(180);
  doc.text("火鹰合规 · Blaze Hawks 合规扫描报告", margin, y);
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
  doc.text(`等级：${result.scoreGrade}`, margin + 28, y + 8);
  doc.text(`品类：${result.productCategory}`, margin + 28, y + 16);
  doc.text(`市场：${markets}`, margin + 28, y + 24);
  y += 36;

  // ── Status badge ─────────────────────────────────────
  const fillR = Math.round(scoreColor[0] * 0.1);
  const fillG = Math.round(scoreColor[1] * 0.1);
  const fillB = Math.round(scoreColor[2] * 0.1);
  doc.setFillColor(fillR, fillG, fillB);
  doc.setDrawColor(scoreColor[0], scoreColor[1], scoreColor[2]);
  doc.setLineWidth(0.4);
  const statusText = STATUS_LABELS[result.complianceStatus] ?? result.complianceStatus;
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
      `火鹰合规报告 · ${result.sessionId} · 第 ${i} / ${pageCount} 页`,
      pageWidth / 2,
      pageHeight - 8,
      { align: "center" }
    );
  }

  const filename = `合规报告_${result.sessionId}_${result.complianceStatus}.pdf`;
  doc.save(filename);
}

export async function downloadReportAsDocx(result: ComplianceReportResult): Promise<void> {
  const markets = result.targetMarkets.map((m) => MARKET_LABELS[m] ?? m).join("、");
  const statusText = STATUS_LABELS[result.complianceStatus] ?? result.complianceStatus;

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
                text: "火鹰合规 · 合规扫描报告",
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
                        children: [new TextRun({ text: "综合评分", size: 18, color: "888888" })],
                        alignment: AlignmentType.CENTER,
                      }),
                    ],
                    width: { size: 25, type: WidthType.PERCENTAGE },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun({ text: `等级：${result.scoreGrade}`, size: 22 })], spacing: { after: 80 } }),
                      new Paragraph({ children: [new TextRun({ text: `品类：${result.productCategory}`, size: 22 })], spacing: { after: 80 } }),
                      new Paragraph({ children: [new TextRun({ text: `市场：${markets}`, size: 22 })], spacing: { after: 80 } }),
                      new Paragraph({ children: [new TextRun({ text: `合规状态：${statusText}`, size: 22, bold: true })] }),
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
              new TextRun({ text: `会话 ID：${result.sessionId}  |  生成时间：${new Date(result.generatedAt).toLocaleString("zh-CN")}  |  火鹰合规 Blaze Hawks`, size: 18, color: "888888" }),
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
  a.download = `合规报告_${result.sessionId}_${result.complianceStatus}.docx`;
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

export async function downloadProfitReportAsPdf(result: ProfitReportResult): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await embedFont(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  const y = { cur: margin };

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setTextColor(180);
  doc.setFont("NotoSansSC", "normal");
  doc.text("火鹰合规 · 合规成本与利润分析报告", margin, y.cur);
  y.cur += 5;
  doc.setDrawColor(220);
  doc.line(margin, y.cur, pageWidth - margin, y.cur);
  y.cur += 7;

  // ── Title ────────────────────────────────────────────────────────────────
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.setFont("NotoSansSC", "bold");
  doc.text("合规成本与利润分析报告", margin, y.cur);
  y.cur += 7;
  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.setFont("NotoSansSC", "normal");
  doc.text(`${result.productType} · ${result.market} 市场  |  ${new Date(result.generatedAt).toLocaleDateString("zh-CN")}`, margin, y.cur);
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
    doc.text(`¥${gp.toFixed(0)}`, x + 4, y.cur + 13);
    doc.setFontSize(7.5);
    doc.text(`风险敞口 ¥${risk.toFixed(0)}`, x + 4, y.cur + 20);
  };

  renderCard(margin, "裸奔模式", result.barebone.gp, result.bareboneRiskExposure, [255, 238, 238], [200, 60, 60], [180, 50, 50]);
  renderCard(margin + halfW + 4, "合规模式", result.compliant.gp, result.compliantRiskExposure, [238, 255, 244], [50, 180, 100], [30, 150, 70]);
  y.cur += 30;

  // ── Section 1: Cost Comparison ──────────────────────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "一、成本对比明细（合规模式 vs 裸奔模式）");
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, [
    ["成本项", "裸奔模式", "合规模式", "差值"],
    ["BOM 材料成本", `¥${result.barebone.bom.toFixed(2)}`, `¥${result.compliant.bom.toFixed(2)}`, `¥${(result.compliant.bom - result.barebone.bom).toFixed(2)}`],
    ["包装与印刷", `¥${result.barebone.packaging.toFixed(2)}`, `¥${result.compliant.packaging.toFixed(2)}`, `¥${(result.compliant.packaging - result.barebone.packaging).toFixed(2)}`],
    ["认证费摊销", `¥${result.barebone.cert.toFixed(2)}`, `¥${result.compliant.cert.toFixed(2)}`, `¥${(result.compliant.cert - result.barebone.cert).toFixed(2)}`],
    ["EPR 运营费", `¥${result.barebone.epr.toFixed(2)}`, `¥${result.compliant.epr.toFixed(2)}`, `¥${(result.compliant.epr - result.barebone.epr).toFixed(2)}`],
    ["售后/保修预留", `¥${result.barebone.warranty.toFixed(2)}`, `¥${result.compliant.warranty.toFixed(2)}`, `¥${(result.compliant.warranty - result.barebone.warranty).toFixed(2)}`],
    ["物流与渠道", `¥${result.barebone.logistics.toFixed(2)}`, `¥${result.compliant.logistics.toFixed(2)}`, `¥${(result.compliant.logistics - result.barebone.logistics).toFixed(2)}`],
    ["总直接成本", `¥${result.barebone.total.toFixed(2)}`, `¥${result.compliant.total.toFixed(2)}`, `¥${(result.compliant.total - result.barebone.total).toFixed(2)}`],
  ], [58, 28, 28, 28]);

  // ── Section 2: Revenue Comparison ─────────────────────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "二、收益对比");
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, [
    ["收益项", "裸奔模式", "合规模式", "差值"],
    ["平均售价（ASP）", `¥${result.barebone.asp.toFixed(2)}`, `¥${result.compliant.asp.toFixed(2)}`, `¥${(result.compliant.asp - result.barebone.asp).toFixed(2)}`],
    ["毛利润（单台）", `¥${result.barebone.gp.toFixed(2)}`, `¥${result.compliant.gp.toFixed(2)}`, `¥${(result.compliant.gp - result.barebone.gp).toFixed(2)}`],
    ["毛利率", `${result.bareboneGpm.toFixed(1)}%`, `${result.compliantGpm.toFixed(1)}%`, "—"],
  ], [58, 28, 28, 28]);

  // ── Section 3: Risk-Adjusted Net Income ──────────────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "三、风险调整后净收益对比");
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, [
    ["模式", "毛利润", "风险敞口", "经风险调整净收益"],
    ["合规模式", `¥${result.compliant.gp.toFixed(2)}`, result.compliantRiskExposure === 0 ? "零风险敞口" : `¥${result.compliantRiskExposure.toFixed(0)}`, `¥${(result.compliant.gp - result.compliantRiskExposure / 100).toFixed(2)}`],
    ["裸奔模式", `¥${result.barebone.gp.toFixed(2)}`, "35-50% 扣押概率", `¥${(result.barebone.gp - result.bareboneRiskExposure / 100).toFixed(2)}`],
  ], [40, 26, 40, 36]);

  if (result.riskNote) {
    pdfBullet(doc, y, margin, pageWidth, pageHeight, result.riskNote);
  }

  // ── Section 4: Breakeven Analysis ───────────────────────────────────────
  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "四、盈亏平衡分析");
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, [
    ["分析项", "裸奔模式", "合规模式", "说明"],
    ["合规溢价", "—", result.premiumPct || "—", result.premiumPct ? `成本增加 ${result.premiumPct}` : "—"],
    ["盈亏平衡台数", "—", result.breakevenUnits || "—", result.breakevenUnits ? `约 ${result.breakevenUnits}` : "—"],
    ["建议定价", "—", `¥${result.compliant.asp.toFixed(0)}`, result.pricingStrategy || "—"],
  ], [40, 26, 36, 40]);

  if (result.pricingStrategy) {
    pdfBullet(doc, y, margin, pageWidth, pageHeight, `定价策略：${result.pricingStrategy}`);
  }

  // ── Section 5: Conclusions ──────────────────────────────────────────────
  const conclusionText = result.conclusions || result.keyConclusion || "";
  if (conclusionText) {
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "五、关键结论");
    for (const line of conclusionText.split("\n").filter(Boolean)) {
      pdfBullet(doc, y, margin, pageWidth, pageHeight, line);
    }
  }

  // ── Section 6: References ──────────────────────────────────────────────
  if (result.references) {
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "六、法规引用");
    for (const line of result.references.split("\n").filter(Boolean)) {
      const clean = line.replace(/^[-*]\s*/, "• ");
      pdfBullet(doc, y, margin, pageWidth, pageHeight, clean);
    }
  }

  // ── Fallback: Full markdown report ─────────────────────────────────────
  if (!result.references && !result.conclusions && result.report) {
    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, "完整分析报告");
    pdfBody(doc, y, margin, pageWidth, pageHeight, parseMarkdownToPdfText(result.report), 8.5);
  }

  // ── Footer on each page ──────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    doc.text(
      `火鹰合规 · 合规成本与利润分析报告 · ${result.sessionId} · 第 ${i}/${pageCount} 页`,
      pageWidth / 2,
      pageHeight - 6,
      { align: "center" }
    );
  }

  doc.save(`成本利润分析报告_${result.sessionId}.pdf`);
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

export async function downloadProfitReportAsDocx(result: ProfitReportResult): Promise<void> {
  const costRows: string[][] = [
    ["成本项", "裸奔模式", "合规模式", "差值"],
    ["BOM 材料成本", `¥${result.barebone.bom.toFixed(2)}`, `¥${result.compliant.bom.toFixed(2)}`, `¥${(result.compliant.bom - result.barebone.bom).toFixed(2)}`],
    ["包装与印刷", `¥${result.barebone.packaging.toFixed(2)}`, `¥${result.compliant.packaging.toFixed(2)}`, `¥${(result.compliant.packaging - result.barebone.packaging).toFixed(2)}`],
    ["认证费摊销", `¥${result.barebone.cert.toFixed(2)}`, `¥${result.compliant.cert.toFixed(2)}`, `¥${(result.compliant.cert - result.barebone.cert).toFixed(2)}`],
    ["EPR 运营费", `¥${result.barebone.epr.toFixed(2)}`, `¥${result.compliant.epr.toFixed(2)}`, `¥${(result.compliant.epr - result.barebone.epr).toFixed(2)}`],
    ["售后/保修预留", `¥${result.barebone.warranty.toFixed(2)}`, `¥${result.compliant.warranty.toFixed(2)}`, `¥${(result.compliant.warranty - result.barebone.warranty).toFixed(2)}`],
    ["物流与渠道", `¥${result.barebone.logistics.toFixed(2)}`, `¥${result.compliant.logistics.toFixed(2)}`, `¥${(result.compliant.logistics - result.barebone.logistics).toFixed(2)}`],
    ["总直接成本", `¥${result.barebone.total.toFixed(2)}`, `¥${result.compliant.total.toFixed(2)}`, `¥${(result.compliant.total - result.barebone.total).toFixed(2)}`],
  ];

  const revenueRows: string[][] = [
    ["收益项", "裸奔模式", "合规模式", "差值"],
    ["平均售价（ASP）", `¥${result.barebone.asp.toFixed(2)}`, `¥${result.compliant.asp.toFixed(2)}`, `¥${(result.compliant.asp - result.barebone.asp).toFixed(2)}`],
    ["毛利润（单台）", `¥${result.barebone.gp.toFixed(2)}`, `¥${result.compliant.gp.toFixed(2)}`, `¥${(result.compliant.gp - result.barebone.gp).toFixed(2)}`],
    ["毛利率", `${result.bareboneGpm.toFixed(1)}%`, `${result.compliantGpm.toFixed(1)}%`, "—"],
  ];

  const riskRows: string[][] = [
    ["模式", "毛利润", "风险敞口", "经风险调整净收益"],
    ["合规模式", `¥${result.compliant.gp.toFixed(2)}`, result.compliantRiskExposure === 0 ? "零风险敞口" : `¥${result.compliantRiskExposure.toFixed(0)}`, `¥${result.compliant.gp.toFixed(2)}`],
    ["裸奔模式", `¥${result.barebone.gp.toFixed(2)}`, "35-50% 扣押概率", `¥${(result.barebone.gp - result.bareboneRiskExposure / 100).toFixed(2)}`],
  ];

  const breakevenRows: string[][] = [
    ["分析项", "裸奔模式", "合规模式", "说明"],
    ["合规溢价", "—", result.premiumPct || "—", result.premiumPct ? `成本增加 ${result.premiumPct}` : "—"],
    ["盈亏平衡台数", "—", result.breakevenUnits || "—", result.breakevenUnits ? `约 ${result.breakevenUnits}` : "—"],
    ["建议定价", "—", `¥${result.compliant.asp.toFixed(0)}`, result.pricingStrategy || "—"],
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
            children: [new TextRun({ text: "火鹰合规 · 合规成本与利润分析报告", bold: true, size: 36, color: "C41E3A" })],
            spacing: { after: 200 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `产品：${result.productType}　　市场：${result.market}　　日期：${new Date(result.generatedAt).toLocaleDateString("zh-CN")}`, size: 22, color: "666666" })],
            spacing: { after: 240 },
          }),

          // Summary cards
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({
              children: [
                new TableCell({ children: [
                  new Paragraph({ children: [new TextRun({ text: "裸奔模式", bold: true, size: 20, color: "CC4444" })], spacing: { after: 80 } }),
                  new Paragraph({ children: [new TextRun({ text: `毛利润：¥${result.barebone.gp.toFixed(0)}`, size: 24, bold: true, color: "CC4444" })], spacing: { after: 60 } }),
                  new Paragraph({ children: [new TextRun({ text: `风险敞口：¥${result.bareboneRiskExposure.toFixed(0)}`, size: 20, color: "994444" })], spacing: { after: 0 } }),
                ], width: { size: 50, type: WidthType.PERCENTAGE }, shading: { fill: "FFF0F0", type: "solid" } }),
                new TableCell({ children: [
                  new Paragraph({ children: [new TextRun({ text: "合规模式", bold: true, size: 20, color: "1E8A46" })], spacing: { after: 80 } }),
                  new Paragraph({ children: [new TextRun({ text: `毛利润：¥${result.compliant.gp.toFixed(0)}`, size: 24, bold: true, color: "1E8A46" })], spacing: { after: 60 } }),
                  new Paragraph({ children: [new TextRun({ text: `风险敞口：¥${result.compliantRiskExposure.toFixed(0)}`, size: 20, color: "1A6636" })], spacing: { after: 0 } }),
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
          mkSectionH("一、成本对比明细（合规模式 vs 裸奔模式）"),
          docxTable(costRows, ["BB3333", "1A7A40", "333333"]),
          new Paragraph({ text: "" }),

          // Section 2
          mkSectionH("二、收益对比"),
          docxTable(revenueRows, ["BB3333", "1A7A40", "333333"]),
          new Paragraph({ text: "" }),

          // Section 3
          mkSectionH("三、风险调整后净收益对比"),
          docxTable(riskRows, ["BB3333", "1A7A40", "333333"]),
          ...(result.riskNote ? [mkBullet(result.riskNote)] : []),
          new Paragraph({ text: "" }),

          // Section 4
          mkSectionH("四、盈亏平衡分析"),
          docxTable(breakevenRows, ["BB3333", "1A7A40", "333333"]),
          ...(result.pricingStrategy ? [mkBullet(`定价策略：${result.pricingStrategy}`)] : []),
          new Paragraph({ text: "" }),

          // Section 5
          ...(conclusionParas.length > 0
            ? [mkSectionH("五、关键结论"), ...conclusionParas, new Paragraph({ text: "" })]
            : []),

          // Section 6
          ...(refParas.length > 0
            ? [mkSectionH("六、法规引用"), ...refParas, new Paragraph({ text: "" })]
            : []),

          // Fallback full report
          ...(!result.references && !result.conclusions && result.report
            ? [mkSectionH("完整分析报告"), ...parseMarkdownToDocx(result.report), new Paragraph({ text: "" })]
            : []),

          // Footer
          new Paragraph({
            children: [new TextRun({ text: `会话 ID：${result.sessionId}  |  生成时间：${new Date(result.generatedAt).toLocaleString("zh-CN")}  |  火鹰合规 Blaze Hawks`, size: 18, color: "888888" })],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `成本利润分析报告_${result.sessionId}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
