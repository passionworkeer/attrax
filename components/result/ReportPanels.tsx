"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "@/lib/i18n";
import { DownloadButtons } from "@/components/result/DownloadButtons";
import {
  englishArray,
  englishText,
  localizeComplianceReportResult,
} from "@/lib/report-localization";
import { type ReportLocale } from "@/components/result/SourceNotice";
import {
  downloadDecisionReportAsDocx,
  downloadDecisionReportAsPdf,
  downloadRoadmapReportAsDocx,
  downloadRoadmapReportAsPdf,
} from "@/lib/report-export";
import type { DecisionContent } from "@/lib/report-export-modules/decision";
import type { RoadmapContent } from "@/lib/report-export-modules/roadmap";
import type { ComplianceReportResult, ReportPackage } from "@/lib/types";

type DecisionView = NonNullable<ReportPackage["decisionView"]> | NonNullable<ReportPackage["decision_view"]>;

// ── Markdown helpers (only used by the two panels below) ─────────────────────

function escapeTableCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim() || "—";
}

function toMarkdownList(items: string[] | undefined, locale: ReportLocale = "zh"): string {
  const safeItems = locale === "en" ? englishArray(items, ["None"]) : items ?? [];
  return safeItems.length
    ? safeItems.map((item) => `- ${item}`).join("\n")
    : locale === "en"
      ? "- None"
      : "- 无";
}

