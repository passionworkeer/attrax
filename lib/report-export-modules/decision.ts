import { jsPDF } from "jspdf";
import { Document, HeadingLevel, Packer, Paragraph, Table, TextRun } from "docx";
import type { Locale } from "./shared";
import {
  docxTable,
  embedFont,
  mkBullet,
  mkSectionH,
  pdfBody,
  pdfBullet,
  pdfDrawTable,
  pdfSectionTitle,
  resolveLocale,
  tx,
  yieldToMainThread,
} from "./shared";
import { englishText } from "@/lib/report-localization";

export interface DecisionContent {
  sessionId: string;
  verdict?: string;
  riskLevel?: string;
  summary?: string;
  keyFindings?: string[];
  recommendedAction?: string;
  nodesEvidence?: Array<{
    type?: string;
    label?: string;
    labelEn?: string;
    label_en?: string;
    status?: string;
    confidence?: number;
    reasoning?: string;
    reasoningEn?: string;
    reasoning_en?: string;
  }>;
}

function riskColor(risk: string | undefined): [number, number, number] {
  switch (risk?.toUpperCase()) {
    case "HIGH":
      return [220, 38, 38];
    case "MEDIUM":
      return [217, 119, 6];
    case "LOW":
      return [5, 150, 105];
    default:
      return [71, 85, 105];
  }
}

function riskFill(risk: string | undefined): [number, number, number] {
  switch (risk?.toUpperCase()) {
    case "HIGH":
      return [254, 242, 242];
    case "MEDIUM":
      return [255, 251, 235];
    case "LOW":
      return [236, 253, 245];
    default:
      return [248, 250, 252];
  }
}

function verdictStatusLabel(verdict: string | undefined, locale: Locale): string {
  const v = verdict?.toUpperCase();
  if (v === "PASS") return tx("complianceStatus.passed", locale);
  if (v === "WARN") return tx("complianceStatus.warning", locale);
  if (v === "REJECTED") return tx("complianceStatus.rejected", locale);
  return locale === "zh" ? "未知" : "Unknown";
}

function riskLevelLabel(risk: string | undefined, locale: Locale): string {
  const value = risk || (locale === "zh" ? "未知" : "Unknown");
  if (locale === "zh") return `风险等级：${value}`;
  return `Risk Level: ${value}`;
}

function fallbackSummary(content: DecisionContent, locale: Locale): string {
  if (content.summary) return content.summary;
  const verdict = verdictStatusLabel(content.verdict, locale);
  const risk = content.riskLevel || (locale === "zh" ? "未知" : "Unknown");
  return locale === "zh"
    ? `本报告基于当前上传资料、法规命中和智能体执行链路生成。当前结论为${verdict}，风险等级为${risk}；建议先完成证据补齐和复核，再进入正式上架或放量销售。`
    : `This report is generated from the submitted materials, retrieved evidence, and agent decision chain. The current verdict is ${verdict} with ${risk} risk; complete evidence remediation and review before formal listing or scale-up.`;
}

function findingList(content: DecisionContent, locale: Locale): string[] {
  if (content.keyFindings?.length) return content.keyFindings;
  return [
    locale === "zh" ? "当前资料包仍需补齐关键合规证据，避免仅凭图片或简版说明进入正式销售。" : "The current dossier still needs key compliance evidence before formal selling.",
    locale === "zh" ? "需要把法规命中、整改任务和商业影响统一到同一份决策记录中，便于后续复核。" : "Regulatory evidence, remediation tasks, and business impact should be unified in one review record.",
  ];
}

function actionPlan(content: DecisionContent, locale: Locale): string[] {
  const mainAction = content.recommendedAction;
  const defaults = locale === "zh"
    ? [
        "冻结产品铭牌、说明书、包装和供应链资料，避免整改期间继续变更输入。",
        "按高风险项优先补齐测试报告、DoC/声明文件、责任人/进口商信息和批次追溯字段。",
        "完成内部复核后再进入小批量试销；若仍有拒绝项，先暂停目标市场上架。",
      ]
    : [
        "Freeze nameplate, manual, packaging, and supplier inputs so remediation uses stable source data.",
        "Prioritize high-risk gaps: test reports, DoC/declarations, responsible party/importer details, and batch traceability.",
        "Run an internal review before pilot sale; pause target-market listing if any rejection item remains.",
      ];
  return mainAction ? [mainAction, ...defaults] : defaults;
}

