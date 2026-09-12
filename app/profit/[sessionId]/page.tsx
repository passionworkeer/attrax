"use client";

import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import {
  Gavel,
  ShieldAlert,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { buttonVariants } from "@/components/ui/button";
import { SectionEyebrow } from "@/components/blaze-hawks/ui";
import {
  CompliPilotFlowBackdrop,
  CompliPilotFlowFooter,
  CompliPilotFlowHeader,
} from "@/components/complipilot/flow-shell";
import { mockScanResult } from "@/lib/mock/blaze-scan-result";
import { synthesizeFinancialSummaryIfMissing } from "@/lib/pipeline/profit-report";
import type { ScanResult, ScanStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProfitExportPanel } from "./profit-export-panel";
import brightFlow from "@/components/complipilot/bright-flow.module.css";
import profitStyles from "../profit.module.css";

function readStoredAccessToken(sessionId: string): string | null {
  try {
    const value = sessionStorage.getItem(`scan-token:${sessionId}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export default function ProfitPage() {
  const { locale } = useBlazeLocale();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const isDemoSession = sessionId === "demo";
  const [profitMode, setProfitMode] = useState<"bare" | "compliant">("compliant");
  const [result, setResult] = useState<ScanResult | null>(
    isDemoSession ? mockScanResult : null
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || isDemoSession) {
      return;
    }

    const cached = sessionStorage.getItem(`scan:${sessionId}`);
    if (cached) {
      try {
        const cachedResult = JSON.parse(cached) as ScanResult;
        startTransition(() => {
          setResult(cachedResult);
        });
        return;
      } catch {
        sessionStorage.removeItem(`scan:${sessionId}`);
      }
    }

    let cancelled = false;

    async function loadResult() {
      try {
        while (!cancelled) {
          const accessToken = readStoredAccessToken(sessionId);
          const headers: Record<string, string> = {};
          if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
          }
          const response = await fetch(`/api/scan/${sessionId}`, {
            cache: "no-store",
            headers,
          });
          if (!response.ok) {
            throw new Error(
              locale === "zh" ? "扫描会话不存在或已过期。" : "The scan session is missing or expired."
            );
          }

          const payload: ScanStatus = await response.json();
          if (payload.status === "ready" && payload.result) {
            const resultPayload = payload.result;
            if (!Array.isArray(resultPayload.images)) {
              throw new Error(
                locale === "zh"
                  ? "后端返回了不兼容的利润结果格式。"
                  : "The backend returned an incompatible profit result shape."
              );
            }
            sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(resultPayload));
            startTransition(() => {
              setLoadError(null);
              setResult(resultPayload as ScanResult);
            });
            return;
          }

          if (payload.status === "failed") {
            throw new Error(
              payload.error ??
                (locale === "zh" ? "扫描失败，暂时无法生成成本分析。" : "The scan failed, so cost analysis is unavailable.")
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      } catch (error) {
        if (!cancelled) {
          startTransition(() => {
            setLoadError(
              error instanceof Error
                ? error.message
                : locale === "zh"
                  ? "成本分析加载失败，请重新检测。"
                  : "Cost analysis failed to load. Please scan again."
            );
          });
        }
      }
    }

    loadResult();

    return () => {
      cancelled = true;
    };
  }, [isDemoSession, locale, sessionId]);

  if (!result) {
    return (
      <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
        <CompliPilotFlowBackdrop tone="bright" />
        <div className="relative z-10">
          <CompliPilotFlowHeader
            backHref="/upload"
            backLabel={locale === "zh" ? "返回上传页" : "Back to upload"}
            flowTitle={locale === "zh" ? "成本影响分析" : "Cost Impact Analysis"}
            flowSubtitle={locale === "zh" ? "整改预算 · 风险暴露 · 上架决策" : "Budget · exposure · launch decision"}
            primaryHref="/upload"
            primaryLabel={locale === "zh" ? "重新检测" : "Scan again"}
            statusLabel={
              loadError
                ? locale === "zh" ? "无法加载" : "Unavailable"
                : locale === "zh" ? "加载中" : "Loading"
            }
            tone="bright"
          />
          <section className="mx-auto w-full max-w-5xl px-6 pt-8">
            <div className="blaze-panel p-8">
              <SectionEyebrow>Cost Impact</SectionEyebrow>
              <h1 className="mt-3 text-3xl font-semibold text-white">
                {loadError
                  ? locale === "zh" ? "暂时无法打开成本分析" : "Cost analysis is unavailable"
                  : locale === "zh" ? "正在读取扫描结果" : "Loading scan result"}
              </h1>
              <p className="mt-4 text-sm leading-7 text-white/60">
                {loadError ??
                  (locale === "zh"
                    ? "扫描完成后会自动展示整改成本、利润变化和风险暴露。"
                    : "Remediation cost, margin changes, and exposure will appear when the scan completes.")}
              </p>
              <Link
                href="/upload"
                className={cn(buttonVariants({ size: "lg" }), "mt-6 rounded-full")}
              >
                {locale === "zh" ? "返回重新检测" : "Return and scan again"}
              </Link>
            </div>
          </section>
          <CompliPilotFlowFooter tone="bright" />
        </div>
      </main>
    );
  }

  const displayName =
    locale === "en" ? result.productNameEn ?? result.productName : result.productName;

  const financeValidation = result.reportPackage?.auditMetadata?.finance;
  const financeUnavailable =
    financeValidation?.validationStatus === "invalid" ||
    financeValidation?.validation_status === "invalid";
  const financialSummary = synthesizeFinancialSummaryIfMissing(result, locale);
  if (financeUnavailable || !financialSummary) {
    const profitReport = result.reportPackage?.profitReport;
    const reportText =
      (locale === "en" ? profitReport?.markdownEn : undefined) ??
      profitReport?.markdown ??
      (locale === "zh"
        ? "后端未返回结构化成本字段，无法可靠计算单件利润和整改预算。"
        : "The backend did not return structured cost fields, so unit margin and remediation budget cannot be calculated reliably.");
    return (
      <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
        <CompliPilotFlowBackdrop tone="bright" />
        <div className="relative z-10">
          <CompliPilotFlowHeader
            backHref={`/result/${sessionId}`}
            backLabel={locale === "zh" ? "返回结果页" : "Back to result"}
            flowTitle={locale === "zh" ? "成本影响分析" : "Cost Impact Analysis"}
            flowSubtitle={locale === "zh" ? "真实扫描结果 · 财务数据独立校验" : "Real scan result · finance data validated separately"}
            primaryHref={`/result/${sessionId}`}
            primaryLabel={locale === "zh" ? "查看合规结果" : "View compliance result"}
            statusLabel={locale === "zh" ? "利润数据不可用" : "Profit data unavailable"}
            tone="bright"
          />
          <section className="mx-auto w-full max-w-5xl px-6 pt-8">
            <div className="blaze-panel p-8">
              <SectionEyebrow>{locale === "zh" ? "合规报告仍可用" : "Compliance report remains available"}</SectionEyebrow>
              <h1 className="mt-3 text-3xl font-semibold text-white">
                {locale === "zh" ? "利润数据不可用，未使用演示数据替代" : "Profit data is unavailable; no demo figures were substituted"}
              </h1>
              <p className="mt-4 text-sm leading-7 text-white/64">
                {financeUnavailable
                  ? locale === "zh"
                    ? "本次扫描的合规报告已保留；仅利润子报告的结构化字段校验失败，因此成本、售价和预算看板不会展示。"
                    : "The compliance report from this scan is still available. Only the profit sub-report failed structured-field validation, so cost, price, and budget figures are hidden."
                  : locale === "zh"
                    ? "当前报告来自本次扫描，但后端尚未提供成本明细、售价、销量和风险金额等结构化字段。"
                    : "This report belongs to the current scan, but the backend has not provided structured costs, price, volume, or exposure values."}
              </p>
              <pre className="mt-6 whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-5 text-sm leading-7 text-white/72">
                {reportText}
              </pre>
            </div>
          </section>
          <CompliPilotFlowFooter sessionId={sessionId} tone="bright" />
        </div>
      </main>
    );
  }

  const activeCostBreakdown = profitMode === "bare" && financialSummary.bareCostBreakdown
    ? financialSummary.bareCostBreakdown
    : financialSummary.costBreakdown;
  const costRows = activeCostBreakdown.map((row) => ({
    label: locale === "en" ? row.labelEn ?? row.label : row.label,
    amount: row.amount,
    detail: locale === "en" ? row.detailEn ?? row.detail : row.detail,
  }));
  const riskExposureItems =
    locale === "en"
      ? financialSummary.riskExposureItemsEn ??
        financialSummary.riskExposureItems
      : financialSummary.riskExposureItems;

  const riskHeadings =
    locale === "zh"
      ? {
          title: "合规整改成本与风险影响",
          subtitle: `${result.targetMarkets.join("+")} 市场 · ${displayName} · ${financialSummary.targetVolumeLabel}`,
          riskTitle: "不合规最高风险",
          exportProfit: "导出成本影响表",
          exportCompliance: "生成完整合规报告",
          back: "返回结果页",
          monthly: "合规后预估月度净收益",
          heroic: "未整改预估单件收益",
          trueNet: "合规后单件净收益",
          complianceCost: "单产品合规总成本",
          breakdown: "全链路成本明细",
          visual: "成本影响看板",
          tableHeaders: ["项目", "金额", "说明"],
          modeTitle: "整改前后对比",
          unlock: "返回合规报告",
        }
      : {
          title: "Compliance Cost and Risk Impact",
          subtitle: `${result.targetMarkets.join("+")} market · ${displayName} · ${financialSummary.targetVolumeLabelEn ?? financialSummary.targetVolumeLabel}`,
          riskTitle: "Maximum Risk Exposure",
          exportProfit: "Export Cost Impact Sheet",
          exportCompliance: "Generate Full Compliance Report",
          back: "Back to result page",
          monthly: "Estimated Monthly Net",
          heroic: "Estimated Net Before Remediation",
          trueNet: "Net After Compliance",
          complianceCost: "Compliance Cost",
          breakdown: "Full-Chain Cost Breakdown",
          visual: "Cost Impact Board",
          tableHeaders: ["Item", "Amount", "Detail"],
          modeTitle: "Before / After Remediation",
          unlock: "Back to Compliance Report",
        };
  const modeCards =
    locale === "zh"
      ? [
          {
            id: "bare" as const,
            title: "裸奔出海",
            value: financialSummary.estimatedHeroicProfit,
            body: "不补认证、不补标签，短期利润看起来更高，但风险会直接吞掉整批货。",
          },
          {
            id: "compliant" as const,
            title: "合规后出海",
            value: financialSummary.trueNetProfit,
            body: "先承担合规成本，把认证、说明书和平台审核链路闭环后再进入目标市场。",
          },
        ]
      : [
          {
            id: "bare" as const,
            title: "Launch Bare",
            value: financialSummary.estimatedHeroicProfit,
            body: "Skip marks and labels for short-term margin, but the exposure can swallow the whole batch.",
          },
          {
            id: "compliant" as const,
            title: "Launch Compliant",
            value: financialSummary.trueNetProfit,
            body: "Absorb compliance cost first, close marks, manuals, and marketplace review before launch.",
          },
        ];
  const activeMode = modeCards.find((mode) => mode.id === profitMode) ?? modeCards[1];
  // Caveat: the bare "heroic" figure is the naive ASP − total; we never subtract
  // expected penalty. Render that explicitly so the reader doesn't take "barebone
  // net > compliant net" at face value. See lib/pipeline/profit-report.ts for
  // the source formula (no expected-loss adjustment on either side).
  const bareRiskCaveat =
    profitMode === "bare"
      ? locale === "zh"
        ? "↑ 此数未扣除期望风险敞口（潜在罚款 / 扣押 / 召回）"
        : "↑ Does not deduct expected risk exposure (potential fines, seizure, recall)"
      : null;
  const metrics =
    profitMode === "bare"
      ? [
          {
            label: riskHeadings.heroic,
            value: financialSummary.estimatedHeroicProfit,
            tone: "text-[#10B981]",
            unit: locale === "zh" ? "/单个产品" : "/unit",
          },
          {
            label: locale === "zh" ? "表面合规成本" : "Visible compliance cost",
            value: "¥0",
            tone: "text-white",
            unit: locale === "zh" ? "/单个产品" : "/unit",
          },
          {
            label: locale === "zh" ? "最高风险暴露" : "Maximum exposure",
            value: locale === "zh" ? "¥180万" : "¥1.8M",
            tone: "text-[var(--blaze-orange)]",
            unit: locale === "zh" ? "单日上限" : "daily max",
          },
          {
            label: locale === "zh" ? "AI 决策" : "AI decision",
            value: locale === "zh" ? "先整改" : "Fix first",
            tone: "text-[#f97360]",
            unit: "",
          },
        ]
      : [
          {
            label: riskHeadings.heroic,
            value: financialSummary.estimatedHeroicProfit,
            tone: "text-[#10B981]",
            unit: locale === "zh" ? "/单个产品" : "/unit",
          },
          {
            label: riskHeadings.trueNet,
            value: financialSummary.trueNetProfit,
            tone: "text-white",
            unit: locale === "zh" ? "/单个产品" : "/unit",
          },
          {
            label: riskHeadings.complianceCost,
            value: financialSummary.complianceCost,
            tone: "text-[var(--blaze-orange)]",
            unit: locale === "zh" ? "/单个产品" : "/unit",
          },
          {
            label: riskHeadings.monthly,
            value: financialSummary.monthlyNetProfit,
            tone: "text-[#4CC9F0]",
            unit: locale === "zh" ? "/月" : "/month",
          },
        ];
  const selectedProfit = profitMode === "bare"
    ? parseFloat(financialSummary.estimatedHeroicProfit.replace(/[^\d.]/g, "")) || 0
    : parseFloat(financialSummary.trueNetProfit.replace(/[^\d.]/g, "")) || 0;
  const listedCost = costRows.reduce((sum, row) => sum + (parseFloat(row.amount.replace(/[^\d.]/g, "")) || 0), 0);
  const retailBaseline = profitMode === "bare"
    ? financialSummary.bareRetailBaseline ?? listedCost + selectedProfit
    : financialSummary.retailBaseline ?? listedCost + selectedProfit;
  const chainPalette = ["#3fb5c8", "#54c9d6", "#71d9db", "#8ae6df", "#63bfd5", "#87b7cf"];
  let runningBalance = retailBaseline;
  const chainCostRows = costRows.map((row, rowIndex) => {
    const sourceAmount = parseFloat(row.amount.replace(/[^\d.]/g, "")) || 0;
    const amount = sourceAmount;
    runningBalance -= amount;
    return {
      ...row,
      amount,
      displayAmount: amount === sourceAmount ? row.amount : "¥0.00",
      share: Math.max((amount / retailBaseline) * 100, 0),
      remaining: Math.max(runningBalance, 0),
      color: chainPalette[rowIndex % chainPalette.length],
    };
  });
  const totalChainCost = chainCostRows.reduce((sum, row) => sum + row.amount, 0);
  const finalProfitNumber = retailBaseline - totalChainCost;
  const currencySymbol = financialSummary.trueNetProfit.match(/[¥$€£]/)?.[0] ?? "¥";
  const retailBaselineDisplay = `${currencySymbol}${retailBaseline.toFixed(2)}`;
  const finalProfitValue = `${currencySymbol}${finalProfitNumber.toFixed(2)}`;
  const finalProfitShare = (finalProfitNumber / retailBaseline) * 100;
  const breakEvenBuffer = Math.max(finalProfitNumber - 8, 0);
  const dominantCost = chainCostRows.reduce((largest, row) => row.amount > largest.amount ? row : largest, chainCostRows[0]);

  return (
    <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
      <CompliPilotFlowBackdrop tone="bright" />

      <div className="relative z-10">
        <CompliPilotFlowHeader
          backHref={`/result/${sessionId}`}
          backLabel={locale === "zh" ? "返回结果页" : "Back to result"}
          flowTitle={locale === "zh" ? "成本影响分析" : "Cost Impact Analysis"}
          flowSubtitle={locale === "zh" ? "整改预算 · 风险暴露 · 上架决策" : "Budget · exposure · launch decision"}
          primaryHref={`/result/${sessionId}#reports`}
          primaryLabel={locale === "zh" ? "返回合规报告" : "Back to report"}
          secondaryHref="/upload"
          secondaryLabel={locale === "zh" ? "重新检测" : "Scan again"}
          tone="bright"
        />

      <section className="mx-auto w-full max-w-7xl px-6 pt-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <SectionEyebrow>{locale === "zh" ? "成本影响" : "Cost Impact"}</SectionEyebrow>
            <h1 className="mt-2 text-3xl font-semibold text-[#073b54] sm:text-4xl">{riskHeadings.title}</h1>
            <p className="mt-2 text-sm leading-7 text-[#073b54]/64">{riskHeadings.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {modeCards.map((mode) => {
              const selected = mode.id === profitMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setProfitMode(mode.id)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-medium transition",
                    selected
                      ? "border-[#073b54]/55 bg-[rgba(255,143,57,0.15)] font-semibold text-[#073b54] shadow-[0_12px_34px_rgba(255,120,41,0.12)]"
                      : "border-[#073b54]/30 bg-white/5 text-[#073b54]/75 hover:border-[#073b54]/55 hover:bg-white/10 hover:text-[#073b54]"
                  )}
                >
                  {mode.title} · {mode.value}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric, index) => {
            const featured = index === 1;
            const borderColor = [
              "border-[#10B981]/30",
              "border-[rgba(255,143,57,0.5)]",
              "border-[#F4A261]/30",
              "border-[#4CC9F0]/30",
            ][index] ?? "border-white/10";
            const glowBg = [
              "bg-[#10B981]/5",
              "bg-[rgba(255,143,57,0.08)]",
              "bg-[#F4A261]/5",
              "bg-[#4CC9F0]/5",
            ][index] ?? "";
            return (
              <div
                key={metric.label}
                className={cn(
                  "group relative blaze-panel-soft flex min-h-[138px] flex-col justify-between overflow-hidden border p-6 transition-all duration-300 hover:-translate-y-0.5",
                  borderColor,
                  featured ? "shadow-[0_0_30px_rgba(255,120,41,0.16)] ring-1 ring-[rgba(255,143,57,0.18)]" : ""
                )}
              >
                <div
                  className={cn(
                    "absolute inset-0 transition-opacity duration-300",
                    glowBg,
                    featured ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}
                />
                <div className="relative z-10 flex items-start justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-white/40">{metric.label}</p>
                  {featured ? (
                    <span className="shrink-0 rounded-full border border-[rgba(255,143,57,0.24)] bg-[rgba(255,143,57,0.1)] px-2.5 py-1 text-[10px] font-bold text-[var(--blaze-orange)]">
                      {locale === "zh" ? "核心结果" : "Core Result"}
                    </span>
                  ) : null}
                </div>
                <div className="relative z-10 mt-5 flex items-baseline gap-2">
                  <span className={`font-mono text-[36px] font-bold leading-none ${metric.tone}`}>
                    {metric.value}
                  </span>
                  {metric.unit ? (
                    <span className="pb-1 text-xs text-white/40">{metric.unit}</span>
                  ) : null}
                </div>
                {bareRiskCaveat && index === 0 ? (
                  <p
                    className="relative z-10 mt-2 text-[11px] font-medium leading-5 text-[#ff5a4d]"
                    data-testid="profit-bare-risk-caveat"
                  >
                    {bareRiskCaveat}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <section className="blaze-panel mt-6 p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <SectionEyebrow>{locale === "zh" ? "PAGE 05 · 数据驱动" : "PAGE 05 · Data driven"}</SectionEyebrow>
              <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">{riskHeadings.breakdown}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/60">
                {locale === "zh"
                  ? "从售价开始，逐项扣除采购、物流、平台、合规、营销与退货成本，实时计算最终净利润。"
                  : "Start from retail price, deduct procurement, logistics, marketplace, compliance, marketing, and returns to calculate final net profit."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-white/7 px-4 py-2 text-sm text-white/64">
                {locale === "zh" ? `售价基线 ${retailBaselineDisplay}` : `Retail baseline ${retailBaselineDisplay}`}
              </span>
              <span className="rounded-full border border-[rgba(73,190,205,0.28)] bg-[rgba(211,247,249,0.14)] px-4 py-2 text-sm text-white/74">
                {activeMode.title}
              </span>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { label: locale === "zh" ? "售价基线" : "Retail", value: retailBaselineDisplay },
              { label: locale === "zh" ? "全链路成本" : "Chain cost", value: `${currencySymbol}${totalChainCost.toFixed(2)}` },
              { label: locale === "zh" ? "最终净利润" : "Final net", value: finalProfitValue },
            ].map((metric, metricIndex) => (
              <div key={metric.label} className="rounded-[20px] border border-white/10 bg-white/[0.055] p-4">
                <p className="text-xs text-white/42">{metric.label}</p>
                <p className={cn("mt-2 font-mono text-2xl font-semibold", metricIndex === 2 ? "text-[#168096]" : "text-white")}>{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.35fr_0.8fr_0.85fr]">
            <div className="flex items-center gap-4 rounded-[20px] border border-[rgba(83,205,211,0.24)] bg-[linear-gradient(135deg,rgba(114,224,218,0.13),rgba(255,255,255,0.045))] p-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-[#168096]">
                <TrendingUp className="size-5" />
              </span>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-white/42">{locale === "zh" ? "AI 利润判断" : "AI margin signal"}</p>
                <p className="mt-1.5 text-sm font-semibold leading-6 text-white">
                  {locale === "zh"
                    ? `每售出 1 件保留 ¥${finalProfitNumber.toFixed(0)}，当前利润结构${finalProfitShare >= 10 ? "接近健康线" : "仍需谨慎"}。`
                    : `Each sale retains ¥${finalProfitNumber.toFixed(0)}; the current margin is ${finalProfitShare >= 10 ? "near the healthy range" : "still fragile"}.`}
                </p>
              </div>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.05] p-4">
              <p className="text-xs text-white/42">{locale === "zh" ? "距 ¥8 利润底线" : "Above ¥8 margin floor"}</p>
              <p className="mt-2 font-mono text-xl font-semibold text-[#168096]">+¥{breakEvenBuffer.toFixed(0)}</p>
            </div>
            <div className="rounded-[20px] border border-white/10 bg-white/[0.05] p-4">
              <p className="text-xs text-white/42">{locale === "zh" ? "最大成本来源" : "Largest cost driver"}</p>
              <p className="mt-2 truncate text-sm font-semibold text-white">{dominantCost.label}</p>
              <p className="mt-1 font-mono text-xs text-[#227f95]">¥{dominantCost.amount.toFixed(0)} · {dominantCost.share.toFixed(1)}%</p>
            </div>
          </div>

          <div className="mt-7">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">{locale === "zh" ? "成本节点流" : "Cost flow"}</p>
              <p className="text-xs text-white/44">{locale === "zh" ? "节点宽度按售价占比计算" : "Node bars reflect share of retail"}</p>
            </div>
            <div className={cn("mt-4 h-1.5 rounded-full bg-[rgba(65,168,194,0.16)]", profitStyles.flowRail)} />
            <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {chainCostRows.map((row, rowIndex) => (
                <article
                  key={row.label}
                  className={cn("rounded-[20px] border border-white/10 bg-white/[0.055] p-4", profitStyles.chainNode)}
                  style={{ animationDelay: `${rowIndex * 90}ms` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-white/7 font-mono text-[11px] text-white/58">0{rowIndex + 1}</span>
                    <span className="font-mono text-xs font-semibold text-[#227f95]">{row.share.toFixed(1)}%</span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-white">{row.label}</h3>
                  <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-white/48">{row.detail}</p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <p className="font-mono text-xl font-semibold text-white">{row.displayAmount}</p>
                    <div className="text-right">
                      <p className="text-[10px] text-white/36">{locale === "zh" ? "扣后余额" : "Balance"}</p>
                      <p className="font-mono text-xs font-semibold text-[#227f95]">¥{row.remaining.toFixed(0)}</p>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className={cn("h-full rounded-full", profitStyles.costBar)}
                      style={{ width: `${Math.max(row.share, row.amount > 0 ? 4 : 0)}%`, backgroundColor: row.color, animationDelay: `${240 + rowIndex * 90}ms` }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="mt-7 border-t border-white/10 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{locale === "zh" ? "售价分配结果" : "Retail allocation"}</p>
                <p className="mt-1 text-xs text-white/45">{locale === "zh" ? "每一段代表售价中被对应成本或利润占用的比例" : "Each segment shows how retail value is consumed by cost or profit."}</p>
              </div>
              <p className="font-mono text-sm font-semibold text-[#168096]">{locale === "zh" ? "净利率" : "Net margin"} {finalProfitShare.toFixed(1)}%</p>
            </div>
            <div className="mt-4 flex h-12 overflow-hidden rounded-[18px] border border-white/10 bg-white/[0.04] p-1.5">
              {chainCostRows.map((row, rowIndex) => (
                row.share > 0 ? (
                  <div
                    key={row.label}
                    title={`${row.label} ${row.displayAmount}`}
                    className={cn("h-full first:rounded-l-[12px]", profitStyles.stackSegment)}
                    style={{ width: `${row.share}%`, backgroundColor: row.color, animationDelay: `${rowIndex * 80}ms` }}
                  />
                ) : null
              ))}
              <div
                title={`${locale === "zh" ? "最终净利润" : "Final net"} ${finalProfitValue}`}
                className={cn("h-full rounded-r-[12px] bg-[linear-gradient(135deg,#8cf0df,#42bfd0)]", profitStyles.stackSegment)}
                style={{ width: `${finalProfitShare}%`, animationDelay: "560ms" }}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              {chainCostRows.map((row) => (
                <span key={row.label} className="inline-flex items-center gap-1.5 text-xs text-white/48">
                  <span className="size-2 rounded-full" style={{ backgroundColor: row.color }} />
                  {row.label} {row.displayAmount}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#168096]">
                <span className="size-2 rounded-full bg-[#62d8d5]" />
                {locale === "zh" ? "最终净利润" : "Final net"} {finalProfitValue}
              </span>
            </div>
          </div>

          <div className="mt-7 border-t border-white/10 pt-6">
            <div className="mb-4 flex items-center gap-3">
              <ShieldAlert className="size-5 text-[#b95a50]" />
              <h3 className="text-lg font-semibold text-white">{riskHeadings.riskTitle}</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {riskExposureItems.map((item, itemIndex) => {
                const riskIcons = [Gavel, XCircle, ShieldAlert, Gavel];
                const Icon = riskIcons[itemIndex % riskIcons.length];
                return (
                  <div key={item} className="flex items-start gap-3 rounded-[18px] border border-white/10 bg-white/[0.055] p-4">
                    <Icon className="mt-0.5 size-5 shrink-0 text-[#b95a50]" />
                    <span className="text-sm font-semibold leading-6 text-white">{item}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {(() => {
          // 真实后端 LLM 还会产出完整 markdown(CE/UKCA 摊销明细、¥15,000-40,000、
          // 物流 + 平台抽佣等),不仅有结构化数字。把这段叙述作为「后端成本
          // 详述」面板紧跟结构化视图之后,避免用户看不到 LLM 写的内容。
          // 这条路径只在 financialSummary 是从后端合成而来时挂上 —— 我们
          // 通过比对 financialSummary 引用 vs result.financialSummary 字段
          // 判断,而不是新加 metadata flag,避免改后端接口。
          const backendMarkdown = result.reportPackage?.profitReport?.markdown;
          const isSynthesized = !result.financialSummary && financialSummary;
          if (!isSynthesized || !backendMarkdown) return null;
          return (
            <section className="blaze-panel mt-6 p-5 sm:p-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <SectionEyebrow>
                    {locale === "zh" ? "后端 LLM · 成本详述" : "Backend LLM · cost detail"}
                  </SectionEyebrow>
                  <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
                    {locale === "zh"
                      ? "本次扫描的完整成本叙述(来自后端 LLM)"
                      : "Full cost narrative for this scan (from the backend LLM)"}
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-white/60">
                    {locale === "zh"
                      ? "以下为后端 LLM 结合语料库与本次扫描产物直接生成的成本 / 利润 / 风险叙述。数字与上方「合规化升级总成本」结构保持一致,但包含更细的认证明细与单台摊销推导。"
                      : "Below is the cost / margin / exposure narrative generated by the backend LLM against the corpus and this scan. Numbers track the structured figures above, with finer certification breakdown and per-unit amortization."}
                  </p>
                </div>
                <span className="rounded-full border border-[rgba(255,143,57,0.28)] bg-[rgba(255,143,57,0.08)] px-3 py-1 text-xs font-semibold text-[var(--blaze-orange)]">
                  {locale === "zh" ? "后端真实输出" : "Real backend output"}
                </span>
              </div>
              <pre className="mt-5 whitespace-pre-wrap rounded-[20px] border border-white/10 bg-black/30 p-5 text-sm leading-7 text-white/82">
                {backendMarkdown}
              </pre>
            </section>
          );
        })()}

        <div className="mt-8 flex flex-col gap-4 sm:flex-row">
          <ProfitExportPanel
            result={result}
            locale={locale}
            profitMode={profitMode}
            primaryLabel={riskHeadings.exportProfit}
            secondaryLabel={riskHeadings.exportCompliance}
            className="flex-1"
          />
          <Link
            href="/pricing"
            className={cn(
              buttonVariants({ variant: "ghost", size: "lg" }),
              "flex-1 rounded-full border border-white/12 bg-white/6 text-white hover:bg-white/10"
            )}
          >
            <TrendingUp className="size-4" />
            {locale === "zh" ? "查看产品方案" : "View product plans"}
          </Link>
        </div>

        <div className="mt-8 text-center">
          <Link
            href={`/result/${sessionId}`}
            className="inline-flex items-center gap-2 border-b border-transparent pb-1 text-sm text-white/56 transition hover:border-[var(--blaze-orange)] hover:text-[var(--blaze-orange)]"
          >
            <span>{riskHeadings.back}</span>
          </Link>
        </div>
      </section>
        <CompliPilotFlowFooter sessionId={sessionId} tone="bright" />
      </div>
    </main>
  );
}
