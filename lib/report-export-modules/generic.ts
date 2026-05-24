import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { jsPDF } from "jspdf";
import type { Locale } from "./shared";
import { embedFont, parseMarkdownToDocx, parseMarkdownToPdfText, pdfBody, resolveLocale } from "./shared";

type GenericReport = {
  sessionId: string;
  title: string;
  titleEn: string;
  markdown: string;
  markdownEn?: string;
  filename: string;
  filenameEn: string;
};

function reportText(report: GenericReport, locale: Locale): string {
  return locale === "en" ? report.markdownEn ?? report.markdown : report.markdown;
}

function reportTitle(report: GenericReport, locale: Locale): string {
  return locale === "en" ? report.titleEn : report.title;
}

export async function downloadGenericReportAsPdf(report: GenericReport, locale?: Locale): Promise<void> {
  const L = resolveLocale(locale);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await embedFont(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;
  const y = { cur: margin };

  doc.setFont("NotoSansSC", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 30, 30);
  doc.text(reportTitle(report, L), margin, y.cur);
  y.cur += 8;
  doc.setFont("NotoSansSC", "normal");
  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  doc.text(`${L === "zh" ? "会话" : "Session"}: ${report.sessionId}`, margin, y.cur);
  y.cur += 8;
  doc.setDrawColor(220);
  doc.line(margin, y.cur, pageWidth - margin, y.cur);
  y.cur += 8;

  pdfBody(doc, y, margin, pageWidth, pageHeight, parseMarkdownToPdfText(reportText(report, L)), 9);

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(`${reportTitle(report, L)} · ${i}/${pageCount}`, pageWidth / 2, pageHeight - 8, { align: "center" });
  }

  doc.save(L === "en" ? `${report.filenameEn}.pdf` : `${report.filename}.pdf`);
}

export async function downloadGenericReportAsDocx(report: GenericReport, locale?: Locale): Promise<void> {
  const L = resolveLocale(locale);
  const title = reportTitle(report, L);
  const doc = new Document({
    styles: {
      paragraphStyles: [{ id: "Normal", name: "Normal", run: { font: "Arial", size: 22 } }],
    },
    sections: [
      {
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 900 } } },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: title, bold: true, size: 36, color: "C41E3A" })],
            spacing: { after: 160 },
          }),
          new Paragraph({
            children: [new TextRun({ text: `${L === "zh" ? "会话" : "Session"}: ${report.sessionId}`, size: 18, color: "888888" })],
            spacing: { after: 200 },
          }),
          ...parseMarkdownToDocx(reportText(report, L)),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = L === "en" ? `${report.filenameEn}.docx` : `${report.filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