function assumptions(locale: Locale): string[] {
  return locale === "zh"
    ? [
        "本结论依赖当前上传图片、文档和检索到的法规片段；若后续产品结构、供应商或目标市场变化，需要重新评估。",
        "AI 决策报告用于业务预审和资料准备，不等同于实验室测试报告、认证证书或法律意见。",
      ]
    : [
        "The conclusion depends on the current uploaded images, documents, and retrieved snippets; product, supplier, or market changes require reassessment.",
        "The AI decision report is for business pre-review and dossier preparation; it is not a lab test report, certificate, or legal opinion.",
      ];
}

function nodeRows(content: DecisionContent, locale: Locale): string[][] {
  const rows = [
    locale === "zh" ? ["节点", "状态/置信度", "推理依据"] : ["Node", "Status / Confidence", "Reasoning"],
  ];
  const nodes = content.nodesEvidence ?? [];
  for (const node of nodes) {
    const label = locale === "zh"
      ? node.label ?? node.labelEn ?? node.label_en ?? node.type ?? ""
      : englishText(node.labelEn ?? node.label_en, englishText(node.label ?? node.type, node.type ?? "Decision node"));
    const confidence = typeof node.confidence === "number" ? `${Math.round(node.confidence * 100)}%` : "";
    const status = [node.status, confidence].filter(Boolean).join(" / ") || node.type || (locale === "zh" ? "已复核" : "Reviewed");
    const reasoning = locale === "zh"
      ? node.reasoning ?? node.reasoningEn ?? node.reasoning_en ?? ""
      : englishText(node.reasoningEn ?? node.reasoning_en, englishText(node.reasoning, ""));
    rows.push([label, status, reasoning || (locale === "zh" ? "未提供详细说明，建议在复核时补充节点证据。" : "No detailed note provided; add node evidence during review.")]);
  }
  if (rows.length === 1) {
    rows.push([
      locale === "zh" ? "综合判断" : "Overall decision",
      locale === "zh" ? "待补充" : "To be completed",
      locale === "zh" ? "当前没有节点级证据，导出时保留此行作为复核占位。" : "No node-level evidence is available; this row is kept as a review placeholder.",
    ]);
  }
  return rows;
}

function overviewRows(content: DecisionContent, locale: Locale): string[][] {
  return [
    locale === "zh" ? ["项目", "结论"] : ["Item", "Conclusion"],
    [locale === "zh" ? "决策结果" : "Decision Verdict", verdictStatusLabel(content.verdict, locale)],
    [locale === "zh" ? "风险等级" : "Risk Level", content.riskLevel || (locale === "zh" ? "未知" : "Unknown")],
    [locale === "zh" ? "报告范围" : "Scope", locale === "zh" ? "法规证据、智能体链路、整改动作和上线门槛" : "Evidence, agent trace, remediation actions, and launch gate"],
  ];
}

function addPdfFooter(doc: jsPDF, pageWidth: number, pageHeight: number, locale: Locale): void {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`${tx("report.title", locale)} · ${locale === "zh" ? "第" : "Page"} ${i}/${pageCount}`, pageWidth / 2, pageHeight - 8, { align: "center" });
  }
}

