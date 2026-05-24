"use client";

import { startTransition, useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { unwrapApiData } from "@/lib/api-response";
import { useTranslation } from "@/lib/i18n";
import { mockComplianceReportResult, mockProfitReport } from "@/lib/mock/scan-result";
import { downloadReportAsPdf, downloadReportAsDocx, downloadDecisionReportAsPdf, downloadDecisionReportAsDocx, downloadRoadmapReportAsPdf, downloadRoadmapReportAsDocx } from "@/lib/report-export";
import { ProfitReportView } from "@/components/result/ProfitReportView";
import { AgentTraceTimeline, RetrievedChunks } from "@/components/result/AgentTraceView";
import type { ScanResult, ScanStatus, ComplianceReportResult, ProfitReportResult, ReportPackage } from "@/lib/types";

type ReportLocale = "zh" | "en";

function isComplianceReport(r: unknown): r is ComplianceReportResult {
  return (
    typeof r === "object" &&
    r !== null &&
    "complianceReport" in r &&
    "complianceStatus" in r
  );
}

function isProfitReport(r: unknown): r is ProfitReportResult {
  return (
    typeof r === "object" &&
    r !== null &&
    "barebone" in r &&
    "compliant" in r
  );
}

function reportPackageOf(result: ComplianceReportResult): ReportPackage | undefined {
  const record = result as ComplianceReportResult & { report_package?: ReportPackage };
  return result.reportPackage ?? record.report_package;
}

function toMarkdownList(items: string[] | undefined): string {
  return items?.length ? items.map((item) => `- ${item}`).join("\n") : "- 无";
}

function buildDecisionMarkdown(result: ComplianceReportResult, locale: ReportLocale): string {
  const decision = reportPackageOf(result)?.decisionView ?? reportPackageOf(result)?.decision_view;
  if (decision) {
    const findings = locale === "en" ? decision.keyFindings ?? decision.key_findings : decision.keyFindings ?? decision.key_findings;
    return [
      `## ${locale === "en" ? "AI Decision Report" : "AI 决策报告"}`,
      "",
      decision.summary ? `### ${locale === "en" ? "Summary" : "决策摘要"}\n\n${decision.summary}` : "",
      `### ${locale === "en" ? "Key Findings" : "关键发现"}`,
      toMarkdownList(findings),
      decision.recommendedAction || decision.recommended_action
        ? `### ${locale === "en" ? "Recommended Action" : "建议行动"}\n\n${decision.recommendedAction ?? decision.recommended_action}`
        : "",
      `### ${locale === "en" ? "Node Evidence" : "节点证据"}`,
      toMarkdownList(decision.nodes?.map((node) => `${locale === "en" ? node.labelEn ?? node.label : node.label ?? node.labelEn ?? node.type}: ${locale === "en" ? node.reasoningEn ?? node.reasoning ?? "" : node.reasoning ?? node.reasoningEn ?? ""}`) ?? []),
    ].filter(Boolean).join("\n\n");
  }

  return [
    `## ${locale === "en" ? "AI Decision Report" : "AI 决策报告"}`,
    "",
    `### ${locale === "en" ? "Execution Trace" : "执行链路"}`,
    toMarkdownList(result.agentTrace.map((entry) => `${entry.node}: ${entry.status ?? "UNKNOWN"} ${entry.duration_ms ? `(${Number(entry.duration_ms) / 1000}s)` : ""}`)),
    `### ${locale === "en" ? "Retrieved Evidence" : "检索证据"}`,
    toMarkdownList(result.retrievedChunks.map((chunk) => `${chunk.region} · ${chunk.docName} · ${chunk.articleNo} · score ${chunk.score.toFixed(2)}`)),
  ].join("\n\n");
}

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
    roadmap?.totalDays ? `${locale === "en" ? "Total days" : "总工期"}: ${roadmap.totalDays}` : "",
    roadmap?.totalCost ? `${locale === "en" ? "Estimated cost" : "预估成本"}: ${roadmap.totalCost}` : "",
    `### ${locale === "en" ? "Steps" : "执行步骤"}`,
    items.length
      ? toMarkdownList(items.map((item) => `${locale === "en" ? item.titleEn ?? item.title : item.title ?? item.titleEn}: ${locale === "en" ? item.descriptionEn ?? item.description ?? "" : item.description ?? item.descriptionEn ?? ""} ${item.cost ? `(${item.cost})` : ""}`))
      : toMarkdownList(fallback),
  ].filter(Boolean).join("\n\n");
}

