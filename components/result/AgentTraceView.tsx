"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ComplianceReportResult } from "@/lib/types";

const MAX_VISIBLE_CHUNKS = 10;

const NODE_COLORS: Record<string, { bg: string; dot: string; label: string }> = {
  vision:          { bg: "bg-blue-500/10",   dot: "bg-blue-400",   label: "text-blue-400"   },
  query_planner:   { bg: "bg-violet-500/10", dot: "bg-violet-400", label: "text-violet-400"  },
  retriever:      { bg: "bg-cyan-500/10",   dot: "bg-cyan-400",    label: "text-cyan-400"    },
  synthesizer:    { bg: "bg-purple-500/10", dot: "bg-purple-400", label: "text-purple-400"  },
  generator:      { bg: "bg-emerald-500/10", dot: "bg-emerald-400", label: "text-emerald-400" },
  verifier:       { bg: "bg-amber-500/10",   dot: "bg-amber-400",   label: "text-amber-400"   },
};

const DEFAULT_NODE_COLOR = { bg: "bg-white/5", dot: "bg-white/30", label: "text-white/70" };

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
  if (!trace.length) return null;

  const rounds = groupRounds(trace);
  let stepIndex = 0;

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">执行链路</h3>

      <div className="mt-3 relative">
        {/* Vertical timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

        {rounds.map((round, ri) => (
          <div key={ri} className="mb-6">
            {/* Round label */}
            <div className="mb-2 flex items-center gap-2">
              <div className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-medium",
                ri === 0 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-400"
              )}>
                {ri === 0 ? "初检" : "复检"}
                <span className="opacity-60">Round {ri + 1}</span>
              </div>
            </div>

            <div className="ml-0 space-y-1">
              {round.steps.map((step) => {
                const idx = stepIndex++;
                const style = nodeStyle(step.node);
                const duration = typeof step.duration_ms === "number"
                  ? `${(step.duration_ms / 1000).toFixed(1)}s`
                  : null;

                return (
                  <div key={idx} className="relative flex items-start gap-3 py-1.5 pl-9">
                    {/* Timeline dot + connector */}
                    <div className={cn("absolute left-3 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center", style.dot)}>
                      <div className={cn("size-2.5 rounded-full border-2 border-blaze-dark", style.dot.replace("bg-", "bg-blaze-dark/"))} />
                    </div>
                    {/* Vertical connector lines */}
                    {idx < trace.length - 1 && (
                      <div className="absolute left-[15px] top-full h-4 w-px bg-border" />
                    )}

                    {/* Node card */}
                    <div className={cn("flex-1 rounded-xl border px-3 py-2 text-xs transition-colors", style.bg, "border-white/10")}>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Node badge */}
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", style.label, "border-current/20")}>
                          {step.node}
                        </span>

                        {/* Duration */}
                        {duration && (
                          <span className="text-[11px] text-white/40 tabular-nums">{duration}</span>
                        )}

                        {/* Warn badge */}
                        {step.status === "WARN" && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-400 border border-amber-500/30">
                            <svg viewBox="0 0 12 12" fill="currentColor" className="size-3">
                              <path d="M6 0a6 6 0 1 0 0 12A6 6 0 0 0 6 0zm-.75 3h1.5v4H5.25V3zm0 5.25h1.5v1.5H5.25V8.25z"/>
                            </svg>
                            WARN
                          </span>
                        )}

                        {step.status === "PASS" && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/30">
                            PASS
                          </span>
                        )}
                      </div>

                      {/* Docs retrieved */}
                      {step.docs_retrieved !== undefined && (
                        <div className="mt-1 text-[11px] text-white/50">
                          命中 {String(step.docs_retrieved)} 条法规
                        </div>
                      )}

                      {/* Score */}
                      {step.score !== undefined && (
                        <div className="mt-0.5 text-[11px] text-white/50">
                          置信度 {Number(step.score).toFixed(3)}
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
  const [expanded] = useState(false);

  if (!chunks.length) return null;
  const DISPLAY_CAP = 15;
  const visible = chunks.slice(0, DISPLAY_CAP);
  const overflow = chunks.length - DISPLAY_CAP;

  void expanded; // reserved for future expand/collapse feature

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        命中法规
        <span className="ml-2 font-mono text-white/40">({chunks.length})</span>
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {visible.map((c, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs transition-colors hover:border-blaze-red/40"
          >
            <span className="font-medium text-blaze-red">{c.region}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{c.docName}</span>
            {c.articleNo && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono text-muted-foreground">{c.articleNo}</span>
              </>
            )}
            <span className={cn(
              "ml-0.5 rounded px-1 py-0.5 text-[10px] tabular-nums",
              (c.score ?? 0) >= 0.9 ? "bg-emerald-500/20 text-emerald-400"
              : (c.score ?? 0) >= 0.7 ? "bg-blue-500/20 text-blue-400"
              : "bg-white/10 text-white/40"
            )}>
              {(c.score ?? 0).toFixed(2)}
            </span>
          </span>
        ))}
        {overflow > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-blaze-surface px-3 py-1 text-xs text-white/70">
            还有 {overflow} 项…
          </span>
        )}
      </div>
    </div>
  );
}