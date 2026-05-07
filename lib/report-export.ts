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
  // jsPDF addFont(url: URL) expects a browser URL object — use createObjectURL.
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

export async function downloadProfitReportAsPdf(result: ProfitReportResult): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await embedFont(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // ── Header ───────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setTextColor(180);
  doc.text("火鹰合规 · 成本利润分析报告", margin, y);
  y += 6;
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ── Title ─────────────────────────────────────────────────
  doc.setFontSize(18);
  doc.setTextColor(40, 40, 40);
  doc.text("成本利润分析报告", margin, y);
  y += 8;
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`${result.productType} · ${result.market} 市场`, margin, y);
  y += 10;

  // ── Two-column summary cards ───────────────────────────────
  const halfW = (contentWidth - 4) / 2;

  // Barebone card
  doc.setFillColor(255, 240, 240);
  doc.setDrawColor(220, 80, 80);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, halfW, 28, 3, 3, "FD");
  doc.setFontSize(8);
  doc.setTextColor(180, 60, 60);
  doc.text("裸 奔 模 式", margin + 4, y + 5);
  doc.setFontSize(16);
  doc.setTextColor(200, 50, 50);
  doc.text(`¥${result.barebone.gp.toFixed(0)}`, margin + 4, y + 14);
  doc.setFontSize(8);
  doc.setTextColor(140, 80, 80);
  doc.text(`风险敞口 ¥${result.bareboneRiskExposure.toFixed(0)}`, margin + 4, y + 22);

  // Compliant card
  const card2X = margin + halfW + 4;
  doc.setFillColor(240, 255, 245);
  doc.setDrawColor(80, 200, 120);
  doc.roundedRect(card2X, y, halfW, 28, 3, 3, "FD");
  doc.setFontSize(8);
  doc.setTextColor(60, 160, 80);
  doc.text("合 规 模 式", card2X + 4, y + 5);
  doc.setFontSize(16);
  doc.setTextColor(30, 150, 70);
  doc.text(`¥${result.compliant.gp.toFixed(0)}`, card2X + 4, y + 14);
  doc.setFontSize(8);
  doc.setTextColor(60, 130, 80);
  doc.text(`风险敞口 ¥${result.compliantRiskExposure.toFixed(0)}`, card2X + 4, y + 22);

  y += 34;

  // ── Cost comparison table ──────────────────────────────────
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text("成本对比明细", margin, y);
  y += 4;

  const tableRows = [
    ["成本项", "裸奔模式", "合规模式", "差值"],
    ["BOM 材料成本", `¥${result.barebone.bom}`, `¥${result.compliant.bom}`, `¥${(result.compliant.bom - result.barebone.bom).toFixed(0)}`],
    ["包装印刷", `¥${result.barebone.packaging}`, `¥${result.compliant.packaging}`, `¥${(result.compliant.packaging - result.barebone.packaging).toFixed(0)}`],
    ["认证费摊销", `¥${result.barebone.cert}`, `¥${result.compliant.cert}`, `¥${(result.compliant.cert - result.barebone.cert).toFixed(0)}`],
    ["EPR 运营费", `¥${result.barebone.epr}`, `¥${result.compliant.epr}`, `¥${(result.compliant.epr - result.barebone.epr).toFixed(0)}`],
    ["物流渠道", `¥${result.barebone.logistics}`, `¥${result.compliant.logistics}`, `¥${(result.compliant.logistics - result.barebone.logistics).toFixed(0)}`],
    ["平均售价（ASP）", `¥${result.barebone.asp}`, `¥${result.compliant.asp}`, `¥${(result.compliant.asp - result.barebone.asp).toFixed(0)}`],
    ["毛利润（GP）", `¥${result.barebone.gp}`, `¥${result.compliant.gp}`, `¥${(result.compliant.gp - result.barebone.gp).toFixed(0)}`],
  ];

  const colWidths = [60, 30, 30, 30];
  const rowH = 7;
  let x = margin;

  for (let ri = 0; ri < tableRows.length; ri++) {
    const row = tableRows[ri];
    const isHeader = ri === 0;
    x = margin;
    for (let ci = 0; ci < row.length; ci++) {
      if (isHeader) {
        doc.setFillColor(240, 240, 245);
        doc.rect(x, y, colWidths[ci], rowH, "F");
        doc.setDrawColor(220, 220, 230);
        doc.rect(x, y, colWidths[ci], rowH, "S");
      } else {
        doc.setDrawColor(230, 230, 240);
        doc.rect(x, y, colWidths[ci], rowH, "S");
      }
      doc.setFontSize(isHeader ? 8 : 8);
      if (isHeader) {
        doc.setTextColor(80, 80, 100);
        doc.setFont("NotoSansSC", "bold");
      } else {
        doc.setTextColor(40, 40, 40);
        doc.setFont("NotoSansSC", "normal");
        if (ci === 1) doc.setTextColor(180, 60, 60);
        if (ci === 2) doc.setTextColor(30, 140, 70);
      }
      doc.text(row[ci], x + 2, y + 4.5);
      x += colWidths[ci];
    }
    y += rowH;
  }

  y += 8;

  // ── Key conclusion ────────────────────────────────────────
  if (result.keyConclusion) {
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.setFont("NotoSansSC", "bold");
    doc.text("关键结论", margin, y);
    y += 5;
    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const conclusionLines = doc.splitTextToSize(result.keyConclusion, contentWidth);
    doc.text(conclusionLines, margin, y);
    y += conclusionLines.length * 5 + 4;
  }

  // ── Footer on each page ────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(
      `火鹰合规 · 成本利润报告 · ${result.sessionId} · 第 ${i}/${pageCount} 页`,
      pageWidth / 2,
      pageHeight - 8,
      { align: "center" }
    );
  }

  doc.save(`成本利润报告_${result.sessionId}.pdf`);
}