function SourceNotice({ source }: { source?: "real" | "fallback" | "demo" }) {
  const { t } = useTranslation();
  if (source === "fallback") {
    return (
      <div className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-800">
        {t("result.fallbackNotice")}
      </div>
    );
  }
  if (source === "demo") {
    return (
      <div className="mt-6 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-5 py-4 text-sm text-blue-800">
        {t("result.demoNotice")}
      </div>
    );
  }
  return null;
}

function DownloadButtons({
  onPdf,
  onDocx,
  label,
}: {
  onPdf: (dlLocale: ReportLocale) => void;
  onDocx: (dlLocale: ReportLocale) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(["zh", "en"] as const).map((dlLocale) => (
        <div key={dlLocale} className="flex overflow-hidden rounded-lg border border-border bg-muted">
          <button onClick={() => onPdf(dlLocale)} className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-red-500">
            {label} PDF {dlLocale.toUpperCase()}
          </button>
          <button onClick={() => onDocx(dlLocale)} className="border-l border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-blue-500">
            Word {dlLocale.toUpperCase()}
          </button>
        </div>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_META = {
  PASS: { labelKey: "complianceStatus.passed", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  WARN: { labelKey: "complianceStatus.warning", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  REJECTED: { labelKey: "complianceStatus.rejected", color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30" },
  UNKNOWN: { labelKey: "complianceStatus.unknown", color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30" },
} as const;

const GRADE_COLORS = {
  A: "text-emerald-500",
  B: "text-blue-500",
  C: "text-amber-500",
  D: "text-red-500",
} as const;

const MARKET_LABELS: Record<string, string> = {
  EU: "markets.EU",
  US: "markets.US",
  UK: "markets.UK",
  CN: "markets.CN",
  AU: "markets.AU",
  SA: "markets.SA",
  AE: "markets.UAE",
};

// ── Product Image Carousel ──────────────────────────────────────────────────
interface ProductImage {
  imageId: string;
  url: string;
  thumbnail: string;
  width: number;
  height: number;
  angleHint?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  matchedRegulations?: string[];
}

function ImageCarousel({ images }: { images: ProductImage[] }) {
  const [current, setCurrent] = useState(0);
  const prev = useCallback(() => setCurrent((c) => (c > 0 ? c - 1 : images.length - 1)), [images.length]);
  const next = useCallback(() => setCurrent((c) => (c < images.length - 1 ? c + 1 : 0)), [images.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  const img = images[current];
  const regList = img.matchedRegulations?.join(", ");

  return (
    <div className="space-y-3">
      {/* Main carousel */}
      <div className="relative rounded-2xl border border-border bg-muted/30 overflow-hidden">
        <div className="relative aspect-[4/3] w-full">
          <Image src={img.url} alt={img.angleHint ?? img.imageId} fill className="object-contain" />
          {/* Risk region highlight */}
          {img.bbox && (
            <div
              className="absolute border-2 border-blaze-red bg-blaze-red/10 rounded-sm"
              style={{
                left: `${img.bbox.x * 100}%`,
                top: `${img.bbox.y * 100}%`,
                width: `${img.bbox.w * 100}%`,
                height: `${img.bbox.h * 100}%`,
              }}
            />
          )}
        </div>
        {/* Navigation arrows */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
              aria-label="Previous image"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
              aria-label="Next image"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </>
        )}
        {/* Index badge */}
        <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
          {current + 1} / {images.length}
        </div>
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((im, i) => (
            <button
              key={im.imageId}
              type="button"
              onClick={() => setCurrent(i)}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                i === current ? "border-blaze-red" : "border-transparent opacity-60 hover:opacity-80"
              )}
            >
              <Image src={im.thumbnail} alt={im.angleHint ?? im.imageId} width={64} height={64} className="h-16 w-16 object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Image metadata + matched regulations */}
      {img.angleHint && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2.5 py-1 capitalize">{img.angleHint.replace("_", " ")}</span>
          {regList && (
            <>
              <span>·</span>
              <span className="text-blaze-red/70">匹配法规: {regList}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compliance Report View ───────────────────────────────────────────────────
type RichRiskPoint = {
  riskId: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  confidence: number;
  imageId: string;
  bbox: { x: number; y: number; w: number; h: number };
  matched_regulations: Array<{ name: string; article: string }>;
  suggestions: string;
};
type RichChecklistItem = {
  question: string;
  answer: string;
  status: "pass" | "fail" | "warn";
};

function ComplianceReportView({ result }: { result: ComplianceReportResult }) {
  const { t } = useTranslation();
  const meta = STATUS_META[result.complianceStatus] ?? STATUS_META.UNKNOWN;
  const gradeColor = GRADE_COLORS[result.scoreGrade] ?? "text-gray-400";
  const markets = result.targetMarkets.map((m) => MARKET_LABELS[m] ?? m).join(" · ");
  const raw = result as unknown as Record<string, unknown>;
  const richImages = Array.isArray(raw.images) && raw.images.length > 0
    ? (raw.images as ProductImage[])
    : null;
  const richRiskPoints = richImages ? ((raw as { riskPoints?: RichRiskPoint[] }).riskPoints ?? null) : null;
  const richChecklist = richImages ? ((raw as { checklist?: RichChecklistItem[] }).checklist ?? null) : null;
  const richStats = richImages ? ((raw as { totalRisks?: number; passItems?: number; warnItems?: number }) ?? null) : null;

  return (
    <div className="space-y-6">
      {/* Score + Status Header */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col items-center">
          <span className={cn("text-4xl font-bold tabular-nums sm:text-5xl", gradeColor)}>
            {result.complianceScore}
          </span>
          <span className="text-xs text-muted-foreground">{t("result.overallScore")}</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className={cn("inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium", meta.color, meta.bg, meta.border)}>
            <span>{t(meta.labelKey)}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{t("result.grade")}：<span className={cn("font-semibold", gradeColor)}>{result.scoreGrade}</span></span>
            <span>·</span>
            <span>{t("result.category")}：{result.productCategory}</span>
            <span>·</span>
            <span>{t("result.market")}：{markets.split(" · ").map((m) => t(m)).join(" · ")}</span>
            <span>·</span>
            <span>{t("result.retrievalRounds")}：{result.loopCount}</span>
          </div>
        </div>
      </div>

      {/* Agent Trace */}
      {result.agentTrace.length > 0 && (
        <AgentTraceTimeline trace={result.agentTrace} />
      )}

      {/* Retrieved Chunks */}
      <RetrievedChunks chunks={result.retrievedChunks} />

      {/* Product Image Carousel */}
      {richImages && richImages.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold">产品图片分析</h3>
          <ImageCarousel images={richImages} />
        </div>
      )}

      {/* Risk Points Section */}
      {richRiskPoints && richRiskPoints.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold">风险点详情</h3>
          <div className="space-y-4">
            {richRiskPoints.map((risk) => (
              <div key={risk.riskId} className={cn(
                "rounded-xl border p-4",
                risk.severity === "critical" ? "border-blaze-red/40 bg-blaze-red/5" :
                risk.severity === "warning" ? "border-amber-500/40 bg-amber-500/5" :
                "border-blue-500/40 bg-blue-500/5"
              )}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className={cn("font-semibold", risk.severity === "critical" ? "text-blaze-red" : "text-amber-500")}>
                      {risk.title}
                    </h4>
                    <p className="mt-1.5 text-sm text-muted-foreground">{risk.description}</p>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                    risk.severity === "critical" ? "bg-blaze-red/10 text-blaze-red" :
                    risk.severity === "warning" ? "bg-amber-500/10 text-amber-500" :
                    "bg-blue-500/10 text-blue-500"
                  )}>
                    {(risk.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                {risk.matched_regulations.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">涉及法规:</p>
                    {risk.matched_regulations.map((reg, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="text-blaze-red/60">{reg.name}</span>
                        <span className="text-muted-foreground/50">·</span>
                        <span>{reg.article}</span>
                      </div>
                    ))}
                  </div>
                )}
                {risk.suggestions && (
                  <p className="mt-3 border-t border-border/50 pt-3 text-xs text-emerald-600">
                    建议: {risk.suggestions}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compliance Checklist */}
      {richChecklist && richChecklist.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold">合规检查清单</h3>
          <div className="space-y-2">
            {richChecklist.map((item, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <span className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs",
                  item.status === "pass" ? "bg-emerald-500 text-white" :
                  item.status === "fail" ? "bg-blaze-red text-white" :
                  "bg-amber-500 text-white"
                )}>
                  {item.status === "pass" ? "✓" : item.status === "fail" ? "✗" : "!"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.question}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.answer}</p>
                </div>
              </div>
            ))}
          </div>
          {richStats && (
            <div className="mt-4 flex flex-wrap gap-3 rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
              <span>通过: {richStats.passItems ?? 0}</span>
              <span>·</span>
              <span>警告: {richStats.warnItems ?? 0}</span>
              <span>·</span>
              <span>失败: {richStats.totalRisks ?? 0}</span>
            </div>
          )}
        </div>
      )}

      {/* Full Report */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">{t("result.complianceReport")}</h3>
            {result.modelInfo && (
              <span className="text-xs text-muted-foreground">
                {result.modelInfo.ragProvider} · {(result.modelInfo.latencyMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <DownloadButtons
            label="合规"
            onPdf={(dlLocale) => downloadReportAsPdf(result, dlLocale)}
            onDocx={(dlLocale) => downloadReportAsDocx(result, dlLocale)}
          />
        </div>
        <div className="p-5 text-sm leading-relaxed [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_p]:mt-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {result.complianceReport}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function DecisionReportPanel({ result }: { result: ComplianceReportResult }) {
  const { t, locale } = useTranslation();
  const decision = reportPackageOf(result)?.decisionView ?? reportPackageOf(result)?.decision_view;
  const zh = buildDecisionMarkdown(result, "zh");
  const en = buildDecisionMarkdown(result, "en");
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold">AI 决策报告</h3>
        <DownloadButtons
          label="决策"
          onPdf={(dlLocale) => {
            if (decision) {
              downloadDecisionReportAsPdf({
                sessionId: result.sessionId,
                verdict: decision.verdict,
                riskLevel: decision.riskLevel,
                summary: decision.summary,
                keyFindings: decision.keyFindings ?? decision.key_findings,
                recommendedAction: decision.recommendedAction ?? decision.recommended_action,
                nodesEvidence: decision.nodes,
              }, dlLocale);
            } else {
              downloadDecisionReportAsPdf({
                sessionId: result.sessionId,
                verdict: result.complianceStatus,
                riskLevel: result.complianceScore < 50 ? "HIGH" : result.complianceScore < 75 ? "MEDIUM" : "LOW",
                summary: `${t("result.overallScore")}: ${result.complianceScore}`,
                keyFindings: result.retrievedChunks.map((c) => `${c.region} · ${c.docName} · ${c.articleNo}`),
              }, dlLocale);
            }
          }}
          onDocx={(dlLocale) => {
            if (decision) {
              downloadDecisionReportAsDocx({
                sessionId: result.sessionId,
                verdict: decision.verdict,
                riskLevel: decision.riskLevel,
                summary: decision.summary,
                keyFindings: decision.keyFindings ?? decision.key_findings,
                recommendedAction: decision.recommendedAction ?? decision.recommended_action,
                nodesEvidence: decision.nodes,
              }, dlLocale);
            } else {
              downloadDecisionReportAsDocx({
                sessionId: result.sessionId,
                verdict: result.complianceStatus,
                riskLevel: result.complianceScore < 50 ? "HIGH" : result.complianceScore < 75 ? "MEDIUM" : "LOW",
                summary: `${t("result.overallScore")}: ${result.complianceScore}`,
                keyFindings: result.retrievedChunks.map((c) => `${c.region} · ${c.docName} · ${c.articleNo}`),
              }, dlLocale);
            }
          }}
        />
      </div>
      <div className="p-5 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{locale === "en" ? en : zh}</ReactMarkdown>
      </div>
    </div>
  );
}

function RoadmapReportPanel({ result }: { result: ComplianceReportResult }) {
  const { t, locale } = useTranslation();
  const roadmap = reportPackageOf(result)?.roadmap;
  const zh = buildRoadmapMarkdown(result, "zh");
  const en = buildRoadmapMarkdown(result, "en");
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold">合规路线图报告</h3>
        <DownloadButtons
          label="路线图"
          onPdf={(dlLocale) => {
            downloadRoadmapReportAsPdf({
              sessionId: result.sessionId,
              currentStatus: result.complianceStatus,
              totalDays: roadmap?.totalDays,
              totalCost: roadmap?.totalCost,
              items: roadmap?.items?.length
                ? roadmap.items.map((item) => ({
                    title: item.title ?? item.titleEn ?? "",
                    titleEn: item.titleEn,
                    description: item.description ?? item.descriptionEn ?? "",
                    descriptionEn: item.descriptionEn,
                    cost: item.cost,
                    days: item.estimatedDays,
                    status: item.status,
                  }))
                : [{
                    title: `${t("result.overallScore")}: ${result.complianceScore}`,
                    titleEn: `Overall Score: ${result.complianceScore}`,
                    description: result.complianceStatus,
                    descriptionEn: result.complianceStatus,
                  }],
            }, dlLocale);
          }}
          onDocx={(dlLocale) => {
            downloadRoadmapReportAsDocx({
              sessionId: result.sessionId,
              currentStatus: result.complianceStatus,
              totalDays: roadmap?.totalDays,
              totalCost: roadmap?.totalCost,
              items: roadmap?.items?.length
                ? roadmap.items.map((item) => ({
                    title: item.title ?? item.titleEn ?? "",
                    titleEn: item.titleEn,
                    description: item.description ?? item.descriptionEn ?? "",
                    descriptionEn: item.descriptionEn,
                    cost: item.cost,
                    days: item.estimatedDays,
                    status: item.status,
                  }))
                : [{
                    title: `${t("result.overallScore")}: ${result.complianceScore}`,
                    titleEn: `Overall Score: ${result.complianceScore}`,
                    description: result.complianceStatus,
                    descriptionEn: result.complianceStatus,
                  }],
            }, dlLocale);
          }}
        />
      </div>
      <div className="p-5 text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{locale === "en" ? en : zh}</ReactMarkdown>
      </div>
    </div>
  );
}

// ── Legacy Result View ─────────────────────────────────────────────────────────
function LegacyResultView({ result }: { result: ScanResult }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="overflow-hidden rounded-3xl border border-border bg-blaze-dark/95">
        <pre className="max-h-[70vh] overflow-auto p-6 text-xs leading-6 text-white/90 sm:text-sm">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>

      {result.documents.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t("result.uploadedDocs")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("result.documentCount", { count: result.documents.length })}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.documents.map((doc) => {
              const typeLabel = doc.type.toUpperCase();
              const isPdf = doc.type === "pdf";
              const isDocx = doc.type === "docx";
              return (
                <a
                  key={doc.documentId}
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-blaze-red/40 hover:bg-blaze-surface/60"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    {isPdf ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5 text-red-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={cn("size-5", isDocx ? "text-blue-600" : "text-orange-500")}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">{doc.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {typeLabel} · {formatBytes(doc.size)}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

export default function ResultPage() {
  const { t } = useTranslation();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const isDemoSession = sessionId === "demo";
  const [result, setResult] = useState<ScanResult | ComplianceReportResult | null>(
    isDemoSession ? (mockComplianceReportResult as unknown as ScanResult | ComplianceReportResult | null) : null
  );
  const [profitReport, setProfitReport] = useState<ProfitReportResult | null>(
    isDemoSession ? mockProfitReport : null
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!sessionId || isDemoSession) return;

    sessionStorage.setItem("lastSessionId", sessionId);

    const token = sessionStorage.getItem(`scan-token:${sessionId}`);
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

    const cached = sessionStorage.getItem(`scan:${sessionId}`);
    if (cached) {
      try {
        const cachedResult = JSON.parse(cached);
        startTransition(() => {
          setResult(cachedResult);
          setMessage(t("result.restored"));
        });
        fetch(`/api/scan/${sessionId}`, { cache: "no-store", headers: authHeaders })
          .then((r) => r.ok ? r.json() : null)
          .then((rawPayload) => {
            const payload = unwrapApiData<ScanStatus>(rawPayload);
            if (payload?.profitReport && isProfitReport(payload.profitReport)) {
              setProfitReport(payload.profitReport);
            }
          })
          .catch(() => {});
        return;
      } catch {
        sessionStorage.removeItem(`scan:${sessionId}`);
      }
    }

    async function loadResult() {
      const response = await fetch(`/api/scan/${sessionId}`, { cache: "no-store", headers: authHeaders });
      if (!response.ok) {
        startTransition(() => setMessage(t("result.notFound")));
        return;
      }
      const rawPayload: unknown = await response.json();
      const payload = unwrapApiData<ScanStatus>(rawPayload);
      if (!payload) {
        startTransition(() => setMessage(t("result.notFound")));
        return;
      }
      if (payload.status === "ready" && payload.result) {
        startTransition(() => {
          setResult(payload.result ?? null);
          if (payload.profitReport && isProfitReport(payload.profitReport)) {
            setProfitReport(payload.profitReport);
          }
          setMessage(t("result.loaded"));
        });
        return;
      }
      if (payload.status === "failed") {
        startTransition(() => setMessage(payload.error ?? t("result.failed")));
        return;
      }
      startTransition(() => setMessage(t("result.processing")));
    }

    loadResult();
  }, [isDemoSession, sessionId, t]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
      <section className="rounded-4xl border border-white/60 bg-white/85 p-8 shadow-[0_30px_100px_rgba(26,26,46,0.12)] backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-blaze-red/80">Result</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {isDemoSession ? t("result.demoResult") : `${t("result.scanResult")} · ${sessionId}`}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {isDemoSession ? t("result.demoLoaded") : message}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href={`/trace?sessionId=${sessionId}`}
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "shrink-0 border-purple-200 text-purple-600 hover:bg-purple-50")}
            >
              {t("result.aiDecision")}
            </Link>
            <Link
              href={`/roadmap?sessionId=${sessionId}`}
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "shrink-0 border-green-200 text-green-600 hover:bg-green-50")}
            >
              {t("result.complianceRoadmap")}
            </Link>
            <Link
              href="/upload"
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "shrink-0")}
            >
              {t("result.reupload")}
            </Link>
          </div>
        </div>

        {result ? <SourceNotice source={result.source} /> : null}

        {result && isComplianceReport(result) ? (
          <div className="mt-8">
            {profitReport ? (
              <Tabs defaultValue="compliance">
                <TabsList>
                  <TabsTrigger value="compliance">{t("result.complianceReport")}</TabsTrigger>
                  <TabsTrigger value="profit">{t("result.costProfitReport")}</TabsTrigger>
                  <TabsTrigger value="decision">AI 决策报告</TabsTrigger>
                  <TabsTrigger value="roadmap">{t("result.complianceRoadmap")}</TabsTrigger>
                </TabsList>
                <TabsContent value="compliance">
                  <ComplianceReportView result={result} />
                </TabsContent>
                <TabsContent value="profit">
                  <ProfitReportView result={profitReport} />
                </TabsContent>
                <TabsContent value="decision">
                  <DecisionReportPanel result={result} />
                </TabsContent>
                <TabsContent value="roadmap">
                  <RoadmapReportPanel result={result} />
                </TabsContent>
              </Tabs>
            ) : (
              <Tabs defaultValue="compliance">
                <TabsList>
                  <TabsTrigger value="compliance">{t("result.complianceReport")}</TabsTrigger>
                  <TabsTrigger value="decision">AI 决策报告</TabsTrigger>
                  <TabsTrigger value="roadmap">{t("result.complianceRoadmap")}</TabsTrigger>
                </TabsList>
                <TabsContent value="compliance">
                  <ComplianceReportView result={result} />
                </TabsContent>
                <TabsContent value="decision">
                  <DecisionReportPanel result={result} />
                </TabsContent>
                <TabsContent value="roadmap">
                  <RoadmapReportPanel result={result} />
                </TabsContent>
              </Tabs>
            )}
          </div>
        ) : result ? (
          <div className="mt-8">
            <LegacyResultView result={result as ScanResult} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
