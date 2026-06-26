"use client";

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { unwrapApiData } from "@/lib/api-response";
import { useTranslation } from "@/lib/i18n";
import { mockComplianceReportResult, mockProfitReport, mockProfitReports } from "@/lib/mock/scan-result";
import { localizeComplianceReportResult, localizeProfitReportResult } from "@/lib/report-localization";
import { ProfitReportView } from "@/components/result/ProfitReportView";
import { SourceNotice } from "@/components/result/SourceNotice";
import { ComplianceReportView } from "@/components/result/ComplianceReportView";
import { DecisionReportPanel, RoadmapReportPanel } from "@/components/result/ReportPanels";
import { LegacyResultView } from "@/components/result/LegacyResultView";
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


function isProfitReportArray(value: unknown): value is ProfitReportResult[] {
  return Array.isArray(value) && value.every(isProfitReport);
}


export default function ResultPage() {
  const { t, locale } = useTranslation();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const isDemoSession = sessionId === "demo";
  const [result, setResult] = useState<ScanResult | ComplianceReportResult | null>(
    isDemoSession ? (mockComplianceReportResult as unknown as ScanResult | ComplianceReportResult | null) : null
  );
  const [profitReport, setProfitReport] = useState<ProfitReportResult | null>(
    isDemoSession ? mockProfitReport : null
  );
  const [profitReports, setProfitReports] = useState<ProfitReportResult[]>(
    isDemoSession ? mockProfitReports : []
  );
  const [selectedProfitIndex, setSelectedProfitIndex] = useState(0);
  const [message, setMessage] = useState("");
  const visibleProfitReport = useMemo(
    () => profitReports[selectedProfitIndex] ?? profitReport,
    [profitReport, profitReports, selectedProfitIndex]
  );

  const applyProfitReports = useCallback((payload: ScanStatus) => {
    if (isProfitReportArray(payload.profitReports) && payload.profitReports.length > 0) {
      setProfitReports(payload.profitReports);
      setProfitReport(payload.profitReport && isProfitReport(payload.profitReport) ? payload.profitReport : payload.profitReports[0]);
      setSelectedProfitIndex(0);
      return;
    }

    if (payload.profitReport && isProfitReport(payload.profitReport)) {
      setProfitReport(payload.profitReport);
      setProfitReports([payload.profitReport]);
      setSelectedProfitIndex(0);
    }
  }, []);

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
            if (payload) {
              applyProfitReports(payload);
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
          applyProfitReports(payload);
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
  }, [applyProfitReports, isDemoSession, sessionId, t]);

  // Demo is dev-only — block it in production to mirror the
  // /api/scan/[sessionId] route guard. Renders the branded not-found page.
  if (isDemoSession && process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-5rem)] w-full max-w-7xl px-4 sm:px-6 py-10">
      <section className="glass-panel rounded-3xl p-6 sm:p-8 shadow-[0_30px_100px_rgba(0,0,0,0.5)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label-caps text-xs text-blaze-red/80">Result</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {isDemoSession ? t("result.demoResult") : `${t("result.scanResult")} · ${sessionId}`}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {isDemoSession ? t("result.demoLoaded") : message}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href={`/trace?sessionId=${sessionId}`}
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "shrink-0 border-blaze-red/30 text-blaze-red hover:bg-blaze-red/10 hover:border-blaze-red")}
            >
              {t("result.aiDecision")}
            </Link>
            <Link
              href={`/roadmap?sessionId=${sessionId}`}
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "shrink-0 border-blaze-cyan/30 text-blaze-cyan hover:bg-blaze-cyan/10 hover:border-blaze-cyan")}
            >
              {t("result.complianceRoadmap")}
            </Link>
            <Link
              href="/upload"
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "shrink-0 border-white/15 text-slate-200 hover:bg-white/5 hover:border-white/30")}
            >
              {t("result.reupload")}
            </Link>
          </div>
        </div>

        {result ? <SourceNotice source={result.source} /> : null}

        {result && isComplianceReport(result) ? (
          <div className="mt-8">
            {visibleProfitReport ? (
              <Tabs defaultValue="compliance">
                <TabsList className="w-full max-w-full justify-start overflow-x-auto sm:w-fit">
                  <TabsTrigger value="compliance">{t("result.complianceReport")}</TabsTrigger>
                  <TabsTrigger value="profit">{t("result.costProfitReport")}</TabsTrigger>
                  <TabsTrigger value="decision">{t("result.aiDecisionReport")}</TabsTrigger>
                  <TabsTrigger value="roadmap">{t("result.complianceRoadmap")}</TabsTrigger>
                </TabsList>
                <TabsContent value="compliance">
                  <ComplianceReportView result={result} />
                </TabsContent>
                <TabsContent value="profit">
                  {profitReports.length > 1 && (
                    <div className="mb-4 flex flex-wrap items-center gap-2 glass-panel rounded-2xl p-3">
                      <span className="mr-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
                        {t("result.scenarios")}
                      </span>
                      {profitReports.map((report, index) => {
                        const scenarioReport = localizeProfitReportResult(report, locale);
                        return (
                        <button
                          key={`${report.market}-${report.premiumPct}-${index}`}
                          onClick={() => setSelectedProfitIndex(index)}
                          className={cn(
                            "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors data-mono",
                            selectedProfitIndex === index
                              ? "bg-blaze-red border-blaze-red text-white shadow-[0_0_12px_rgba(217,58,26,0.4)]"
                              : "bg-slate-800/60 border-white/10 text-slate-300 hover:bg-slate-700/60 hover:border-white/20 hover:text-white"
                          )}
                        >
                          {index + 1}. {scenarioReport.premiumPct} / {scenarioReport.breakevenUnits}
                        </button>
                        );
                      })}
                    </div>
                  )}
                  <ProfitReportView result={visibleProfitReport} />
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
                <TabsList className="w-full max-w-full justify-start overflow-x-auto sm:w-fit">
                  <TabsTrigger value="compliance">{t("result.complianceReport")}</TabsTrigger>
                  <TabsTrigger value="decision">{t("result.aiDecisionReport")}</TabsTrigger>
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
