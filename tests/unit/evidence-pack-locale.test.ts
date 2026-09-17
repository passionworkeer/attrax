import { describe, expect, it, vi } from "vitest";
const capture = vi.hoisted(() => ({ text: [] as string[], downloads: [] as string[] }));
vi.mock("jspdf", () => ({ jsPDF: class {
  internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
  setFont() {} setFontSize() {} addPage() {} setDrawColor() {} line() {}
  text(value: string) { capture.text.push(value); }
  splitTextToSize(value: string) { return [value]; }
  output() { return new Blob(); }
} }));
vi.mock("docx", () => ({
  Paragraph: class { constructor(_opts: unknown) {} },
  TextRun: class { constructor(opts: {text: string}) { capture.text.push(opts.text); } },
  Document: class { constructor(_opts: unknown) {} },
  Packer: { toBlob: async () => new Blob() },
  HeadingLevel: { HEADING_1: 1, HEADING_2: 2, HEADING_3: 3 },
  AlignmentType: { LEFT: "left" }, BorderStyle: { SINGLE: "single" },
}));
vi.mock("@/lib/report-export-modules/shared", async (original) => ({
  ...await original<typeof import("@/lib/report-export-modules/shared")>(),
  embedFont: async () => {}, yieldToMainThread: async () => {},
  downloadBlob: (_blob: Blob, name: string) => capture.downloads.push(name),
}));
import { renderEvidencePackMarkdown, downloadEvidencePackAsPdf, downloadEvidencePackAsDocx, type EvidencePackInput } from "@/lib/report-export-modules/evidence-pack";
const input: EvidencePackInput = {
  product: "Adapter", markets: ["EU"], sessionId: "test", generatedAt: "2026-09-15",
  citations: [{ doc_id: "reg", article_id: "a1", quote: "Original article", match_status: "matched", quote_span: [0, 8] }],
  regulationCache: { reg: { id: "reg", official_citation: "Official regulation", region: "EU", license: "public", articles: [{ id: "a1", title: "Source title", text: "Original article" }] } },
};
describe("evidence pack languages", () => {
  it("localizes labels while preserving original text and quote positions", async () => {
    const zh = await renderEvidencePackMarkdown(input, "zh");
    const en = await renderEvidencePackMarkdown(input, "en");
    expect(zh).toContain("**产品**"); expect(zh).toContain("已匹配");
    expect(en).toContain("**Product**"); expect(en).not.toContain("**产品**");
    for (const text of [zh, en]) expect(text).toContain("<mark>Original</mark> article");
  });
  it("localizes empty and unresolved citation messages", async () => {
    expect(await renderEvidencePackMarkdown({ citations: [] }, "zh")).toContain("暂无引用");
    expect(await renderEvidencePackMarkdown({ citations: [] }, "en")).toContain("No citations");
    const empty = { ...input, citations: [{ doc_id: "reg", article_id: "missing" }] };
    expect(await renderEvidencePackMarkdown(empty, "en")).toContain("No article text available");
    expect(await renderEvidencePackMarkdown(empty, "zh")).toContain("暂无可用条文原文");
  });
  it.each(["zh", "en"] as const)("passes %s through both exporters", async (locale) => {
    capture.text.length = 0; capture.downloads.length = 0;
    await downloadEvidencePackAsPdf(input, locale);
    expect(capture.text.join(" ")).toContain(locale === "zh" ? "产品" : "Product");
    capture.text.length = 0;
    await downloadEvidencePackAsDocx(input, locale);
    expect(capture.text.join(" ")).toContain(locale === "zh" ? "产品" : "Product");
    expect(capture.downloads).toEqual([`evidence-pack-test-${locale}.pdf`, `evidence-pack-test-${locale}.docx`]);
  });
});
