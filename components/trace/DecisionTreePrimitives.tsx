"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Lightbulb, Loader2, XCircle, Zap } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/**
 * Small visual primitives used by AgentDecisionTree. Kept in their own file
 * so the main tree renderer stays focused on the decision-tree logic and
 * the timeline assembly. All components are presentational with no state
 * shared across them except via props.
 */

export function AnimatedEntry({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"} ${className}`}
    >
      {children}
    </div>
  );
}

export function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "pending":
      return <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />;
    case "running":
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case "success":
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case "error":
      return <XCircle className="w-4 h-4 text-red-500" />;
    default:
      return null;
  }
}

export function ProgressBar({
  progress,
  color = "bg-blue-500",
}: {
  progress: number;
  color?: string;
}) {
  return (
    <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-500 ease-out`}
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

export function ConfidenceBadge({ confidence }: { confidence?: number }) {
  if (!confidence) return null;
  const percentage = Math.round(confidence * 100);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-500/15 text-xs font-medium">
      <Zap className="w-3 h-3" />
      {percentage}%
    </span>
  );
}

export function RiskBadge({
  level,
  count,
  locale,
}: {
  level: "high" | "medium" | "low";
  count: number;
  locale: "zh" | "en";
}) {
  if (count === 0) return null;
  const config = {
    high: {
      bg: "bg-red-500/15",
      text: "text-red-300",
      border: "border-red-500/40",
      label: locale === "en" ? "High" : "高",
      icon: "🔴",
    },
    medium: {
      bg: "bg-amber-500/15",
      text: "text-amber-300",
      border: "border-amber-500/40",
      label: locale === "en" ? "Med" : "中",
      icon: "🟡",
    },
    low: {
      bg: "bg-emerald-500/15",
      text: "text-emerald-300",
      border: "border-emerald-500/40",
      label: locale === "en" ? "Low" : "低",
      icon: "🟢",
    },
  };
  const { bg, text, label, icon, border } = config[level];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${bg} ${text} ${border}`}
    >
      {icon} {count} {label}
    </span>
  );
}

export function ReasoningPanel({ text }: { text?: string }) {
  const { t } = useTranslation();
  if (!text) return null;
  return (
    <AnimatedEntry delay={100}>
      <div className="mt-3 p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-yellow-500/5 border-l-4 border-amber-500/60 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center">
            <Lightbulb className="w-4 h-4 text-amber-300" />
          </div>
          <div>
            <div className="text-xs font-semibold text-amber-300 mb-1">{t("trace.aiReasoning")}</div>
            <p className="text-sm text-slate-200 leading-relaxed">{text}</p>
          </div>
        </div>
      </div>
    </AnimatedEntry>
  );
}