export async function downloadProfitReportAsDocx(result: ProfitReportResult): Promise<void> {
  const tableRows = [
    ["成本项", "裸奔模式", "合规模式", "差值"],
    ["BOM 材料成本", `¥${result.barebone.bom.toFixed(0)}`, `¥${result.compliant.bom.toFixed(0)}`, `¥${(result.compliant.bom - result.barebone.bom).toFixed(0)}`],
    ["包装印刷", `¥${result.barebone.packaging.toFixed(0)}`, `¥${result.compliant.packaging.toFixed(0)}`, `¥${(result.compliant.packaging - result.barebone.packaging).toFixed(0)}`],
    ["认证费摊销", `¥${result.barebone.cert.toFixed(0)}`, `¥${result.compliant.cert.toFixed(0)}`, `¥${(result.compliant.cert - result.barebone.cert).toFixed(0)}`],
    ["EPR 运营费", `¥${result.barebone.epr.toFixed(0)}`, `¥${result.compliant.epr.toFixed(0)}`, `¥${(result.compliant.epr - result.barebone.epr).toFixed(0)}`],
    ["物流渠道", `¥${result.barebone.logistics.toFixed(0)}`, `¥${result.compliant.logistics.toFixed(0)}`, `¥${(result.compliant.logistics - result.barebone.logistics).toFixed(0)}`],
    ["平均售价（ASP）", `¥${result.barebone.asp.toFixed(0)}`, `¥${result.compliant.asp.toFixed(0)}`, `¥${(result.compliant.asp - result.barebone.asp).toFixed(0)}`],
    ["毛利润（GP）", `¥${result.barebone.gp.toFixed(0)}`, `¥${result.compliant.gp.toFixed(0)}`, `¥${(result.compliant.gp - result.barebone.gp).toFixed(0)}`],
  ];

  const mkTableCell = (text: string, isHeader = false, color?: string) =>
    new TableCell({
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: isHeader, size: 20, color: color ?? (isHeader ? "555555" : "111111") })],
        }),
      ],
      shading: isHeader ? { fill: "F0F0F5", type: "solid" } : undefined,
    });

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
          page: { margin: { top: 720, right: 720, bottom: 720, left: 900 } },
        },
        children: [
          // Title
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [
              new TextRun({ text: "火鹰合规 · 成本利润分析报告", bold: true, size: 36, color: "C41E3A" }),
            ],
            spacing: { after: 200 },
          }),

          // Product info
          new Paragraph({
            children: [
              new TextRun({ text: `产品：${result.productType}　　市场：${result.market}`, size: 22, color: "666666" }),
            ],
            spacing: { after: 240 },
          }),

          // Summary cards table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "裸奔模式", bold: true, size: 20, color: "CC4444" })], spacing: { after: 80 } }),
                      new Paragraph({ children: [new TextRun({ text: `毛利润：¥${result.barebone.gp.toFixed(0)}`, size: 22, bold: true, color: "CC4444" })], spacing: { after: 60 } }),
                      new Paragraph({ children: [new TextRun({ text: `风险敞口：¥${result.bareboneRiskExposure.toFixed(0)}`, size: 20, color: "994444" })], spacing: { after: 0 } }),
                    ],
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    shading: { fill: "FFF0F0", type: "solid" },
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "合规模式", bold: true, size: 20, color: "1E8A46" })], spacing: { after: 80 } }),
                      new Paragraph({ children: [new TextRun({ text: `毛利润：¥${result.compliant.gp.toFixed(0)}`, size: 22, bold: true, color: "1E8A46" })], spacing: { after: 60 } }),
                      new Paragraph({ children: [new TextRun({ text: `风险敞口：¥${result.compliantRiskExposure.toFixed(0)}`, size: 20, color: "1A6636" })], spacing: { after: 0 } }),
                    ],
                    width: { size: 50, type: WidthType.PERCENTAGE },
                    shading: { fill: "F0FFF5", type: "solid" },
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
          }),

          new Paragraph({ text: "" }),

          // Section heading
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: "成本对比明细", bold: true, size: 28 })],
            spacing: { before: 240, after: 120 },
          }),

          // Cost table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows.map((row, ri) =>
              new TableRow({
                children: row.map((cell, ci) => mkTableCell(
                  cell,
                  ri === 0,
                  ri === 0 ? "555555" : ci === 1 ? "BB3333" : ci === 2 ? "1A7A40" : "333333"
                )),
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
          }),

          new Paragraph({ text: "" }),

          // Key conclusion
          ...(result.keyConclusion
            ? [
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  children: [new TextRun({ text: "关键结论", bold: true, size: 28 })],
                  spacing: { before: 240, after: 120 },
                }),
                new Paragraph({
                  children: [new TextRun({ text: result.keyConclusion, size: 22 })],
                  spacing: { after: 100 },
                }),
              ]
            : []),

          // Footer
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [
              new TextRun({
                text: `会话 ID：${result.sessionId}  |  生成时间：${new Date(result.generatedAt).toLocaleString("zh-CN")}  |  火鹰合规 Blaze Hawks`,
                size: 18,
                color: "888888",
              }),
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
  a.download = `成本利润报告_${result.sessionId}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
