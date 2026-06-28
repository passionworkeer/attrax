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
// Pure markdown helpers live in markdown-text.ts so they can be imported
// without dragging jspdf/docx into the caller's bundle.
import { parseMarkdownBlocks, stripInlineMarkdown } from "./markdown-text";
export { parseMarkdownToPdfText, parseMarkdownBlocks } from "./markdown-text";

export type Locale = "zh" | "en";

let cachedFontBase64: Promise<string> | undefined;

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

export function parseMarkdownToDocx(text: string): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [];

  for (const block of parseMarkdownBlocks(text)) {
    if (block.type === "space") {
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    if (block.type === "heading") {
      children.push(
        new Paragraph({
          heading:
            block.level === 1
              ? HeadingLevel.HEADING_1
              : block.level === 2
                ? HeadingLevel.HEADING_2
                : HeadingLevel.HEADING_3,
          children: [new TextRun({ text: block.text, bold: true, size: block.level === 1 ? 32 : block.level === 2 ? 28 : 24, color: "1F2937" })],
          spacing: { before: block.level === 1 ? 420 : 280, after: 120 },
        })
      );
      continue;
    }

    if (block.type === "listItem") {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `${block.ordered ? `${block.index ?? 1}.` : "•"} ${block.text}`, size: 22, color: "374151" })],
          indent: { left: 360 },
          spacing: { after: 80 },
        })
      );
      continue;
    }

    if (block.type === "quote") {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: block.text, size: 21, color: "475569", italics: true })],
          indent: { left: 260 },
          spacing: { before: 80, after: 120 },
          shading: { fill: "F8FAFC", type: "solid" },
        })
      );
      continue;
    }

    if (block.type === "table") {
      children.push(docxTable(block.rows, []));
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    children.push(
      new Paragraph({
        children: [new TextRun({ text: block.text, size: 22, color: "374151" })],
        spacing: { after: 120 },
      })
    );
  }

  return children;
}

async function loadFontBase64(): Promise<string> {
  const fontBuffer = await fetch("/fonts/NotoSansSC-Regular.ttf").then((r) => r.arrayBuffer());
  const bytes = new Uint8Array(fontBuffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function embedFont(doc: jsPDF): Promise<void> {
  const isTest = typeof process !== "undefined" && process.env.NODE_ENV === "test";
  const base64 = isTest
    ? await loadFontBase64()
    : await (cachedFontBase64 ??= loadFontBase64());
  if ("addFileToVFS" in doc && typeof doc.addFileToVFS === "function") {
    doc.addFileToVFS("NotoSansSC-Regular.ttf", base64);
    doc.addFont("NotoSansSC-Regular.ttf", "NotoSansSC", "normal");
    doc.addFont("NotoSansSC-Regular.ttf", "NotoSansSC", "bold");
  } else {
    doc.addFont(base64, "NotoSansSC", "normal");
    doc.addFont(base64, "NotoSansSC", "bold");
  }
  doc.setFont("NotoSansSC", "normal");
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
  doc.setFontSize(10.5);
  doc.setTextColor(31, 41, 55);
  doc.text(title, margin, y.cur);
  y.cur += 4;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.35);
  doc.line(margin, y.cur, pageWidth - margin, y.cur);
  y.cur += 4;
}

function normalizePdfLines(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function scaledColWidths(contentWidth: number, colCount: number, colWidths: number[]): number[] {
  if (!colWidths.length) return Array(colCount).fill(contentWidth / Math.max(colCount, 1));
  const filled = Array.from({ length: colCount }, (_, index) => colWidths[index] ?? contentWidth / colCount);
  const total = filled.reduce((sum, width) => sum + width, 0);
  if (total <= 0) return Array(colCount).fill(contentWidth / Math.max(colCount, 1));
  return filled.map((width) => (width / total) * contentWidth);
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
  if (!rows.length) return;

  const contentW = pageWidth - margin * 2;
  const colCount = Math.max(...rows.map((row) => row.length));
  const computedWidths = scaledColWidths(contentW, colCount, colWidths);
  const lineH = 4.1;
  const paddingX = 2.2;
  const paddingY = 2.2;

  const prepareRow = (row: string[]) => {
    const lines = Array.from({ length: colCount }, (_, ci) => {
      const cell = row[ci] ?? "";
      return normalizePdfLines(doc.splitTextToSize(String(cell), Math.max(computedWidths[ci] - paddingX * 2, 8)));
    });
    const height = Math.max(rowH, Math.max(...lines.map((cellLines) => cellLines.length)) * lineH + paddingY * 2);
    return { lines, height };
  };

  const drawRow = (row: string[], ri: number, rowY: number, height: number, lines: string[][]) => {
    const isHeader = ri === 0;
    let x = margin;
    for (let ci = 0; ci < colCount; ci++) {
      const cw = computedWidths[ci];
      if (isHeader) {
        doc.setFillColor(239, 246, 255);
        doc.setDrawColor(191, 219, 254);
        doc.rect(x, rowY, cw, height, "FD");
      } else {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.rect(x, rowY, cw, height, "S");
      }
      doc.setFont("NotoSansSC", isHeader ? "bold" : "normal");
      doc.setFontSize(isHeader ? 8.2 : 7.8);
      doc.setTextColor(isHeader ? 30 : 51, isHeader ? 64 : 65, isHeader ? 116 : 85);
      doc.text(lines[ci] ?? [String(row[ci] ?? "")], x + paddingX, rowY + paddingY + 2.5);
      x += cw;
    }
  };

  const header = rows[0];
  const headerPrepared = prepareRow(header);

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const prepared = prepareRow(row);

    if (y.cur + prepared.height > pageHeight - margin) {
      doc.addPage();
      y.cur = margin;
      if (ri > 0 && header?.length) {
        drawRow(header, 0, y.cur, headerPrepared.height, headerPrepared.lines);
        y.cur += headerPrepared.height;
      }
    }

    drawRow(row, ri, y.cur, prepared.height, prepared.lines);
    y.cur += prepared.height;
  }
  y.cur += 5;
}

export function pdfBody(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, text: string, size = 9): void {
  if (!text.trim()) return;
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(size);
  doc.setTextColor(51, 65, 85);
  const lines = normalizePdfLines(doc.splitTextToSize(text, pageWidth - margin * 2));
  const lineH = Math.max(size * 0.52, 4.2);

  for (const line of lines) {
    const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, lineH + 1);
    y.cur = ny;
    doc.text(line, margin, y.cur);
    y.cur += lineH;
  }
  y.cur += 2;
}

