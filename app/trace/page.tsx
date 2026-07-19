"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AgentDecisionTree from "@/components/trace/AgentDecisionTree";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { unwrapApiData } from "@/lib/api-response";
import { useTranslation } from "@/lib/i18n";
import { useSessionId } from "@/lib/hooks/useSessionId";

interface TraceStats {
  totalTime?: string;
  steps?: number;
  markets?: number;
  score?: number;
  grade?: string;
  traceNodes?: unknown[];
}

/**
 * P0.3: replaced the setTimeout(0)+window.location.search+sessionStorage
 * triple hack with useSearchParams (via useSessionId). The page wraps the
 * inner component in <Suspense> because useSearchParams suspends during
 * streaming — required for Next.js App Router compliance.
 */
export default function TracePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="rounded-2xl border border-white/60 bg-white/85 px-6 py-4 text-muted-foreground shadow-sm backdrop-blur animate-pulse">
            Loading…
          </div>
        </div>
      }
    >
      <TracePageInner />
    </Suspense>
  );
}

function TracePageInner() {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const sessionId = useSessionId();

  const [settledSessionId, setSettledSessionId] = useState("");
  const [traceData, setTraceData] = useState<TraceStats | null>(null);
  // B-1: track API failure (vs. the previous silent fallback that rendered
  // Demo numbers as if the scan had succeeded). surfaced as a banner rather
  // than letting `hasRealTrace === false` quietly fall through.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    if (sessionId === "demo") {
      return;
    }

    const token = sessionStorage.getItem(`scan-token:${sessionId}`);
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

    let cancelled = false;

    // 从 API 获取真实 trace 数据
    fetch(`/api/trace/${sessionId}`, { cache: "no-store", headers: authHeaders })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((rawData) => {
        if (cancelled) return;
        const data = unwrapApiData<TraceStats>(rawData);
        if (data?.traceNodes) {
          setTraceData(data);
        } else {
          // 200 OK but envelope says success=false or empty payload — treat as failure.
          setLoadFailed(true);
        }
        setSettledSessionId(sessionId);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setSettledSessionId(sessionId);
      });

    // 同时获取完整扫描结果，供 result 页面缓存复用
    fetch(`/api/scan/${sessionId}`, { cache: "no-store", headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((rawPayload) => {
        if (cancelled) return;
        const payload = unwrapApiData<{ result?: unknown }>(rawPayload);
        if (payload?.result) {
          sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(payload.result));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleBack = () => {
    if (sessionId) {
      router.push(`/result/${sessionId}`);
    } else {
      router.push("/upload");
    }
  };

  // P0.5: distinguish real API stats from demo defaults so users aren't
  // misled by silent fallback numbers. hasRealTrace means we got a
  // non-empty payload from /api/trace.
  const hasRealTrace = Boolean(traceData);
  const totalTime = traceData?.totalTime
    ? parseFloat(traceData.totalTime).toFixed(1)
    : "8.8";
  const steps = traceData?.steps ?? 9;
  const markets = traceData?.markets ?? 4;
  const score = traceData?.score ?? 85;
  const grade = traceData?.grade ?? "B";

  if (sessionId && sessionId !== "demo" && settledSessionId !== sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="rounded-2xl border border-white/60 bg-white/85 px-6 py-4 text-muted-foreground shadow-sm backdrop-blur animate-pulse">
          {t("trace.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Back Button */}
      <div className="max-w-6xl mx-auto px-6 pt-8">
        <button
          onClick={handleBack}
          className={cn(buttonVariants({ variant: "ghost", size: "default" }), "text-muted-foreground hover:text-foreground")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          {t("trace.backToResult")}
        </button>
      </div>

      {/* B-1: explicit failure banner so the Demo badge isn't the only signal */}
      {loadFailed && !hasRealTrace && (
        <div role="alert" className="mx-auto mt-4 max-w-6xl px-6">
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-5 py-3 text-sm text-red-200">
            {locale === "zh"
              ? "Trace 数据加载失败，以下展示的是 Demo 默认值，不是本次扫描的真实数据。"
              : "Trace data failed to load. The values below are Demo defaults, not real scan data."}
          </div>
        </div>
      )}

      {/* Hero Header */}
      <div className="mx-6 mt-6 glass-panel rounded-3xl p-8 shadow-[0_30px_120px_rgba(0,0,0,0.5)]">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="label-caps text-xs text-blaze-red/80">
                Agent Trace
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blaze-red to-blaze-orange shadow-[0_0_20px_rgba(217,58,26,0.5)]">
                  <span className="text-2xl font-bold text-white">AI</span>
                </div>
                <div className="min-w-0 flex items-center gap-3">
                  <h1 className="text-3xl font-bold tracking-tight text-white max-sm:text-2xl">{t("trace.title")}</h1>
                  {/* P0.5: explicit demo badge when we're showing fallback
                      numbers rather than real telemetry. */}
                  {!hasRealTrace && (
                    <span className="inline-flex items-center rounded-full border border-blaze-cyan/40 bg-blaze-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-blaze-cyan">
                      Demo
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-1 text-sm text-slate-400">{t("trace.subtitle")}</p>
            </div>

            {/* Stats */}
            <div className="grid w-full grid-cols-3 gap-3 lg:w-auto lg:flex lg:items-center lg:gap-6">
              <div className="min-w-0 text-center rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 shadow-sm backdrop-blur sm:px-6">
                <div className="text-2xl font-black text-blaze-red sm:text-3xl">{totalTime}s</div>
                <div className="text-xs text-muted-foreground">{t("trace.executionTime")}</div>
              </div>
              <div className="min-w-0 text-center rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 shadow-sm backdrop-blur sm:px-6">
                <div className="text-2xl font-black text-blaze-red sm:text-3xl">{steps}</div>
                <div className="text-xs text-slate-400">{t("trace.executionSteps")}</div>
              </div>
              <div className="min-w-0 text-center rounded-2xl border border-white/10 bg-slate-900/50 px-3 py-3 shadow-sm backdrop-blur sm:px-6">
                <div className="text-2xl font-black text-blaze-red sm:text-3xl">{markets}</div>
                <div className="text-xs text-slate-400">{t("trace.targetMarkets")}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        <AgentDecisionTree
          locale={locale}
          autoPlay={false}
          score={score}
          grade={grade}
          traceNodes={traceData ? traceData.traceNodes : undefined}
        />
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="mb-2 text-lg font-semibold text-white">{t("trace.realtime")}</h3>
            <p className="text-sm text-slate-400">{t("trace.realtimeDesc")}</p>
          </div>
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="mb-2 text-lg font-semibold text-white">{t("trace.multiMarket")}</h3>
            <p className="text-sm text-slate-400">{t("trace.multiMarketDesc")}</p>
          </div>
          <div className="glass-panel rounded-2xl p-6">
            <h3 className="mb-2 text-lg font-semibold text-white">{t("trace.actionableAdvice")}</h3>
            <p className="text-sm text-slate-400">{t("trace.actionableAdviceDesc")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
