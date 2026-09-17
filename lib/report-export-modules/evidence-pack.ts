/**
 * evidence-pack.ts — Export the per-claim citations from a report
 * package as a printable evidence bundle.
 *
 * Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.6.
 *
 * The output is a markdown document with one section per cited
 * regulation, containing:
 *   - Official citation + region + license
 *   - The article title + body (fetched from the regulation library
 *     via `GET /api/v1/regulations/{doc_id}` if not already cached)
 *   - The LLM-generated quote rendered with markdown `<mark>` syntax
 *     at the matched (start, end) span when match_status is "matched"
 *
 * The same markdown is then fed through the shared PDF / DOCX
 * generators (`compliance.ts`) so the user gets a downloadable artifact
 * that mirrors the on-screen highlight experience.
 */
import { jsPDF } from "jspdf";
import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
} from "docx";
import {
  downloadBlob,
  embedFont,
  parseMarkdownBlocks,
  type Locale,
  yieldToMainThread,
} from "./shared";

export interface CitationRefExport {
  doc_id: string;
  article_id: string;
  official_citation?: string;
  quote?: string;
  quote_span?: [number, number] | null;
  match_status?: "matched" | "fallback_article_only" | "unmatched" | null;
}

export interface EvidencePackInput {
  citations: CitationRefExport[];
  /** Optional pre-fetched regulation payloads keyed by `doc_id`. */
  regulationCache?: Record<string, RegulationPayload>;
  /** Product / market context for the cover header. */
  product?: string;
  markets?: string[];
  sessionId?: string;
  generatedAt?: string;
}

export interface RegulationPayload {
  id: string;
  official_citation: string;
  short_name?: string;
  region: string;
  license: "public" | "private_with_summary";
  source_url?: string | null;
  purchase_url?: string | null;
  articles?: Array<{ id: string; title: string; text?: string }>;
}

async function fetchRegulation(docId: string): Promise<RegulationPayload | null> {
  try {
    const endpoint =
      typeof window !== "undefined"
        ? `/api/regulations/${encodeURIComponent(docId)}`
        : `${(process.env.RAG_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/+$/, "")}/api/v1/regulations/${encodeURIComponent(docId)}`;
    const res = await fetch(endpoint);
    if (!res.ok) return null;
    return (await res.json()) as RegulationPayload;
  } catch {
    return null;
  }
}

/**
 * Resolve all citations to their backing regulation payloads. The
 * caller's cache (when present) avoids re-fetching regulations seen in
 * the current session.
 */
async function resolveRegulations(
  citations: CitationRefExport[],
  cache: Record<string, RegulationPayload>,
): Promise<Record<string, RegulationPayload>> {
  const docIds = new Set<string>();
  for (const c of citations) {
    if (c.doc_id && !cache[c.doc_id]) docIds.add(c.doc_id);
  }
  await Promise.all(
    Array.from(docIds).map(async (id) => {
      const payload = await fetchRegulation(id);
      if (payload) cache[id] = payload;
    }),
  );
  return cache;
}

/**
 * Render the evidence pack as markdown. Sections are grouped by
 * `doc_id` so all of an article's quotes land under the same
 * regulation heading.
 */
