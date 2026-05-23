import { jsPDF } from "jspdf";
import {
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import { t as i18nT } from "@/lib/i18n";

export type Locale = "zh" | "en";

/** Detect locale from localStorage (set by i18n provider), falling back to "zh". */
export function detectLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  const stored = localStorage.getItem("locale") as Locale | null;
  if (stored === "zh" || stored === "en") return stored;
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith("en") ? "en" : "zh";
}

/** Resolve locale parameter with auto-detection fallback. */
export function resolveLocale(locale: Locale | undefined): Locale {
  return locale ?? detectLocale();
}

/** Shortcut to look up a nested translation key. */
export function tx(key: string, locale: Locale = "zh"): string {
  return i18nT(key, locale);
}

export function complianceStatusLabel(status: string, locale: Locale): string {
  return tx(`complianceStatus.${status === "PASS" ? "passed" : status === "WARN" ? "warning" : status === "REJECTED" ? "rejected" : "unknown"}`, locale);
}

export function marketLabel(market: string, locale: Locale): string {
  return tx(`markets.${market}`, locale);
}

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

export async function embedFont(doc: jsPDF): Promise<void> {
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

export function pdfCheckBreak(doc: jsPDF, y: number, margin: number, pageHeight: number, needed = 14): { y: number; newPage: boolean } {
  if (y + needed > pageHeight - margin) {
    doc.addPage();
    return { y: margin, newPage: true };
  }
  return { y, newPage: false };
}

export function pdfSectionTitle(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, title: string): void {
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

export function pdfDrawTable(
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

export function pdfBody(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, text: string, size = 9): void {
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

export function pdfBullet(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, text: string): void {
  const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, 7);
  y.cur = ny;
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60, 60, 60);
  const clean = text.replace(/^\d+[\.\)]\s*/, "• ").replace(/\*\*(.*?)\*\*/g, "$1");
  doc.text(`  ${clean}`, margin, y.cur);
  y.cur += 6;
}

export function mkCell(text: string, isHeader = false, color = "333333"): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: isHeader, size: 20, color })] })],
    shading: isHeader ? { fill: "EEEEF8", type: "solid" } : undefined,
  });
}

export function mkSectionH(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 28 })],
    spacing: { before: 320, after: 120 },
  });
}

export function mkBullet(text: string): Paragraph {
  const clean = text.replace(/^\d+[\.\)]\s*/, "• ").replace(/\*\*(.*?)\*\*/g, "$1");
  return new Paragraph({
    children: [new TextRun({ text: clean, size: 22 })],
    indent: { left: 360 },
    spacing: { after: 80 },
  });
}

export function docxTable(rows: string[][], colColors: string[]): Table {
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