function toMarkdownTable(headers: string[], rows: unknown[][]): string {
  return [
    `| ${headers.map(escapeTableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
  ].join("\n");
}

// ── Decision helpers ─────────────────────────────────────────────────────────

function reportPackageOf(result: ComplianceReportResult): ReportPackage | undefined {
  return result.reportPackage;
}

function localizedDecisionSummary(decision: DecisionView, locale: ReportLocale): string | undefined {
  if (!decision) return undefined;
  if (locale !== "en") return decision.summary;
  return englishText(
    decision.summaryEn ?? decision.summary_en,
    englishText(decision.summary, "Decision summary pending"),
  );
}

function localizedDecisionFindings(decision: DecisionView, locale: ReportLocale): string[] | undefined {
  if (!decision) return undefined;
  if (locale !== "en") return decision.keyFindings ?? decision.key_findings;
  return englishArray(
    decision.keyFindingsEn ?? decision.key_findings_en ?? decision.keyFindings ?? decision.key_findings,
    ["Evidence review pending"],
  );
}

function localizedDecisionAction(decision: DecisionView, locale: ReportLocale): string | undefined {
  if (!decision) return undefined;
  if (locale !== "en") return decision.recommendedAction ?? decision.recommended_action;
  return englishText(
    decision.recommendedActionEn ?? decision.recommended_action_en,
    englishText(decision.recommendedAction ?? decision.recommended_action, "Recommended action pending"),
  );
}

function buildDecisionContent(result: ComplianceReportResult, locale: ReportLocale): DecisionContent {
  const localizedResult = localizeComplianceReportResult(result, locale);
  const decision = reportPackageOf(result)?.decisionView ?? reportPackageOf(result)?.decision_view;
  if (decision) {
    return {
      sessionId: result.sessionId,
      verdict: decision.verdict,
      riskLevel: decision.riskLevel,
      summary: localizedDecisionSummary(decision, locale),
      keyFindings: localizedDecisionFindings(decision, locale),
      recommendedAction: localizedDecisionAction(decision, locale),
      nodesEvidence: decision.nodes,
    };
  }
  return {
    sessionId: result.sessionId,
    verdict: result.complianceStatus,
    riskLevel:
      result.complianceScore < 50 ? "HIGH" : result.complianceScore < 75 ? "MEDIUM" : "LOW",
    summary:
      locale === "en"
        ? `Overall Score: ${result.complianceScore}`
        : `总体评分：${result.complianceScore}`,
    keyFindings: localizedResult.retrievedChunks.map(
      (c) => `${c.region} · ${c.docName} · ${c.articleNo}`,
    ),
  };
}

function buildDecisionMarkdown(result: ComplianceReportResult, locale: ReportLocale): string {
  const decision = reportPackageOf(result)?.decisionView ?? reportPackageOf(result)?.decision_view;
  if (decision) {
    const summary = localizedDecisionSummary(decision, locale);
    const findings = localizedDecisionFindings(decision, locale);
    const recommendedAction = localizedDecisionAction(decision, locale);
    const nodeRows =
      decision.nodes?.map((node) => [
        locale === "en"
          ? englishText(
              node.labelEn ?? node.label_en,
              englishText(node.label ?? node.type, node.type ?? "Decision node"),
            )
          : node.label ?? node.labelEn ?? node.label_en ?? node.type,
        node.status ?? node.type ?? (locale === "en" ? "Reviewed" : "已复核"),
        typeof node.confidence === "number" ? `${Math.round(node.confidence * 100)}%` : "—",
        locale === "en"
          ? englishText(
              node.reasoningEn ?? node.reasoning_en,
              englishText(node.reasoning, "Node evidence pending"),
            )
          : node.reasoning ?? node.reasoningEn ?? node.reasoning_en ?? "",
      ]) ?? [];
    return [
      `## ${locale === "en" ? "AI Decision Report" : "AI 决策报告"}`,
      "",
      toMarkdownTable(
        locale === "en" ? ["Decision", "Risk Level", "Review Gate"] : ["决策结果", "风险等级", "复核门槛"],
        [
          [
            decision.verdict ?? "UNKNOWN",
            decision.riskLevel ?? "UNKNOWN",
            locale === "en" ? "Evidence completion before launch" : "资料补齐后再上架",
          ],
        ],
      ),
      summary ? `### ${locale === "en" ? "Summary" : "决策摘要"}\n\n${summary}` : "",
      `### ${locale === "en" ? "Key Findings" : "关键发现"}`,
      toMarkdownList(findings, locale),
      recommendedAction
        ? `### ${locale === "en" ? "Recommended Action" : "建议行动"}\n\n${recommendedAction}`
        : "",
      `### ${locale === "en" ? "Node Evidence Matrix" : "节点证据矩阵"}`,
      toMarkdownTable(
        locale === "en" ? ["Node", "Status", "Confidence", "Reasoning"] : ["节点", "状态", "置信度", "推理依据"],
        nodeRows.length
          ? nodeRows
          : [
              [
                locale === "en" ? "Overall decision" : "综合判断",
                locale === "en" ? "Pending" : "待补充",
                "—",
                locale === "en" ? "No node-level evidence provided." : "暂无节点级证据。",
              ],
            ],
      ),
      `### ${locale === "en" ? "Assumptions and Limits" : "假设与限制"}`,
      toMarkdownList(
        locale === "en"
          ? [
              "This AI report supports pre-review and dossier preparation; it is not a certificate or legal opinion.",
              "If product structure, supplier, or market scope changes, rerun the assessment.",
            ]
          : [
              "AI 决策报告用于业务预审和资料准备，不等同于认证证书或法律意见。",
              "若产品结构、供应商或目标市场变化，需要重新评估。",
            ],
        locale,
      ),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  const localizedResult = localizeComplianceReportResult(result, locale);
  return [
    `## ${locale === "en" ? "AI Decision Report" : "AI 决策报告"}`,
    "",
    `### ${locale === "en" ? "Execution Trace" : "执行链路"}`,
    toMarkdownList(
      result.agentTrace.map(
        (entry) =>
          `${entry.node}: ${entry.status ?? "UNKNOWN"} ${entry.duration_ms ? `(${Number(entry.duration_ms) / 1000}s)` : ""}`,
      ),
      locale,
    ),
    `### ${locale === "en" ? "Retrieved Evidence" : "检索证据"}`,
    toMarkdownList(
      localizedResult.retrievedChunks.map(
        (chunk) =>
          `${chunk.region} · ${chunk.docName} · ${chunk.articleNo} · score ${chunk.score.toFixed(2)}`,
      ),
      locale,
    ),
  ].join("\n\n");
}

// ── Roadmap helpers ──────────────────────────────────────────────────────────

function buildRoadmapMarkdown(result: ComplianceReportResult, locale: ReportLocale): string {
  const roadmap = reportPackageOf(result)?.roadmap;
  const items = roadmap?.items ?? [];
  const fallback = [
    `${locale === "en" ? "Compliance score" : "合规评分"}: ${result.complianceScore}`,
    `${locale === "en" ? "Status" : "状态"}: ${result.complianceStatus}`,
    `${locale === "en" ? "Markets" : "市场"}: ${result.targetMarkets.join(", ")}`,
  ];
  return [
    `## ${locale === "en" ? "Compliance Roadmap" : "合规路线图"}`,
    "",
    toMarkdownTable(
      locale === "en"
        ? ["Current Status", "Total Days", "Estimated Cost", "Milestones"]
        : ["当前状态", "总工期", "预估成本", "里程碑"],
      [
        [
          result.complianceStatus,
          roadmap?.totalDays ? `${roadmap.totalDays}` : locale === "en" ? "TBD" : "待确认",
          roadmap?.totalCost ?? (locale === "en" ? "TBD" : "待确认"),
          items.length || 1,
        ],
      ],
    ),
    `### ${locale === "en" ? "Milestone Timeline" : "里程碑时间表"}`,
    items.length
      ? toMarkdownTable(
          locale === "en"
            ? ["#", "Task", "Status", "Duration", "Cost", "Key Documents"]
            : ["#", "任务", "状态", "工期", "成本", "关键资料"],
          items.map((item, index) => [
            index + 1,
            locale === "en"
              ? englishText(
                  item.titleEn ?? item.title_en,
                  englishText(item.title, "Roadmap task"),
                )
              : item.title ?? item.titleEn ?? item.title_en,
            item.status ?? (locale === "en" ? "Pending" : "待处理"),
            item.estimatedDays ?? item.estimated_days
              ? `${item.estimatedDays ?? item.estimated_days} ${locale === "en" ? "days" : "天"}`
              : locale === "en"
                ? "TBD"
                : "待确认",
            item.cost ?? (locale === "en" ? "TBD" : "待确认"),
            (
              locale === "en"
                ? englishArray(item.documentsEn ?? item.documents_en ?? item.documents, [
                    "Checklist TBD",
                  ])
                : item.documents ?? item.documentsEn ?? item.documents_en
            )?.join(locale === "en" ? ", " : "、") ??
              (locale === "en" ? "Checklist TBD" : "资料清单待确认"),
          ]),
        )
      : toMarkdownList(fallback, locale),
    `### ${locale === "en" ? "Execution Notes" : "执行建议"}`,
    toMarkdownList(
      locale === "en"
        ? [
            "Prioritize launch-blocking rejection items and marketplace-required fields.",
            "Keep owner, date, file version, and evidence status for each milestone.",
            "After closure, re-export compliance, decision, and profit reports so risk and cost stay aligned.",
          ]
        : [
            "优先处理阻断上架的拒绝项和平台强制字段。",
            "每个里程碑保留负责人、日期、文件版本和证据状态。",
            "路线图完成后重新导出合规、决策和利润报告，确保风险与成本口径一致。",
          ],
      locale,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRoadmapContent(result: ComplianceReportResult): RoadmapContent {
  const roadmap = reportPackageOf(result)?.roadmap;
  return {
    sessionId: result.sessionId,
    currentStatus: result.complianceStatus,
    currentStatusEn: result.complianceStatus,
    totalDays: roadmap?.totalDays,
    totalCost: roadmap?.totalCost,
    progress: roadmap?.progress,
    items: roadmap?.items?.length
      ? roadmap.items.map((item) => ({
          title: item.title ?? item.titleEn ?? "",
          titleEn: item.titleEn ?? item.title_en,
          description: item.description ?? item.descriptionEn ?? "",
          descriptionEn: item.descriptionEn ?? item.description_en,
          cost: item.cost,
          days: item.estimatedDays ?? item.estimated_days,
          status: item.status,
          documents: item.documents,
          documentsEn: item.documentsEn ?? item.documents_en,
        }))
      : [
          {
            title: `总体评分：${result.complianceScore}`,
            titleEn: `Overall Score: ${result.complianceScore}`,
            description: result.complianceStatus,
            descriptionEn: result.complianceStatus,
          },
        ],
  };
}

// ── Panels ──────────────────────────────────────────────────────────────────

export function DecisionReportPanel({ result }: { result: ComplianceReportResult }) {
  const { t, locale } = useTranslation();
  const zh = buildDecisionMarkdown(result, "zh");
  const en = buildDecisionMarkdown(result, "en");
  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <h3 className="text-sm font-semibold text-white">{t("result.aiDecisionReport")}</h3>
        <DownloadButtons
          label={t("result.decisionShort")}
          onPdf={(dlLocale) => downloadDecisionReportAsPdf(buildDecisionContent(result, dlLocale), dlLocale)}
          onDocx={(dlLocale) => downloadDecisionReportAsDocx(buildDecisionContent(result, dlLocale), dlLocale)}
        />
      </div>
      <div className="p-5 text-sm leading-relaxed text-slate-200 [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap [&_th]:border [&_th]:border-white/10 [&_th]:bg-slate-800/50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-slate-200 [&_td]:border [&_td]:border-white/10 [&_td]:px-3 [&_td]:py-1.5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{locale === "en" ? en : zh}</ReactMarkdown>
      </div>
    </div>
  );
}

export function RoadmapReportPanel({ result }: { result: ComplianceReportResult }) {
  const { t, locale } = useTranslation();
  const zh = buildRoadmapMarkdown(result, "zh");
  const en = buildRoadmapMarkdown(result, "en");
  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <h3 className="text-sm font-semibold text-white">{t("result.roadmapReport")}</h3>
        <DownloadButtons
          label={t("result.roadmapShort")}
          onPdf={(dlLocale) => downloadRoadmapReportAsPdf(buildRoadmapContent(result), dlLocale)}
          onDocx={(dlLocale) => downloadRoadmapReportAsDocx(buildRoadmapContent(result), dlLocale)}
        />
      </div>
      <div className="p-5 text-sm leading-relaxed text-slate-200 [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap [&_th]:border [&_th]:border-white/10 [&_th]:bg-slate-800/50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-slate-200 [&_td]:border [&_td]:border-white/10 [&_td]:px-3 [&_td]:py-1.5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{locale === "en" ? en : zh}</ReactMarkdown>
      </div>
    </div>
  );
}