export async function renderEvidencePackMarkdown(input: EvidencePackInput, locale: Locale = "zh"): Promise<string> {
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  if (!input.citations.length) return `## ${t("证据包", "Evidence Pack")}\n\n${t("本报告暂无引用。", "No citations in this report.")}\n`;

  const cache = (input.regulationCache ?? {}) as Record<string, RegulationPayload>;
  await resolveRegulations(input.citations, cache);

  const lines: string[] = [];
  lines.push("# " + t("证据包", "Evidence Pack"));
  lines.push(t("说明：法规名称、条文及引文保留来源原文，未自动翻译。", "Note: regulation titles, articles and quotations are preserved in their source language, without automatic translation."));
  lines.push("");
  if (input.product) {
    lines.push(`**${t("产品", "Product")}**: ` + input.product);
  }
  if (input.markets?.length) {
    lines.push(`**${t("目标市场", "Target markets")}**: ` + input.markets.join(", "));
  }
  if (input.sessionId) {
    lines.push(`**${t("扫描 ID", "Scan ID")}**: ` + input.sessionId);
  }
  if (input.generatedAt) {
    lines.push(`**${t("生成时间", "Generated at")}**: ` + input.generatedAt);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // Group by doc_id so each regulation appears once even when cited
  // from multiple articles. J04/J06: ids are sanitized at the BFF
  // boundary, but a hand-built or legacy input may still carry
  // undefined/empty ids — drop them instead of printing "undefined"
  // headings into the pack.
  const byDoc = new Map<string, CitationRefExport[]>();
  for (const c of input.citations) {
    const docId = String(c.doc_id ?? "").trim();
    if (!docId) continue;
    const list = byDoc.get(docId) ?? [];
    list.push(c);
    byDoc.set(docId, list);
  }

  for (const [docId, items] of byDoc.entries()) {
    const reg = cache[docId];
    const regTitle = reg?.official_citation ?? docId;
    const region = reg?.region ?? "?";
    const license = reg?.license;
    const licenseLabel = license === "public" ? t("公开", "Public") : license === "private_with_summary" ? t("受限，仅摘要", "Restricted, summary only") : t("待确认", "Unconfirmed");
    lines.push(`## ${regTitle}`);
    lines.push("");
    lines.push(`- **${t("地区", "Region")}**: ${region}`);
    lines.push(`- **${t("使用权限", "License")}**: ${licenseLabel}`);
    if (reg?.source_url) {
      lines.push(`- **${t("来源", "Source")}**: ${reg.source_url}`);
    }
    if (license === "private_with_summary" && reg?.purchase_url) {
      lines.push(`- **${t("购买原文", "Purchase")}**: ${reg.purchase_url}`);
    }
    lines.push("");

    for (const citation of items) {
      const articleId = String(citation.article_id ?? "").trim() || t("（条款编号待确认）", "(article pending)");
      const article = reg?.articles?.find((a) => a.id === citation.article_id);
      const articleTitle = article?.title?.trim() || t("（标题待确认）", "(title pending)");
      const headerLine = "### " + articleId + " — " + articleTitle;
      lines.push(headerLine);
      lines.push("");
      if (citation.official_citation?.trim()) {
        lines.push(`**${t("法规引用", "Citation")}**: ` + citation.official_citation.trim());
      }
      if (citation.quote?.trim()) {
        // J05: a missing status must not be presented as "matched".
        const status = citation.match_status || "unverified";
        const statusLabel = locale === "en" ? status : ({ matched: "已匹配", fallback_article_only: "仅定位条文", unmatched: "未匹配", unverified: "未核实" } as Record<string, string>)[status] ?? "未核实";
        const quoteHeader = `**${t("引文", "Quote")}** (${t("状态", "status")}: ${statusLabel}):`;
        lines.push(quoteHeader);
        lines.push("");
        if (
          citation.match_status === "matched" &&
          citation.quote_span &&
          article &&
          article.text
        ) {
          lines.push(renderHighlightedBody(article.text, citation.quote_span));
        } else if (article && article.text) {
          lines.push(article.text);
        } else {
          lines.push("> " + citation.quote);
        }
      } else if (article && article.text) {
        lines.push(article.text);
      } else {
        lines.push(t("_此引用暂无可用条文原文。_", "_No article text available for this citation._"));
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Wrap the substring at `[start, end)` with markdown `<mark>` syntax.
 * The article text is rendered verbatim otherwise; offsets are clamped
 * to the actual string length.
 */
function renderHighlightedBody(text: string, span: [number, number]): string {
  const safeEnd = Math.max(0, Math.min(span[1], text.length));
  const safeStart = Math.max(0, Math.min(span[0], safeEnd));
  const pre = text.slice(0, safeStart);
  const marked = text.slice(safeStart, safeEnd);
  const post = text.slice(safeEnd);
  return `${pre}<mark>${marked}</mark>${post}`;
}

/**
 * Generate the evidence pack as a PDF and trigger a browser download.
 * Reuses the shared PDF infrastructure by rendering the markdown
 * blocks first via `jsPDF` directly (smaller bundle than going
 * through `parseMarkdownToPdfText` which expects HeadingLevel-style
 * headings).
 */
export async function downloadEvidencePackAsPdf(
  input: EvidencePackInput,
  locale: Locale = "zh",
): Promise<void> {
  const markdown = await renderEvidencePackMarkdown(input, locale);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  // J06 (plan §4.5): the evidence-pack used to draw with built-in
  // `helvetica`, which cannot encode CJK — every Chinese heading/quote
  // rendered as mojibake in the downloaded file. Embed the shared
  // NotoSansSC font (same path as the compliance report) so both exports
  // share one typesetting/font layer.
  await embedFont(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const usableWidth = pageWidth - margin * 2;
  let cursorY = margin;

  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
  };

  for (const block of parseMarkdownBlocks(markdown)) {
    await yieldToMainThread();
    if (block.type === "heading") {
      ensureSpace(40);
      const size = block.level === 1 ? 20 : block.level === 2 ? 16 : 14;
      doc.setFont("NotoSansSC", "bold");
      doc.setFontSize(size);
      doc.text(block.text, margin, cursorY);
      cursorY += size + 8;
      doc.setFont("NotoSansSC", "normal");
      doc.setFontSize(11);
      continue;
    }
    if (block.type === "paragraph") {
      doc.setFont("NotoSansSC", "normal");
      doc.setFontSize(11);
      const lines = doc.splitTextToSize(block.text, usableWidth);
      for (const line of lines) {
        ensureSpace(16);
        doc.text(line, margin, cursorY);
        cursorY += 14;
      }
      cursorY += 4;
      continue;
    }
    if (block.type === "listItem") {
      doc.setFont("NotoSansSC", "normal");
      doc.setFontSize(11);
      const wrapped = doc.splitTextToSize(block.text, usableWidth - 12);
      const bullet = block.ordered
        ? `${block.index ?? "•"}.`
        : "•";
      for (let i = 0; i < wrapped.length; i++) {
        ensureSpace(14);
        doc.text(i === 0 ? `${bullet} ${wrapped[i]}` : `  ${wrapped[i]}`, margin, cursorY);
        cursorY += 14;
      }
      continue;
    }
    if (block.type === "quote") {
      doc.setFont("NotoSansSC", "normal");
      doc.setFontSize(11);
      const lines = doc.splitTextToSize(block.text, usableWidth - 16);
      for (const line of lines) {
        ensureSpace(14);
        doc.text(line, margin + 12, cursorY);
        cursorY += 14;
      }
      doc.setFont("NotoSansSC", "normal");
      cursorY += 4;
      continue;
    }
    if (block.type === "table") {
      // Render a minimal table — column widths split usable width evenly.
      const cols = block.rows[0]?.length ?? 0;
      if (cols > 0) {
        const colW = usableWidth / cols;
        for (const row of block.rows) {
          ensureSpace(18);
          for (let c = 0; c < cols; c++) {
            const cell = (row[c] ?? "").slice(0, 40);
            doc.text(cell, margin + c * colW, cursorY);
          }
          cursorY += 14;
          // Divider
          doc.setDrawColor(180, 180, 180);
          doc.line(margin, cursorY, margin + usableWidth, cursorY);
          cursorY += 4;
        }
      }
      continue;
    }
    // `space` falls through — no rendering needed.
  }

  const blob = doc.output("blob");
  downloadBlob(blob as Blob, `evidence-pack-${input.sessionId ?? "report"}-${locale}.pdf`);
}

/**
 * Generate the evidence pack as a DOCX. The DOCX builder is shared
 * with the other exporters; we feed it the markdown blocks via the
 * `parseMarkdownBlocks` helper so headings/lists render correctly.
 */
export async function downloadEvidencePackAsDocx(
  input: EvidencePackInput,
  locale: Locale = "zh",
): Promise<void> {
  const markdown = await renderEvidencePackMarkdown(input, locale);
  const paragraphs: Paragraph[] = [];

  for (const block of parseMarkdownBlocks(markdown)) {
    await yieldToMainThread();
    if (block.type === "heading") {
      const level =
        block.level === 1
          ? HeadingLevel.HEADING_1
          : block.level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3;
      paragraphs.push(
        new Paragraph({
          heading: level,
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: block.text })],
        }),
      );
      continue;
    }
    if (block.type === "paragraph") {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: block.text })],
        }),
      );
      continue;
    }
    if (block.type === "listItem") {
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: block.text })],
        }),
      );
      continue;
    }
    if (block.type === "quote") {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: block.text, italics: true })],
          border: {
            left: { style: BorderStyle.SINGLE, size: 8, color: "888888" },
          },
        }),
      );
      continue;
    }
    if (block.type === "table") {
      const { Table, TableRow, TableCell, WidthType } = await import("docx");
      const rows = block.rows.map(
        (cells) =>
          new TableRow({
            children: cells.map(
              (cell) =>
                new TableCell({
                  width: { size: 100 / Math.max(1, cells.length), type: WidthType.PERCENTAGE },
                  children: [new Paragraph({ children: [new TextRun({ text: cell })] })],
                }),
            ),
          }),
      );
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: "" })],
        }),
      );
      // Push a synthetic table by injecting it as a sibling — but the
      // simpler path is to flatten the table into aligned paragraphs.
      // This preserves word wrapping without requiring us to push the
      // Table object out of band.
      for (const row of block.rows) {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: row.join("  |  ") })],
          }),
        );
      }
      // Avoid unused-import warnings when the dynamic import isn't reached.
      void Table;
      void TableRow;
      void TableCell;
      void rows;
    }
  }

  const { Document, Packer } = await import("docx");
  const doc = new Document({
      styles: { default: { document: { run: { font: "Calibri" } } } },
      sections: [{ properties: {}, children: paragraphs }],
    });
  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `evidence-pack-${input.sessionId ?? "report"}-${locale}.docx`);
}

/** Convenience that mirrors the legacy `downloadReportAsPdf` shape. */
export interface EvidencePackDownloadInput {
  reportPackage?: {
    citations?: CitationRefExport[];
    evidencePack?: CitationRefExport[];
    productDossier?: { product?: string; markets?: string[] };
    sessionId?: string;
    generatedAt?: string;
  };
}

export async function downloadEvidencePack(
  input: EvidencePackDownloadInput,
  locale: Locale = "zh",
  format: "pdf" | "docx" = "pdf",
): Promise<void> {
  const citations =
    input.reportPackage?.evidencePack?.length
      ? input.reportPackage.evidencePack
      : input.reportPackage?.citations ?? [];
  const evInput: EvidencePackInput = {
    citations,
    product: input.reportPackage?.productDossier?.product,
    markets: input.reportPackage?.productDossier?.markets,
    sessionId: input.reportPackage?.sessionId,
    generatedAt: input.reportPackage?.generatedAt,
  };
  if (format === "docx") {
    await downloadEvidencePackAsDocx(evInput, locale);
    return;
  }
  await downloadEvidencePackAsPdf(evInput, locale);
}