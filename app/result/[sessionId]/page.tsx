"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { mockScanResult, mockProfitReport, mockComplianceReportResult } from "@/lib/mock/scan-result";
import { downloadReportAsPdf, downloadReportAsDocx } from "@/lib/report-export";
import { ProfitReportView } from "@/components/result/ProfitReportView";
import { AgentTraceTimeline, RetrievedChunks } from "@/components/result/AgentTraceView";
import type { ScanResult, ScanStatus, ComplianceReportResult, ProfitReportResult } from "@/lib/types";

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_META = {
  PASS: { label: "通过", color: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  WARN: { label: "警告", color: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  REJECTED: { label: "拒绝", color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/30" },
  UNKNOWN: { label: "未知", color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30" },
} as const;

const GRADE_COLORS = {
  A: "text-emerald-500",
  B: "text-blue-500",
  C: "text-amber-500",
  D: "text-red-500",
} as const;

const MARKET_LABELS: Record<string, string> = {
  EU: "欧盟", US: "美国", UK: "英国",
};

// ── Compliance Report View ───────────────────────────────────────────────────
function ComplianceReportView({ result }: { result: ComplianceReportResult }) {
  const meta = STATUS_META[result.complianceStatus] ?? STATUS_META.UNKNOWN;
  const gradeColor = GRADE_COLORS[result.scoreGrade] ?? "text-gray-400";
  const markets = result.targetMarkets.map((m) => MARKET_LABELS[m] ?? m).join(" · ");

  return (
    <div className="space-y-6">
      {/* Score + Status Header */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col items-center">
          <span className={cn("text-4xl font-bold tabular-nums sm:text-5xl", gradeColor)}>
            {result.complianceScore}
          </span>
          <span className="text-xs text-muted-foreground">综合评分</span>
        </div>
        <div className="flex flex-col gap-2">
          <div className={cn("inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium", meta.color, meta.bg, meta.border)}>
            <span>{meta.label}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>等级：<span className={cn("font-semibold", gradeColor)}>{result.scoreGrade}</span></span>
            <span>·</span>
            <span>品类：{result.productCategory}</span>
            <span>·</span>
            <span>市场：{markets}</span>
            <span>·</span>
            <span>检索轮次：{result.loopCount}</span>
          </div>
        </div>
      </div>

      {/* Agent Trace */}
      {result.agentTrace.length > 0 && (
        <AgentTraceTimeline trace={result.agentTrace} />
      )}

      {/* Retrieved Chunks */}
      <RetrievedChunks chunks={result.retrievedChunks} />

      {/* Full Report */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">合规报告</h3>
            {result.modelInfo && (
              <span className="text-xs text-muted-foreground">
                {result.modelInfo.ragProvider} · {(result.modelInfo.latencyMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => downloadReportAsPdf(result)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-red-400/50 hover:text-red-500"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                <path d="M8 0a.75.75 0 0 1 .75.75v6.5h5.5a.75.75 0 0 1 0 1.5H8.75A.75.75 0 0 1 8 8.75v6.5A.75.75 0 0 1 7.25 16h-4a.75.75 0 0 1-.75-.75v-6.5H1.75a.75.75 0 0 1 0-1.5H7.25V.75A.75.75 0 0 1 8 0Z"/>
              </svg>
              PDF
            </button>
            <button
              onClick={() => downloadReportAsDocx(result)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-blue-400/50 hover:text-blue-500"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                <path d="M8 0a.75.75 0 0 1 .75.75v6.5h5.5a.75.75 0 0 1 0 1.5H8.75A.75.75 0 0 1 8 8.75v6.5A.75.75 0 0 1 7.25 16h-4a.75.75 0 0 1-.75-.75v-6.5H1.75a.75.75 0 0 1 0-1.5H7.25V.75A.75.75 0 0 1 8 0Z"/>
              </svg>
              Word
            </button>
          </div>
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

// ── Legacy Result View ─────────────────────────────────────────────────────────
function LegacyResultView({ result }: { result: ScanResult }) {
  return (
    <>
      <div className="overflow-hidden rounded-3xl border border-border bg-blaze-dark/95">
        <pre className="max-h-[70vh] overflow-auto p-6 text-xs leading-6 text-white/90 sm:text-sm">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>

      {result.documents.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">已上传文档</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            共 {result.documents.length} 份文档
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
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const isDemoSession = sessionId === "demo";
  const [result, setResult] = useState<ScanResult | ComplianceReportResult | null>(
    isDemoSession ? (mockComplianceReportResult as unknown as ScanResult | ComplianceReportResult | null) : null
  );
  const [profitReport, setProfitReport] = useState<ProfitReportResult | null>(
    isDemoSession ? mockProfitReport : null
  );
  const [message, setMessage] = useState("正在加载扫描结果…");

  useEffect(() => {
    if (!sessionId || isDemoSession) return;

    const cached = sessionStorage.getItem(`scan:${sessionId}`);
    if (cached) {
      try {
        const cachedResult = JSON.parse(cached);
        startTransition(() => {
          setResult(cachedResult);
          setMessage("已从会话缓存恢复结果。");
        });
        fetch(`/api/scan/${sessionId}`, { cache: "no-store" })
          .then((r) => r.ok ? r.json() : null)
          .then((payload) => {
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
      const response = await fetch(`/api/scan/${sessionId}`, { cache: "no-store" });
      if (!response.ok) {
        startTransition(() => setMessage("未找到对应扫描结果。"));
        return;
      }
      const payload: ScanStatus = await response.json();
      if (payload.status === "ready" && payload.result) {
        startTransition(() => {
          setResult(payload.result ?? null);
          if (payload.profitReport && isProfitReport(payload.profitReport)) {
            setProfitReport(payload.profitReport);
          }
          setMessage("结果已从接口载入。");
        });
        return;
      }
      if (payload.status === "failed") {
        startTransition(() => setMessage(payload.error ?? "扫描失败。"));
        return;
      }
      startTransition(() => setMessage("扫描仍在处理中，请稍后刷新或返回加载页。"));
    }

    loadResult();
  }, [isDemoSession, sessionId]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
      <section className="rounded-4xl border border-white/60 bg-white/85 p-8 shadow-[0_30px_100px_rgba(26,26,46,0.12)] backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-blaze-red/80">Result</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {isDemoSession ? "Demo 扫描结果" : `扫描结果 · ${sessionId}`}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {isDemoSession ? "已载入 Demo 数据。" : message}
            </p>
          </div>
          <Link
            href="/upload"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "shrink-0")}
          >
            重新上传
          </Link>
        </div>

        {result && isComplianceReport(result) ? (
          <div className="mt-8">
            {profitReport ? (
              <Tabs defaultValue="compliance">
                <TabsList>
                  <TabsTrigger value="compliance">合规分析报告</TabsTrigger>
                  <TabsTrigger value="profit">成本利润报告</TabsTrigger>
                </TabsList>
                <TabsContent value="compliance">
                  <ComplianceReportView result={result} />
                </TabsContent>
                <TabsContent value="profit">
                  <ProfitReportView result={profitReport} />
                </TabsContent>
              </Tabs>
            ) : (
              <ComplianceReportView result={result} />
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