export function pdfBullet(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, text: string): void {
  const clean = stripInlineMarkdown(text).replace(/^\d+[\.)]\s*/, "").replace(/^[-*•]\s*/, "");
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const lines = normalizePdfLines(doc.splitTextToSize(clean, pageWidth - margin * 2 - 6));
  for (let i = 0; i < lines.length; i++) {
    const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, 5.5);
    y.cur = ny;
    doc.text(i === 0 ? `• ${lines[i]}` : `  ${lines[i]}`, margin, y.cur);
    y.cur += 5;
  }
  y.cur += 1;
}

export function renderMarkdownPdf(doc: jsPDF, y: { cur: number }, margin: number, pageWidth: number, pageHeight: number, text: string): void {
  for (const block of parseMarkdownBlocks(text)) {
    if (block.type === "space") {
      y.cur += 2;
      continue;
    }

    if (block.type === "heading") {
      pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, block.text);
      continue;
    }

    if (block.type === "table") {
      pdfDrawTable(doc, y, margin, pageWidth, pageHeight, block.rows, []);
      continue;
    }

    if (block.type === "listItem") {
      pdfBullet(doc, y, margin, pageWidth, pageHeight, block.ordered ? `${block.index ?? 1}. ${block.text}` : block.text);
      continue;
    }

    if (block.type === "quote") {
      const { y: ny } = pdfCheckBreak(doc, y.cur, margin, pageHeight, 10);
      y.cur = ny;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, y.cur - 2, pageWidth - margin * 2, 8, 1.5, 1.5, "FD");
      pdfBody(doc, y, margin + 3, pageWidth - 3, pageHeight, block.text, 8.5);
      continue;
    }

    pdfBody(doc, y, margin, pageWidth, pageHeight, block.text, 9);
  }
}

function cleanDocxColor(color: string): string {
  return color.replace(/^#/, "").toUpperCase();
}

export function mkCell(text: string, isHeader = false, color = "333333", fill?: string): TableCell {
  const lines = String(text || "").split("\n").filter((line) => line.length > 0);
  return new TableCell({
    children: (lines.length ? lines : [""]).map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, bold: isHeader, size: isHeader ? 20 : 19, color: cleanDocxColor(isHeader ? "1E3A8A" : color) })],
          spacing: { after: 40 },
        })
    ),
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    shading: isHeader || fill ? { fill: fill ?? "EFF6FF", type: "solid" } : undefined,
  });
}

export function mkSectionH(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 28, color: "1F2937" })],
    spacing: { before: 320, after: 120 },
  });
}

export function mkBullet(text: string): Paragraph {
  const clean = stripInlineMarkdown(text).replace(/^\d+[\.)]\s*/, "").replace(/^[-*•]\s*/, "");
  return new Paragraph({
    children: [new TextRun({ text: `• ${clean}`, size: 22, color: "374151" })],
    indent: { left: 360 },
    spacing: { after: 80 },
  });
}

export function docxTable(rows: string[][], colColors: string[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, ri) =>
      new TableRow({
        children: row.map((cell, ci) =>
          mkCell(
            cell,
            ri === 0,
            ri === 0 ? "1E3A8A" : ci === 0 ? "374151" : colColors[ci - 1] || colColors[ci] || "374151",
            ri > 0 && ri % 2 === 0 ? "F8FAFC" : undefined
          )
        ),
      })
    ),
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
      left: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
      right: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
    },
  });
}
