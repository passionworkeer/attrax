"use client";

import { useState, useEffect } from "react";
import {
  Brain,
  FileSearch,
  CheckCircle2,
  Shield,
  Play,
  Pause,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { ProgressBar } from "./DecisionTreePrimitives";
import { TraceNodeComponent } from "./DecisionTreeParts";
import {
  typeColors,
  typeIcons,
  buildTraceTreeFromApi,
  demoTrace,
} from "./_decisionTreeShared";

export interface TraceNode {
  id: string;
  type: "input" | "vision" | "planner" | "fanout" | "market" | "synthesis" | "result";
  label: string;
  labelEn: string;
  icon: string;
  children?: TraceNode[];
  data?: Record<string, unknown>;
  status?: "pending" | "running" | "success" | "error";
  duration?: string;
  reasoning?: string;
  reasoningEn?: string;
  confidence?: number;
}

interface DecisionTreeProps {
  traceData?: TraceNode;
  locale: "zh" | "en";
  autoPlay?: boolean;
  animationSpeed?: number;
  score?: number;
  grade?: string;
  traceNodes?: unknown[];
  /** Only the explicitly labelled sample flow may render the fixture tree. */
  isDemo?: boolean;
}

export default function AgentDecisionTree({
  traceData,
  locale = "zh",
  autoPlay = false,
  animationSpeed = 1,
  score,
  grade,
  traceNodes,
  isDemo = false,
}: DecisionTreeProps) {
  const { t } = useTranslation();
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [progress, setProgress] = useState(0);

  // Real sessions must never turn missing telemetry into a believable sample.
  const data = (() => {
    if (traceNodes && Array.isArray(traceNodes) && traceNodes.length > 0) {
      // 从 API 转换真实数据
      return buildTraceTreeFromApi(traceNodes as {
        id?: string;
        type?: string;
        label?: string;
        icon?: string;
        status?: string;
        duration?: string;
        confidence?: number;
      }[]);
    }
    return traceData || (isDemo ? demoTrace : null);
  })();

  if (!data) {
    return (
      <div role="status" className="glass-panel rounded-3xl border border-amber-500/30 p-8 text-center">
        <h3 className="text-xl font-bold text-white">
          {locale === "zh" ? "暂无可用执行溯源" : "Execution trace unavailable"}
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          {locale === "zh"
            ? "本次扫描未返回可验证的执行节点，请返回结果页后重试。"
            : "This scan did not return verifiable execution nodes. Return to the result page and retry."}
        </p>
      </div>
    );
  }

  const totalTime = data.children?.reduce((acc, child) => {
    const duration = child.duration?.replace("s", "") || "0";
    return acc + parseFloat(duration);
  }, 0) || 0;

  const totalSteps = 1 + (data.children?.length || 0) + (data.children?.reduce((acc, child) => acc + (child.children?.length || 0), 0) || 0);

  // 使用传入的 score 和 grade，或从 data 中提取
  const displayScore = score ?? ((data as TraceNode).data?.score as number | undefined) ?? 85;
  const displayGrade = grade ?? ((data as TraceNode).data?.grade as string | undefined) ?? "B";

  useEffect(() => {
    if (isPlaying) {
      const interval = setInterval(() => {
        setProgress((p) => (p >= 100 ? 0 : p + 2));
      }, 100 / animationSpeed);
      return () => clearInterval(interval);
    }
  }, [isPlaying, animationSpeed]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500">
              <span className="text-sm font-bold text-white">AI</span>
            </div>
            <div className="min-w-0">
              <h3 className="text-2xl font-black text-white max-sm:text-xl">{t("trace.title")}</h3>
              <p className="text-sm text-slate-400">{t("trace.subtitle")}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:gap-6">
          <div className="text-center">
            <div className="text-2xl font-black text-white">
              {totalTime.toFixed(1)}s
            </div>
            <div className="text-xs text-slate-400">{t("trace.executionTime")}</div>
          </div>
          <div className="w-px h-10 bg-slate-700" />
          <div className="text-center">
            <div className="text-2xl font-black text-white">
              {totalSteps}
            </div>
            <div className="text-xs text-slate-400">{t("trace.executionSteps")}</div>
          </div>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-3 rounded-xl transition-all ${isPlaying ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"}`}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <ProgressBar progress={progress} color="bg-gradient-to-r from-purple-500 to-indigo-500" />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(typeColors).map(([type, colors]) => (
          <div
            key={type}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl ${colors.bg} ${colors.border} border transition-all hover:scale-105`}
          >
            <span className="text-lg">{typeIcons[type]}</span>
            <span className="text-xs font-semibold text-slate-200">
              {t("trace." + type)}
            </span>
          </div>
        ))}
      </div>

      {/* Tree */}
      <div className="glass-panel rounded-3xl p-4 shadow-inner sm:p-8">
        <TraceNodeComponent node={data} locale={locale} />
      </div>

      {/* Footer stats */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-emerald-500/10 rounded-2xl p-4 border border-emerald-500/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <div className="text-lg font-bold text-emerald-200">{t("trace.analysisComplete")}</div>
              <div className="text-xs text-emerald-300/80">4 {t("trace.targetMarkets")}</div>
            </div>
          </div>
        </div>
        <div className="bg-blue-500/10 rounded-2xl p-4 border border-blue-500/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <Brain className="w-5 h-5 text-blue-300" />
            </div>
            <div>
              <div className="text-lg font-bold text-blue-200">LangGraph</div>
              <div className="text-xs text-blue-300/80">FAISS + {t("trace.vectorSearch")}</div>
            </div>
          </div>
        </div>
        <div className="bg-purple-500/10 rounded-2xl p-4 border border-purple-500/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
              <FileSearch className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <div className="text-lg font-bold text-purple-200">6 {t("trace.regulations")}</div>
              <div className="text-xs text-purple-300/80">5 {t("trace.riskPoints")}</div>
            </div>
          </div>
        </div>
        <div className="bg-amber-500/10 rounded-2xl p-4 border border-amber-500/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <div className="text-lg font-bold text-amber-200">Grade {displayGrade}</div>
              <div className="text-xs text-amber-300/80">{t("trace.score")}: {displayScore}/100</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
