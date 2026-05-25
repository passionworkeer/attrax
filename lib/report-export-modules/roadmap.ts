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
} from "./shared";
import { englishArray, englishText } from "@/lib/report-localization";

export interface RoadmapContent {
  sessionId: string;
  currentStatus?: string;
  currentStatusEn?: string;
  totalDays?: number;
  totalCost?: string;
  progress?: number;
  items: Array<{
    title: string;
    titleEn?: string;
    description?: string;
    descriptionEn?: string;
    cost?: string;
    days?: number;
    status?: string;
    statusEn?: string;
    documents?: string[];
    documentsEn?: string[];
  }>;
}

function statusLabel(status: string | undefined, locale: Locale): string {
  const v = status?.toUpperCase().replace("-", "_");
  if (v === "PASS") return tx("complianceStatus.passed", locale);
  if (v === "WARN") return tx("complianceStatus.warning", locale);
  if (v === "REJECTED") return tx("complianceStatus.rejected", locale);
  if (v === "COMPLETED") return locale === "zh" ? "已完成" : "Completed";
  if (v === "IN_PROGRESS") return locale === "zh" ? "进行中" : "In Progress";
  if (v === "PENDING") return locale === "zh" ? "待处理" : "Pending";
  return locale === "zh" ? status ?? "未知" : englishText(status, "Unknown");
}

function statusColor(status: string | undefined): [number, number, number] {
  const v = status?.toUpperCase().replace("-", "_");
  switch (v) {
    case "PASS":
    case "COMPLETED":
      return [5, 150, 105];
    case "WARN":
    case "IN_PROGRESS":
      return [217, 119, 6];
    case "REJECTED":
      return [220, 38, 38];
    default:
      return [71, 85, 105];
  }
}

function statusFill(status: string | undefined): [number, number, number] {
  const v = status?.toUpperCase().replace("-", "_");
  if (v === "PASS" || v === "COMPLETED") return [236, 253, 245];
  if (v === "WARN" || v === "IN_PROGRESS") return [255, 251, 235];
  if (v === "REJECTED") return [254, 242, 242];
  return [248, 250, 252];
}

function itemTitle(item: RoadmapContent["items"][number], locale: Locale): string {
  return locale === "zh"
    ? item.title || item.titleEn || ""
    : englishText(item.titleEn, englishText(item.title, "Roadmap task"));
}

function itemDescription(item: RoadmapContent["items"][number], locale: Locale): string {
  return locale === "zh"
    ? item.description || item.descriptionEn || ""
    : englishText(item.descriptionEn, englishText(item.description, "Add detailed execution notes before starting this step."));
}

function itemDocuments(item: RoadmapContent["items"][number], locale: Locale): string[] {
  const docs = locale === "zh"
    ? item.documents ?? item.documentsEn ?? []
    : englishArray(item.documentsEn ?? item.documents, ["Source document checklist TBD"]);
  return docs.length ? docs : [locale === "zh" ? "待确认资料清单" : "Source document checklist TBD"];
}

function overviewRows(content: RoadmapContent, locale: Locale): string[][] {
  return [
    locale === "zh" ? ["项目", "值"] : ["Item", "Value"],
    [locale === "zh" ? "当前状态" : "Current Status", statusLabel(content.currentStatus, locale)],
    [locale === "zh" ? "预计总工期" : "Estimated Duration", content.totalDays ? `${content.totalDays} ${locale === "zh" ? "天" : "days"}` : locale === "zh" ? "待确认" : "TBD"],
    [locale === "zh" ? "预计成本" : "Estimated Cost", content.totalCost || (locale === "zh" ? "待确认" : "TBD")],
    [locale === "zh" ? "里程碑数量" : "Milestones", String(content.items.length)],
  ];
}

function timelineRows(content: RoadmapContent, locale: Locale): string[][] {
  return [
    locale === "zh" ? ["#", "任务", "状态", "工期", "成本", "关键资料"] : ["#", "Task", "Status", "Duration", "Cost", "Key Documents"],
    ...content.items.map((item, index) => [
      String(index + 1),
      itemTitle(item, locale),
      statusLabel(item.status, locale),
      item.days ? `${item.days} ${locale === "zh" ? "天" : "days"}` : locale === "zh" ? "待确认" : "TBD",
      item.cost || (locale === "zh" ? "待确认" : "TBD"),
      itemDocuments(item, locale).join(locale === "zh" ? "、" : ", "),
    ]),
  ];
}

function defaultItems(content: RoadmapContent, locale: Locale): RoadmapContent["items"] {
  if (content.items.length) return content.items;
  return [
    {
      title: locale === "zh" ? "补齐核心合规资料" : "Complete Core Compliance Dossier",
      titleEn: "Complete Core Compliance Dossier",
      description: locale === "zh" ? "根据当前状态补齐标签、说明书、测试报告和供应链声明，形成可复核资料包。" : "Complete labels, manuals, test reports, and supplier declarations based on current status.",
      descriptionEn: "Complete labels, manuals, test reports, and supplier declarations based on current status.",
      status: "PENDING",
      documents: locale === "zh" ? ["铭牌/标签", "说明书", "测试报告", "供应商声明"] : ["Nameplate / labels", "Manual", "Test reports", "Supplier declarations"],
      documentsEn: ["Nameplate / labels", "Manual", "Test reports", "Supplier declarations"],
    },
  ];
}