export async function downloadDecisionReportAsPdf(content: DecisionContent, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await embedFont(doc);

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const y = { cur: margin };

    const title = L === "zh" ? "AI 决策报告" : "AI Decision Report";
    const statusText = verdictStatusLabel(content.verdict, L);
    const color = riskColor(content.riskLevel);
    const fill = riskFill(content.riskLevel);

    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(tx("report.title", L), margin, y.cur);
    y.cur += 6;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y.cur, pageWidth - margin, y.cur);
    y.cur += 8;

    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(20);
    doc.setTextColor(31, 41, 55);
    doc.text(title, margin, y.cur);
    y.cur += 8;
    doc.setFont("NotoSansSC", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${tx("report.sessionId", L)}: ${content.sessionId}`, margin, y.cur);
    y.cur += 8;

    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.roundedRect(margin, y.cur, pageWidth - margin * 2, 14, 2, 2, "FD");
    doc.setFont("NotoSansSC", "bold");
    doc.setFontSize(10);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(`${statusText}  ·  ${riskLevelLabel(content.riskLevel, L)}`, margin + 4, y.cur + 9);
    y.cur += 20;

    await yieldToMainThread();

    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "决策概览" : "Decision Overview");
    pdfDrawTable(doc, y, margin, pageWidth, pageHeight, overviewRows(content, L), [42, 112]);

    await yieldToMainThread();

    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "决策摘要" : "Executive Summary");
    pdfBody(doc, y, margin, pageWidth, pageHeight, fallbackSummary(content, L), 9);

    await yieldToMainThread();

    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "关键发现" : "Key Findings");
    findingList(content, L).forEach((finding) => pdfBullet(doc, y, margin, pageWidth, pageHeight, finding));

    await yieldToMainThread();

    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "节点证据矩阵" : "Node Evidence Matrix");
    pdfDrawTable(doc, y, margin, pageWidth, pageHeight, nodeRows(content, L), [42, 38, 74]);

    await yieldToMainThread();

    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "建议行动计划" : "Recommended Action Plan");
    actionPlan(content, L).forEach((action) => pdfBullet(doc, y, margin, pageWidth, pageHeight, action));

    pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "假设与限制" : "Assumptions and Limits");
    assumptions(L).forEach((item) => pdfBullet(doc, y, margin, pageWidth, pageHeight, item));

    addPdfFooter(doc, pageWidth, pageHeight, L);

    doc.save(L === "zh" ? `AI决策报告_${content.sessionId}.pdf` : `AIDecisionReport_${content.sessionId}.pdf`);
  } catch (error) {
    throw new Error(
      `Failed to export decision PDF report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function downloadDecisionReportAsDocx(content: DecisionContent, locale?: Locale): Promise<void> {
  try {
    const L = resolveLocale(locale);
    const statusText = verdictStatusLabel(content.verdict, L);
    const title = L === "zh" ? "AI 决策报告" : "AI Decision Report";

    const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: title, bold: true, size: 36, color: "C41E3A" })],
      spacing: { after: 140 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${tx("report.sessionId", L)}: ${content.sessionId}`, size: 18, color: "64748B" })],
      spacing: { after: 160 },
    }),
    docxTable(
      [
        L === "zh" ? ["决策结果", "风险等级", "复核重点"] : ["Decision Verdict", "Risk Level", "Review Focus"],
        [statusText, content.riskLevel || (L === "zh" ? "未知" : "Unknown"), L === "zh" ? "证据补齐与上线门槛" : "Evidence completion and launch gate"],
      ],
      ["991B1B", "92400E", "334155"]
    ),
    new Paragraph({ text: "" }),
    mkSectionH(L === "zh" ? "决策摘要" : "Executive Summary"),
    new Paragraph({ children: [new TextRun({ text: fallbackSummary(content, L), size: 22, color: "374151" })], spacing: { after: 120 } }),
    mkSectionH(L === "zh" ? "关键发现" : "Key Findings"),
    ...findingList(content, L).map((finding) => mkBullet(finding)),
    new Paragraph({ text: "" }),
    mkSectionH(L === "zh" ? "节点证据矩阵" : "Node Evidence Matrix"),
    docxTable(nodeRows(content, L), ["475569", "475569", "475569"]),
    new Paragraph({ text: "" }),
    mkSectionH(L === "zh" ? "建议行动计划" : "Recommended Action Plan"),
    ...actionPlan(content, L).map((action) => mkBullet(action)),
    new Paragraph({ text: "" }),
    mkSectionH(L === "zh" ? "假设与限制" : "Assumptions and Limits"),
    ...assumptions(L).map((item) => mkBullet(item)),
  ];

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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = L === "zh" ? `AI决策报告_${content.sessionId}.docx` : `AIDecisionReport_${content.sessionId}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error(
      `Failed to export decision DOCX report: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
