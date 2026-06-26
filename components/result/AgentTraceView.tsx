"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { englishText } from "@/lib/report-localization";
import type { ComplianceReportResult } from "@/lib/types";

const NODE_COLORS: Record<string, { bg: string; dot: string; label: string; border: string }> = {
  vision: { bg: "bg-blue-500/10", dot: "bg-blue-400", label: "text-blue-300", border: "border-blue-500/30" },
  query_planner: { bg: "bg-violet-500/10", dot: "bg-violet-400", label: "text-violet-300", border: "border-violet-500/30" },
  retriever: { bg: "bg-cyan-500/10", dot: "bg-cyan-400", label: "text-cyan-300", border: "border-cyan-500/30" },
  synthesizer: { bg: "bg-purple-500/10", dot: "bg-purple-400", label: "text-purple-300", border: "border-purple-500/30" },
  generator: { bg: "bg-emerald-500/10", dot: "bg-emerald-400", label: "text-emerald-300", border: "border-emerald-500/30" },
  verifier: { bg: "bg-amber-500/10", dot: "bg-amber-400", label: "text-amber-300", border: "border-amber-500/30" },
};

const DEFAULT_NODE_COLOR = {
  bg: "bg-slate-500/10",
  dot: "bg-slate-400",
  label: "text-slate-300",
  border: "border-slate-500/30",
};

function nodeStyle(node: string) {
  return NODE_COLORS[node.toLowerCase()] ?? DEFAULT_NODE_COLOR;
}

type TraceEntry = { node: string; [key: string]: unknown };

function groupRounds(trace: TraceEntry[]): Array<{ round: number; steps: TraceEntry[] }> {
  const rounds: Array<{ round: number; steps: TraceEntry[] }> = [];
  let currentRound = 1;

  for (const step of trace) {
    if (step.node === "verifier" && step.status === "WARN") {
      rounds.push({ round: currentRound, steps: [] });
      currentRound++;
    }
    if (rounds.length === 0) rounds.push({ round: 1, steps: [] });
    rounds[rounds.length - 1].steps.push(step);
  }

  return rounds;
}

export function AgentTraceTimeline({ trace }: { trace: ComplianceReportResult["agentTrace"] }) {
  const { t } = useTranslation();
  if (!trace.length) return null;

  const rounds = groupRounds(trace);
  let stepIndex = 0;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
        {t("trace.executionSteps")}
      </h3>

      <div className="relative mt-3">
        <div className="absolute bottom-0 left-4 top-0 w-px bg-white/10" />

        {rounds.map((round, ri) => (
          <div key={ri} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-medium",
                  ri === 0
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                )}
              >
                {ri === 0 ? t("trace.firstInspection") : t("trace.reInspection")}
                <span className="opacity-60">Round {ri + 1}</span>
              </div>
            </div>

            <div className="space-y-1">
              {round.steps.map((step) => {
                const idx = stepIndex++;
                const style = nodeStyle(step.node);
                const duration =
                  typeof step.duration_ms === "number"
                    ? `${(step.duration_ms / 1000).toFixed(1)}s`
                    : null;

                return (
                  <div key={idx} className="relative flex items-start gap-3 py-1.5 pl-9">
                    <div className="absolute left-3 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center">
                      <div
                        className={cn(
                          "size-2.5 rounded-full border-2 border-slate-950 shadow-sm",
                          style.dot
                        )}
                      />
                    </div>

                    {idx < trace.length - 1 && (
                      <div className="absolute left-[15px] top-full h-4 w-px bg-white/10" />
                    )}

                    <div
                      className={cn(
                        "flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs transition-colors",
                        style.bg
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold",
                            style.label
                          )}
                        >
                          {step.node}
                        </span>

                        {duration && (
                          <span className="text-[11px] tabular-nums text-slate-400">
                            {duration}
                          </span>
                        )}

                        {step.status === "WARN" && (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                            <svg viewBox="0 0 12 12" fill="currentColor" className="size-3">
                              <path d="M6 0a6 6 0 1 0 0 12A6 6 0 0 0 6 0zm-.75 3h1.5v4H5.25V3zm0 5.25h1.5v1.5H5.25V8.25z" />
                            </svg>
                            WARN
                          </span>
                        )}

                        {step.status === "PASS" && (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                            PASS
                          </span>
                        )}
                      </div>

                      {step.docs_retrieved !== undefined && (
                        <div className="mt-1 text-[11px] text-slate-400">
                          {t("trace.regulationHit", { count: Number(step.docs_retrieved ?? 0) })}
                        </div>
                      )}

                      {step.score !== undefined && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {t("trace.confidence", { score: Number(step.score).toFixed(3) })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RetrievedChunks({ chunks }: { chunks: ComplianceReportResult["retrievedChunks"] }) {
  const { t, locale } = useTranslation();
  const [expanded] = useState(false);

  if (!chunks.length) return null;
  const DISPLAY_CAP = 15;
  const visible = chunks.slice(0, DISPLAY_CAP);
  const overflow = chunks.length - DISPLAY_CAP;

  void expanded;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
        {t("trace.regulationsHit")}
        <span className="ml-2 font-mono text-slate-500">({chunks.length})</span>
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {visible.map((c, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/40 px-3 py-1 text-xs transition-colors hover:border-blaze-red/40"
          >
            <span className="font-medium text-blaze-red">{c.region}</span>
            <span className="text-slate-500">/</span>
            <span className="text-slate-300">{locale === "en" ? englishText(c.docNameEn, englishText(c.docName, c.regId || "Regulation document")) : c.docName}</span>
            {c.articleNo && (
              <>
                <span className="text-slate-500">/</span>
                <span className="font-mono text-slate-400">{c.articleNo}</span>
              </>
            )}
            <span
              className={cn(
                "ml-0.5 rounded px-1 py-0.5 text-[10px] tabular-nums",
                (c.score ?? 0) >= 0.9
                  ? "bg-emerald-500/20 text-emerald-300"
                  : (c.score ?? 0) >= 0.7
                    ? "bg-blue-500/20 text-blue-300"
                    : "bg-slate-700/50 text-slate-400"
              )}
            >
              {(c.score ?? 0).toFixed(2)}
            </span>
          </span>
        ))}
        {overflow > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-800/60 px-3 py-1 text-xs text-slate-400">
            {t("trace.remaining", { count: overflow })}
          </span>
        )}
      </div>
    </div>
  );
}