function acceptanceBullets(item: RoadmapContent["items"][number], locale: Locale): string[] {
  const docs = itemDocuments(item, locale).join(locale === "zh" ? "、" : ", ");
  return locale === "zh"
    ? [
        `交付物齐全：${docs}。`,
        "状态更新有负责人、日期和可追溯证据，不只保留口头结论。",
        "完成后需回填到合规报告、决策报告和利润测算，确保四个结果场景一致。",
      ]
    : [
        `Deliverables completed: ${docs}.`,
        "Status updates include owner, date, and traceable evidence rather than a verbal conclusion only.",
        "Feed the result back into the compliance report, decision report, and profit model so all four result scenes stay aligned.",
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

export async function downloadRoadmapReportAsPdf(content: RoadmapContent, locale?: Locale): Promise<void> {
  const L = resolveLocale(locale);
  const enriched: RoadmapContent = { ...content, items: defaultItems(content, L) };
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await embedFont(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const y = { cur: margin };
  const title = L === "zh" ? "合规路线图报告" : "Compliance Roadmap Report";
  const color = statusColor(enriched.currentStatus);
  const fill = statusFill(enriched.currentStatus);

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
  doc.text(`${L === "zh" ? "当前状态" : "Current Status"}: ${statusLabel(enriched.currentStatus, L)}`, margin + 4, y.cur + 9);
  y.cur += 20;

  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "路线图概览" : "Roadmap Overview");
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, overviewRows(enriched, L), [42, 112]);

  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "里程碑时间表" : "Milestone Timeline");
  pdfDrawTable(doc, y, margin, pageWidth, pageHeight, timelineRows(enriched, L), [10, 44, 24, 20, 24, 52]);

  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "步骤详情与验收标准" : "Step Details and Acceptance Criteria");
  enriched.items.forEach((item, index) => {
    const heading = `${L === "zh" ? "步骤" : "Step"} ${index + 1}: ${itemTitle(item, L)}`;
    pdfBody(doc, y, margin, pageWidth, pageHeight, heading, 9.5);
    pdfBody(doc, y, margin, pageWidth, pageHeight, itemDescription(item, L) || (L === "zh" ? "该步骤需要在执行前补充详细说明。" : "Add detailed execution notes before starting this step."), 8.5);
    acceptanceBullets(item, L).forEach((bullet) => pdfBullet(doc, y, margin, pageWidth, pageHeight, bullet));
  });

  pdfSectionTitle(doc, y, margin, pageWidth, pageHeight, L === "zh" ? "执行建议" : "Implementation Notes");
  const notes = L === "zh"
    ? [
        "优先处理会阻断上架的拒绝项和平台强制字段，再处理可并行优化项。",
        "每个节点都应保留文件版本、负责人、日期和验证状态，方便后续审计。",
        "路线图完成后应重新导出合规、决策和利润报告，确认风险与成本口径一致。",
      ]
    : [
        "Prioritize launch-blocking rejection items and required marketplace fields before parallel optimization tasks.",
        "Keep file version, owner, date, and verification status for every milestone to support audit review.",
        "After roadmap completion, re-export compliance, decision, and profit reports to confirm risk and cost alignment.",
      ];
  notes.forEach((note) => pdfBullet(doc, y, margin, pageWidth, pageHeight, note));

  addPdfFooter(doc, pageWidth, pageHeight, L);
  doc.save(L === "zh" ? `合规路线图报告_${content.sessionId}.pdf` : `ComplianceRoadmap_${content.sessionId}.pdf`);
}

export async function downloadRoadmapReportAsDocx(content: RoadmapContent, locale?: Locale): Promise<void> {
  const L = resolveLocale(locale);
  const enriched: RoadmapContent = { ...content, items: defaultItems(content, L) };
  const title = L === "zh" ? "合规路线图报告" : "Compliance Roadmap Report";

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
    mkSectionH(L === "zh" ? "路线图概览" : "Roadmap Overview"),
    docxTable(overviewRows(enriched, L), ["475569", "475569"]),
    new Paragraph({ text: "" }),
    mkSectionH(L === "zh" ? "里程碑时间表" : "Milestone Timeline"),
    docxTable(timelineRows(enriched, L), ["475569", "1D4ED8", "92400E", "475569", "475569", "475569"]),
    new Paragraph({ text: "" }),
    mkSectionH(L === "zh" ? "步骤详情与验收标准" : "Step Details and Acceptance Criteria"),
  ];

  enriched.items.forEach((item, index) => {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `${L === "zh" ? "步骤" : "Step"} ${index + 1}: ${itemTitle(item, L)}`, bold: true, size: 23, color: "1F2937" })],
        spacing: { before: 120, after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({ text: itemDescription(item, L) || (L === "zh" ? "该步骤需要在执行前补充详细说明。" : "Add detailed execution notes before starting this step."), size: 21, color: "374151" })],
        spacing: { after: 80 },
      }),
    );
    acceptanceBullets(item, L).forEach((bullet) => children.push(mkBullet(bullet)));
  });

  children.push(
    new Paragraph({ text: "" }),
    mkSectionH(L === "zh" ? "当前状态" : "Current Status"),
    docxTable(
      [
        L === "zh" ? ["状态", "处理建议"] : ["Status", "Recommendation"],
        [
          statusLabel(enriched.currentStatus, L),
          L === "zh" ? "按路线图逐项补齐并在完成后重新评估四个结果场景。" : "Complete each roadmap item and reassess all four result scenes after closure.",
        ],
      ],
      ["92400E", "475569"]
    )
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = L === "zh" ? `合规路线图报告_${content.sessionId}.docx` : `ComplianceRoadmap_${content.sessionId}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
