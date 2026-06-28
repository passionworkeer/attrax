"use client";

/**
 * DecisionTreeParts.tsx — sub-components split out of AgentDecisionTree.tsx
 * (ResultCard / MarketCard / TraceNodeComponent). Pure refactor; behavior and
 * props unchanged. Imports shared types/maps/helpers from _decisionTreeShared.
 */
import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Lightbulb,
  Clock,
  Target,
  TrendingUp,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  AnimatedEntry,
  ConfidenceBadge,
  ProgressBar,
  ReasoningPanel,
  RiskBadge,
  StatusIcon,
} from "./DecisionTreePrimitives";
import {
  type TraceNode,
  typeColors,
  typeIcons,
  englishFallback,
  englishOptional,
} from "./_decisionTreeShared";

export function ResultCard({ data, locale }: { data: Record<string, unknown>; locale: "zh" | "en" }) {
  const { t } = useTranslation();
  const score = typeof data.score === "number" ? data.score : 0;
  const grade = String(data.grade || "");
  const highRisk = typeof data.highRisk === "number" ? data.highRisk : 0;
  const mediumRisk = typeof data.mediumRisk === "number" ? data.mediumRisk : 0;
  const lowRisk = typeof data.lowRisk === "number" ? data.lowRisk : 0;
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations as Array<{ priority: number; action: string; actionEn: string; deadline: string; cost: string }> : [];
  const timeline = data.timeline as Record<string, string> | undefined;
  const marketSummary = Array.isArray(data.marketSummary) ? data.marketSummary as Array<{ market: string; marketEn: string; status: string; score: number }> : [];
  const timelineLabels: Record<string, { zh: string; en: string }> = {
    preparation: { zh: "准备", en: "Preparation" },
    testing: { zh: "检测", en: "Testing" },
    certification: { zh: "认证", en: "Certification" },
    total: { zh: "总计", en: "Total" },
  };
  const timelineKeys = Object.keys(timelineLabels);

  const gradeColors: Record<string, { bg: string; text: string; ring: string }> = {
    A: { bg: "bg-emerald-500/15", text: "text-emerald-300", ring: "ring-emerald-500/50" },
    B: { bg: "bg-blue-500/15", text: "text-blue-300", ring: "ring-blue-500/50" },
    C: { bg: "bg-amber-500/15", text: "text-amber-300", ring: "ring-amber-500/50" },
    D: { bg: "bg-orange-500/15", text: "text-orange-300", ring: "ring-orange-500/50" },
    F: { bg: "bg-blaze-red/15", text: "text-blaze-red", ring: "ring-blaze-red/50" },
  };

  return (
    <AnimatedEntry delay={200}>
      <div className="mt-4 space-y-4">
        {/* Score and Grade */}
        <div className="flex items-center justify-center gap-8 p-4 bg-slate-900/40 rounded-xl border border-white/10">
          <div className="text-center">
            <div className="relative">
              <div className="text-5xl font-black text-blaze-red">{score}</div>
              <span className="absolute -right-4 top-0 text-sm text-slate-500">/100</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">{t("trace.score")}</div>
          </div>
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-black ring-4 ${gradeColors[grade]?.ring || "ring-gray-300"} ${gradeColors[grade]?.bg || "bg-slate-500/15"} ${gradeColors[grade]?.text || "text-slate-200"}`}>
            {grade}
          </div>
        </div>

        {/* Market Summary */}
        {marketSummary.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {marketSummary.map((m, i) => (
              <div key={i} className={`p-3 rounded-xl border ${m.status === "pass" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" : "bg-amber-500/15 border-amber-500/40 text-amber-300"}`}>
                <div className="text-lg font-bold">{locale === "en" ? m.marketEn : m.market}</div>
                <div className="text-2xl font-black mt-1">{m.score}</div>
                <div className="text-xs text-slate-400">{t("trace.score")}</div>
              </div>
            ))}
          </div>
        )}

        {/* Risk Summary */}
        <div className="flex items-center justify-center gap-3">
          <RiskBadge level="high" count={highRisk} locale={locale} />
          <RiskBadge level="medium" count={mediumRisk} locale={locale} />
          <RiskBadge level="low" count={lowRisk} locale={locale} />
        </div>

        {/* Timeline */}
        {timeline && (
          <div className="p-4 bg-slate-900/40 rounded-xl border border-white/10">
            <div className="text-xs font-semibold text-slate-400 mb-2">{t("trace.estimatedTimeline")}</div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {timelineKeys.map((key) => {
                const value =
                  locale === "en"
                    ? englishFallback(timeline[`${key}En`] ?? timeline[key], "—")
                    : timeline[key] ?? timeline[`${key}En`] ?? "—";
                const displayKey = locale === "en" ? timelineLabels[key].en : timelineLabels[key].zh;
                return (
                  <div key={key} className="p-2 bg-slate-950/60 rounded-lg border border-white/10">
                    <div className="text-lg font-bold text-white">{value}</div>
                    <div className="text-xs text-slate-400">{displayKey}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="border-t border-white/10 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-200">{t("trace.suggestedAction")}</span>
            </div>
            <div className="space-y-2">
              {recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-slate-900/40 rounded-xl border border-white/10 hover:border-blaze-red/40 transition-colors">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold ${
                    rec.priority === 1 ? "bg-red-500/15 text-red-300" : rec.priority === 2 ? "bg-amber-500/15 text-amber-300" : "bg-slate-500/15 text-slate-300"
                  }`}>
                    {rec.priority}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{locale === "en" ? rec.actionEn : rec.action}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {rec.deadline}
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        {rec.cost}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AnimatedEntry>
  );
}

export function MarketCard({ node, locale }: { node: TraceNode; locale: "zh" | "en" }) {
  const { t } = useTranslation();
  const data = node.data as {
    regulations?: number;
    highRisk?: number;
    mediumRisk?: number;
    lowRisk?: number;
    topMatch?: { title: string; titleEn: string; score: number; effectiveDate: string };
    complianceRate?: number;
  } | undefined;

  return (
    <AnimatedEntry delay={150}>
      <div className="space-y-3">
        {/* Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-white">{data?.regulations || 0}</span>
            <span className="text-sm text-slate-300">{t("trace.regulations")}</span>
          </div>
          <ConfidenceBadge confidence={node.confidence} />
        </div>

        {/* Compliance Rate */}
        {data?.complianceRate !== undefined && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{t("result.overallScore")}</span>
              <span className="font-medium text-slate-200">{data.complianceRate}%</span>
            </div>
            <ProgressBar progress={data.complianceRate} color={data.complianceRate >= 80 ? "bg-green-500" : data.complianceRate >= 50 ? "bg-amber-500" : "bg-red-500"} />
          </div>
        )}

        {/* Risk badges */}
        <div className="flex flex-wrap gap-2">
          <RiskBadge level="high" count={data?.highRisk || 0} locale={locale} />
          <RiskBadge level="medium" count={data?.mediumRisk || 0} locale={locale} />
          <RiskBadge level="low" count={data?.lowRisk || 0} locale={locale} />
        </div>

        {/* Top match */}
        {data?.topMatch && (
          <div className="p-3 bg-slate-900/40 rounded-lg border border-white/10">
            <div className="text-xs text-slate-400 mb-1">{t("trace.maxMatch")}</div>
            <div className="text-sm font-medium text-white">{locale === "en" ? data.topMatch.titleEn : data.topMatch.title}</div>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
              <span>{Math.round(data.topMatch.score * 100)}%</span>
              <span>•</span>
              <span>{t("trace.effective")}: {data.topMatch.effectiveDate}</span>
            </div>
          </div>
        )}
      </div>
    </AnimatedEntry>
  );
}

export function TraceNodeComponent({
  node,
  locale,
  depth = 0,
  index = 0,
}: {
  node: TraceNode;
  locale: "zh" | "en";
  depth?: number;
  index?: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(depth <= 1);
  const [showReasoning, setShowReasoning] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const colors = typeColors[node.type] || typeColors.input;
  const label = locale === "en" ? englishFallback(node.labelEn || node.label, node.type) : node.label;
  const reasoning = locale === "en"
    ? node.reasoningEn || englishOptional(node.reasoning)
    : node.reasoning;

  const handleToggle = () => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
  };

  return (
    <AnimatedEntry delay={index * 100}>
      <div className="relative">
        {/* Connector line */}
        {depth > 0 && (
          <div className="absolute -left-6 top-6 w-4 h-px bg-gradient-to-r from-transparent to-white/30" />
        )}

        {/* Node card */}
        <div
          className={`relative rounded-2xl border-2 ${colors.bg} ${colors.border} overflow-hidden transition-all duration-300 ${
            depth === 0 ? "shadow-lg" : "hover:shadow-md hover:border-opacity-70"
          }`}
        >
          {/* Status bar */}
          <div className={`h-1 ${colors.dark} ${node.status === "running" ? "animate-pulse" : ""}`} />

          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`relative flex items-center justify-center w-14 h-14 rounded-2xl ${colors.light} shadow-sm`}>
                  <span className="text-3xl">{node.icon || typeIcons[node.type]}</span>
                  <div className="absolute -bottom-1 -right-1">
                    <StatusIcon status={node.status} />
                  </div>
                </div>
                <div>
                  <h4 className="text-lg font-bold text-white">{label}</h4>
                  <div className="flex items-center gap-3 mt-1">
                    {node.duration && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-mono">
                        <Clock className="w-3 h-3" />
                        {node.duration}
                      </span>
                    )}
                    <ConfidenceBadge confidence={node.confidence} />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {node.reasoning && (
                  <button
                    onClick={() => setShowReasoning(!showReasoning)}
                    className={`p-2 rounded-xl transition-all ${showReasoning ? `${colors.light} ${colors.text}` : "hover:bg-slate-500/15 text-slate-400"}`}
                    title={t("trace.aiReasoning")}
                  >
                    <Lightbulb className="w-5 h-5" />
                  </button>
                )}
                {hasChildren && (
                  <button
                    onClick={handleToggle}
                    className="p-2 rounded-xl hover:bg-slate-500/15 transition-colors"
                  >
                    {expanded ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Reasoning panel */}
            {showReasoning && <ReasoningPanel text={reasoning} />}

            {/* Data content */}
            {node.data && !showReasoning && (
              <div className="mt-4 pt-4 border-t border-slate-500/40">
                {node.type === "result" && <ResultCard data={node.data} locale={locale} />}
                {node.type === "market" && <MarketCard node={node} locale={locale} />}
              </div>
            )}
          </div>
        </div>

        {/* Children */}
        {hasChildren && expanded && (
          <div className="mt-4 ml-6 pl-6 border-l-2 border-dashed border-white/15 space-y-4">
            {node.children!.map((child, idx) => (
              <TraceNodeComponent key={child.id} node={child} locale={locale} depth={depth + 1} index={idx} />
            ))}
          </div>
        )}
      </div>
    </AnimatedEntry>
  );
}
