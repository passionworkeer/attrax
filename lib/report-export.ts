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
import type { ComplianceReportResult } from "@/lib/types";

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
