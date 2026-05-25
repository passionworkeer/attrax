"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import AgentDecisionTree from "@/components/trace/AgentDecisionTree";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { unwrapApiData } from "@/lib/api-response";
import { useTranslation } from "@/lib/i18n";

export default function TracePage({ params }: { params: Promise<{ sessionId?: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { t, locale: i18nLocale } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [traceData, setTraceData] = useState<unknown>(null);
  const locale = i18nLocale;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsClient(true);
      setMounted(true);
      const querySessionId = new URLSearchParams(window.location.search).get("sessionId");
      const urlSessionId = resolvedParams?.sessionId;
      const storageSessionId = sessionStorage.getItem("lastSessionId");
      setSessionId(querySessionId || urlSessionId || storageSessionId || "");
    }, 0);

    return () => window.clearTimeout(timer);
  }, [resolvedParams?.sessionId]);

  useEffect(() => {
    if (!sessionId || !isClient) return;

    if (sessionId === "demo") return;

    const token = sessionStorage.getItem(`scan-token:${sessionId}`);
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

    // 从 API 获取真实 trace 数据
    fetch(`/api/trace/${sessionId}`, { cache: "no-store", headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(rawData => {
        const data = unwrapApiData<{ traceNodes?: unknown[] }>(rawData);
        if (data?.traceNodes) {
          setTraceData(data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // 同时获取完整扫描结果
    fetch(`/api/scan/${sessionId}`, { cache: "no-store", headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(rawPayload => {
        const payload = unwrapApiData<{ result?: unknown }>(rawPayload);
        if (payload?.result) {
          sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(payload.result));
        }
      })
      .catch(() => {});
  }, [sessionId, isClient]);

  const handleBack = () => {
    if (sessionId) {
      router.push(`/result/${sessionId}`);
    } else {
      router.push("/upload");
    }
  };

  if (!mounted || (sessionId && sessionId !== "demo" && loading)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50 to-indigo-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">{t("trace.loading")}</div>
      </div>
    );
  }

  // 从 traceData 提取统计信息
  const stats = traceData as { totalTime?: string; steps?: number; markets?: number; regulations?: number; score?: number; grade?: string } | null;
  const totalTime = stats?.totalTime ? parseFloat(stats.totalTime).toFixed(1) : "8.8";
  const steps = stats?.steps || 9;
  const markets = stats?.markets || 4;
  const score = stats?.score || 85;
  const grade = stats?.grade || "B";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/30 to-indigo-50/30">
      {/* Back Button */}
      <div className="max-w-6xl mx-auto px-6 pt-8">
        <button
          onClick={handleBack}
          className={cn(buttonVariants({ variant: "ghost", size: "default" }), "text-gray-600 hover:text-gray-900")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          {t("trace.backToResult")}
        </button>
      </div>

      {/* Hero Header */}
      <div className="bg-gradient-to-r from-blaze-red/5 via-rose-50 to-amber-50 border-b border-blaze-red/10">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-500 shadow-lg">
                  <span className="text-2xl font-bold text-white">AI</span>
                </div>
                <div className="min-w-0">
                  <h1 className="text-4xl font-black text-gray-900 max-sm:text-3xl">{t("trace.title")}</h1>
                  <p className="text-gray-500">{t("trace.subtitle")}</p>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid w-full grid-cols-3 gap-3 lg:w-auto lg:flex lg:items-center lg:gap-6">
              <div className="min-w-0 text-center px-3 py-3 bg-white rounded-2xl shadow-md border sm:px-6">
                <div className="text-2xl font-black text-blaze-red sm:text-3xl">{totalTime}s</div>
                <div className="text-xs text-gray-500">{t("trace.executionTime")}</div>
              </div>
              <div className="min-w-0 text-center px-3 py-3 bg-white rounded-2xl shadow-md border sm:px-6">
                <div className="text-2xl font-black text-purple-600 sm:text-3xl">{steps}</div>
                <div className="text-xs text-gray-500">{t("trace.executionSteps")}</div>
              </div>
              <div className="min-w-0 text-center px-3 py-3 bg-white rounded-2xl shadow-md border sm:px-6">
                <div className="text-2xl font-black text-green-600 sm:text-3xl">{markets}</div>
                <div className="text-xs text-gray-500">{t("trace.targetMarkets")}</div>
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
          traceNodes={traceData ? (traceData as { traceNodes?: unknown[] }).traceNodes : undefined}
        />
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 py-12 border-t border-gray-200">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t("trace.realtime")}</h3>
            <p className="text-sm text-gray-600">{t("trace.realtimeDesc")}</p>
          </div>
          <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t("trace.multiMarket")}</h3>
            <p className="text-sm text-gray-600">{t("trace.multiMarketDesc")}</p>
          </div>
          <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t("trace.actionableAdvice")}</h3>
            <p className="text-sm text-gray-600">{t("trace.actionableAdviceDesc")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
