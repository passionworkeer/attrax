"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { englishText, localizeComplianceReportResult } from "@/lib/report-localization";
import { downloadReportAsDocx, downloadReportAsPdf } from "@/lib/report-export";
import { AgentTraceTimeline, RetrievedChunks } from "@/components/result/AgentTraceView";
import { DownloadButtons } from "@/components/result/DownloadButtons";
import { ImageCarousel, type ProductImage } from "@/components/result/ImageCarousel";
import type { ComplianceReportResult } from "@/lib/types";

const STATUS_META = {
  PASS: { labelKey: "complianceStatus.passed", color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40" },
  WARN: { labelKey: "complianceStatus.warning", color: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/40" },
  REJECTED: { labelKey: "complianceStatus.rejected", color: "text-blaze-red", bg: "bg-blaze-red/15", border: "border-blaze-red/40" },
  UNKNOWN: { labelKey: "complianceStatus.unknown", color: "text-slate-400", bg: "bg-slate-500/15", border: "border-white/10" },
} as const;

const GRADE_COLORS = {
  A: "text-emerald-400",
  B: "text-blaze-cyan",
  C: "text-amber-400",
  D: "text-blaze-red",
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

type RichRiskPoint = {
  riskId: string;
  title: string;
  titleEn?: string;
  description: string;
  descriptionEn?: string;
  severity: "critical" | "warning" | "info";
  confidence: number;
  imageId: string;
  bbox: { x: number; y: number; w: number; h: number };
  matched_regulations: Array<{ name: string; nameEn?: string; article: string }>;
  suggestions: string;
  suggestionsEn?: string;
};

type RichChecklistItem = {
  question: string;
  questionEn?: string;
  answer: string;
  answerEn?: string;
  status: "pass" | "fail" | "warn";
};

export function ComplianceReportView({ result }: { result: ComplianceReportResult }) {
  const { t, locale } = useTranslation();
  const viewResult = localizeComplianceReportResult(result, locale);
  const meta = STATUS_META[viewResult.complianceStatus] ?? STATUS_META.UNKNOWN;
  const gradeColor = GRADE_COLORS[viewResult.scoreGrade] ?? "text-gray-400";
  const markets = viewResult.targetMarkets.map((m) => MARKET_LABELS[m] ?? m).join(" · ");
  const raw = result as unknown as Record<string, unknown>;
  const richImages =
    Array.isArray(raw.images) && raw.images.length > 0 ? (raw.images as ProductImage[]) : null;
  const richRiskPoints = richImages
    ? ((raw as { riskPoints?: RichRiskPoint[] }).riskPoints ?? null)
    : null;
  const richChecklist = richImages
    ? ((raw as { checklist?: RichChecklistItem[] }).checklist ?? null)
    : null;
  const richStats = richImages
    ? ((raw as { totalRisks?: number; passItems?: number; warnItems?: number }) ?? null)
    : null;

  return (
    <div className="space-y-6">
      {/* Score + Status Header */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col items-center">
          <span className={cn("text-4xl font-bold tabular-nums sm:text-5xl", gradeColor)}>
            {viewResult.complianceScore}
          </span>
          <span className="text-xs text-slate-400">{t("result.overallScore")}</span>
        </div>
        <div className="flex flex-col gap-2">
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium",
              meta.color,
              meta.bg,
              meta.border,
            )}
          >
            <span>{t(meta.labelKey)}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-400">
            <span>
              {t("result.grade")}：
              <span className={cn("font-semibold", gradeColor)}>{viewResult.scoreGrade}</span>
            </span>
            <span>·</span>
            <span>
              {t("result.category")}：{viewResult.productCategory}
            </span>
            <span>·</span>
            <span>
              {t("result.market")}：
              {markets
                .split(" · ")
                .map((m) => t(m))
                .join(" · ")}
            </span>
            <span>·</span>
            <span>
              {t("result.retrievalRounds")}：{viewResult.loopCount}
            </span>
          </div>
        </div>
      </div>

      {/* Agent Trace */}
      {viewResult.agentTrace.length > 0 && <AgentTraceTimeline trace={viewResult.agentTrace} />}

      {/* Retrieved Chunks */}
      <RetrievedChunks chunks={viewResult.retrievedChunks} />

      {/* Product Image Carousel */}
      {richImages && richImages.length > 0 && (
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">
            {t("result.productImageAnalysis")}
          </h3>
          <ImageCarousel images={richImages} />
        </div>
      )}

      {/* Risk Points Section */}
      {richRiskPoints && richRiskPoints.length > 0 && (
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">{t("result.riskPointDetails")}</h3>
          <div className="space-y-4">
            {richRiskPoints.map((risk) => {
              const riskTitle =
                locale === "en"
                  ? englishText(risk.titleEn, englishText(risk.title, "Risk item"))
                  : risk.title;
              const riskDescription =
                locale === "en"
                  ? englishText(
                      risk.descriptionEn,
                      englishText(risk.description, "Risk description pending"),
                    )
                  : risk.description;
              const riskSuggestions =
                locale === "en"
                  ? englishText(risk.suggestionsEn, englishText(risk.suggestions, ""))
                  : risk.suggestions;
              return (
                <div
                  key={risk.riskId}
                  className={cn(
                    "rounded-xl border p-4",
                    risk.severity === "critical"
                      ? "border-blaze-red/40 bg-blaze-red/5"
                      : risk.severity === "warning"
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-blue-500/40 bg-blue-500/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4
                        className={cn(
                          "font-semibold",
                          risk.severity === "critical"
                            ? "text-blaze-red"
                            : risk.severity === "warning"
                              ? "text-amber-400"
                              : "text-blaze-cyan",
                        )}
                      >
                        {riskTitle}
                      </h4>
                      <p className="mt-1.5 text-sm text-slate-400">{riskDescription}</p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                        risk.severity === "critical"
                          ? "bg-blaze-red/15 text-blaze-red"
                          : risk.severity === "warning"
                            ? "bg-amber-500/15 text-amber-400"
                            : "bg-blue-500/15 text-blaze-cyan",
                      )}
                    >
                      {(risk.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  {risk.matched_regulations.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-slate-400">
                        {t("result.relatedRegulations")}:
                      </p>
                      {risk.matched_regulations.map((reg, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-xs text-slate-400"
                        >
                          <span className="text-blaze-red/70">
                            {locale === "en"
                              ? englishText(
                                  reg.nameEn,
                                  englishText(reg.name, "Regulation document"),
                                )
                              : reg.name}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span>{reg.article}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {riskSuggestions && (
                    <p className="mt-3 border-t border-white/10 pt-3 text-xs text-emerald-400">
                      {t("result.suggestion")}: {riskSuggestions}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Compliance Checklist */}
      {richChecklist && richChecklist.length > 0 && (
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">
            {t("result.complianceChecklist")}
          </h3>
          <div className="space-y-2">
            {richChecklist.map((item, i) => {
              const question =
                locale === "en"
                  ? englishText(item.questionEn, englishText(item.question, "Checklist question"))
                  : item.question;
              const answer =
                locale === "en"
                  ? englishText(item.answerEn, englishText(item.answer, "Checklist answer pending"))
                  : item.answer;
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-slate-900/40 p-3"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      item.status === "pass"
                        ? "bg-emerald-500 text-white"
                        : item.status === "fail"
                          ? "bg-blaze-red text-white"
                          : "bg-amber-500 text-white",
                    )}
                  >
                    {item.status === "pass" ? "✓" : item.status === "fail" ? "✗" : "!"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{question}</p>
                    <p className="mt-1 text-xs text-slate-400">{answer}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {richStats && (
            <div className="mt-4 flex flex-wrap gap-3 rounded-xl bg-slate-900/40 border border-white/10 px-4 py-3 text-xs text-slate-400">
              <span>
                {t("result.passed")}:{" "}
                <span className="text-emerald-400 font-semibold">
                  {richStats.passItems ?? 0}
                </span>
              </span>
              <span>·</span>
              <span>
                {t("result.warnings")}:{" "}
                <span className="text-amber-400 font-semibold">
                  {richStats.warnItems ?? 0}
                </span>
              </span>
              <span>·</span>
              <span>
                {t("result.failedCount")}:{" "}
                <span className="text-blaze-red font-semibold">
                  {richStats.totalRisks ?? 0}
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Full Report */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-white">{t("result.complianceReport")}</h3>
            {result.modelInfo && (
              <span className="text-xs text-slate-400 data-mono">
                {viewResult.modelInfo.ragProvider} ·{" "}
                {(viewResult.modelInfo.latencyMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <DownloadButtons
            label={t("result.complianceShort")}
            onPdf={(dlLocale) => downloadReportAsPdf(result, dlLocale)}
            onDocx={(dlLocale) => downloadReportAsDocx(result, dlLocale)}
          />
        </div>
        <div className="p-5 text-sm leading-relaxed text-slate-200 [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_p]:mt-2 [&_code]:rounded [&_code]:bg-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-blaze-cyan [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-400 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:whitespace-nowrap [&_th]:border [&_th]:border-white/10 [&_th]:bg-slate-800/50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-slate-200 [&_td]:border [&_td]:border-white/10 [&_td]:px-3 [&_td]:py-1.5 [&_a]:text-blaze-cyan [&_a]:underline [&_a]:decoration-blaze-cyan/40 hover:[&_a]:text-blaze-red hover:[&_a]:decoration-blaze-red/60">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {viewResult.complianceReport}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
