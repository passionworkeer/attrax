"use client";

import Image from "next/image";
import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CircleAlert, CircleDollarSign, Download, FileStack, MoveRight, ScanLine } from "lucide-react";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlowPill, SectionEyebrow } from "@/components/blaze-hawks/ui";
import {
  CompliPilotFlowBackdrop,
  CompliPilotFlowFooter,
  CompliPilotFlowHeader,
} from "@/components/complipilot/flow-shell";
import { getCompliPilotCopy } from "@/lib/complipilot/copy";
import {
  blazeReportFiles,
  blazeReportPreviewTabs,
} from "@/lib/complipilot/scenario";
import { createMockScanResult, mockComplianceReportMarkdown, mockScanResult } from "@/lib/mock/blaze-scan-result";
import type { ComplianceReportResult, ProductCategory, RiskPoint, ScanResult, ScanStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ComplianceReportView } from "@/components/result/ComplianceReportView";
import { ResultExportButton } from "./result-export-button";
import brightFlow from "@/components/complipilot/bright-flow.module.css";

/**
 * Synthesize a `ComplianceReportResult` view-model from the demo's `ScanResult`.
 *
 * The home-page demo (`/result/demo`) renders a `ScanResult` sourced from
 * `lib/mock/blaze-scan-result.ts`. The download buttons in the export card
 * point to `#compliance-report`, which the page previously did not render —
 * clicking them was a dead link. The view itself uses
 * `<ComplianceReportView>`'s PDF/DOCX path, so the anchor target IS the view.
 *
 * The markdown body comes from `lib/mock/blaze-scan-result.ts`'s exported
 * pre-built string (`mockComplianceReportMarkdown`), NOT from a server-only
 * `buildComplianceReport` call. Keeping the markdown client-bundle-safe lets
 * `page.tsx` (a Client Component) render the view without dragging the
 * server `fs` chain through Turbopack's client chunks.
 *
 * The same markdown text is also what `/api/report/demo/compliance?format=md`
 * serves — that's a server route, so it goes through `lib/reporting.ts.buildComplianceReport`
 * and stays in sync on every demo rebuild. Both paths read from the same
 * source of truth (`mockComplianceReportMarkdown`/`buildComplianceReport`
 * pair), so /result/demo and /api/report/demo describe identical content.
 */
function scanResultToComplianceView(result: ScanResult, locale: "zh" | "en"): ComplianceReportResult {
  const severityRank: Record<RiskPoint["severity"], number> = { critical: 3, warning: 2, info: 1 };
  const topRank = result.riskPoints.reduce((acc, rp) => Math.max(acc, severityRank[rp.severity] ?? 0), 0);
  const complianceStatus: ComplianceReportResult["complianceStatus"] =
    topRank >= 3 ? "REJECTED" : topRank >= 2 ? "WARN" : "PASS";
  const traceNodes: ComplianceReportResult["agentTrace"] = result.riskPoints.map((rp) => ({
    node: `risk.${rp.riskId}`,
    label: rp.title,
    severity: rp.severity,
  }));
  traceNodes.push({ node: "demo.aggregate", label: locale === "zh" ? "Demo 数据汇总" : "Demo aggregate" });
  const fallback = mockComplianceReportMarkdown(result, locale);
  return {
    sessionId: result.sessionId,
    scanTime: result.scanTime,
    productCategory: result.productCategory,
    productName: result.productName,
    productNameEn: result.productNameEn,
    targetMarkets: result.targetMarkets,
    complianceScore: result.complianceScore,
    scoreGrade: result.scoreGrade,
    complianceReport: fallback,
    complianceStatus,
    agentTrace: traceNodes,
    loopCount: 0,
    retrievedChunks: result.riskPoints.flatMap((rp) =>
      rp.regulations.map((rule) => ({
        regId: rule.regId,
        docName: rule.name,
        docNameEn: rule.nameEn,
        articleNo: rule.code,
        region: rule.market,
        score: 0.85,
      })),
    ),
    images: undefined,
    documents: [],
    riskPoints: undefined,
    checklist: undefined,
    generatedAt: result.generatedAt,
    modelInfo: { ragProvider: "demo", latencyMs: 0 },
    source: "demo",
  };
}

function readStoredAccessToken(sessionId: string): string | null {
  try {
    const value = sessionStorage.getItem(`scan-token:${sessionId}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function severityLabel(locale: "zh" | "en", severity: RiskPoint["severity"]) {
  if (locale === "zh") {
    switch (severity) {
      case "critical":
        return "高危";
      case "warning":
        return "警告";
      default:
        return "提示";
    }
  }

  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    default:
      return "Info";
  }
}

function severityClass(severity: RiskPoint["severity"]) {
  switch (severity) {
    case "critical":
      return "border-[rgba(196,76,63,0.32)] bg-[rgba(255,225,219,0.5)] text-[#8f3229]";
    case "warning":
      return "border-[rgba(189,120,30,0.28)] bg-[rgba(255,239,204,0.52)] text-[#7a4a0b]";
    default:
      return "border-[rgba(37,126,166,0.24)] bg-[rgba(214,242,250,0.52)] text-[#165c7a]";
  }
}

function productCategoryLabel(locale: "zh" | "en", category: ProductCategory) {
  const labels = {
    zh: {
      electronics: "3C 电子",
      "3c": "3C 电子",
      appliance: "家电",
      toy: "玩具",
      home: "家居",
      other: "其他",
    },
    en: {
      electronics: "3C electronics",
      "3c": "3C electronics",
      appliance: "Appliance",
      toy: "Toy",
      home: "Home",
      other: "Other",
    },
  } as const;

  return labels[locale][category] ?? category;
}

function localizeRiskPoint(locale: "zh" | "en", risk: RiskPoint): RiskPoint {
  if (locale === "en") {
    return {
      ...risk,
      title: risk.titleEn ?? risk.title,
      description: risk.descriptionEn ?? risk.description,
      recommendedAction: risk.recommendedActionEn ?? risk.recommendedAction,
      regulations: risk.regulations.map((regulation) => ({
        ...regulation,
        name: regulation.nameEn ?? regulation.name,
        summary: regulation.summaryEn ?? regulation.summary,
      })),
    };
  }
  return risk;
}

function localizeTimeText(locale: "zh" | "en", value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  if (locale === "zh") {
    return value;
  }

  const map: Record<string, string> = {
    "第 1-2 天": "Days 1-2",
    "第 3-7 天": "Days 3-7",
    "第 1 周": "Week 1",
    "第 2 周": "Week 2",
    "第 3-5 周": "Weeks 3-5",
    "第 3-5 天": "Days 3-5",
  };
  return map[value] ?? value;
}

function getLocalizedPreviewTab(locale: "zh" | "en", value: string) {
  if (locale === "zh") {
    return blazeReportPreviewTabs.find((tab) => tab.value === value) ?? blazeReportPreviewTabs[0];
  }

  const englishMap = {
    compliance: {
      label: "Compliance Report",
      title: "CompliPilot · Compliance Scan Report",
      subtitle:
        "This report is fit for the first remediation sync across legal, operations, and supplier teams.",
      leftMetric: { label: "Base Mode", value: "$1", hint: "Risk mode $6800" },
      rightMetric: { label: "Compliance Mode", value: "$7", hint: "Risk mode $6000" },
      bullets: [
        "CE / UKCA marks are missing and should be restored on the shell or nameplate.",
        "Input-output specs and protocol notes are incomplete, so manuals and listings must be aligned.",
        "Packaging warnings are too weak for EU and UK market expectations.",
      ],
    },
    roadmap: {
      label: "Roadmap Report",
      title: "Compliance Roadmap Report",
      subtitle:
        "This turns document freeze, label remediation, certification, and listing review into one executable timeline.",
      leftMetric: { label: "Current state", value: "Rejected", hint: "Estimated lead time 35 days" },
      rightMetric: { label: "Milestones", value: "5", hint: "From freeze to listing" },
      bullets: [
        "Days 1-2 freeze the BOM, nameplate, and supplier package.",
        "Days 3-7 finish CE / UKCA, IO spec, and warning updates.",
        "Weeks 3-5 move into lab testing and declaration flow before listing review.",
      ],
    },
    profit: {
      label: "Profit & AI Decision",
      title: "Cost Margin Analysis / AI Decision Report",
      subtitle:
        "This places the base and compliance modes side by side and explains why the batch should not go live yet.",
      leftMetric: { label: "Gross profit", value: "$7.46", hint: "Base mode $0.71" },
      rightMetric: { label: "Decision", value: "HIGH", hint: "Remediate before launch" },
      bullets: [
        "Single-platform compliance cost rises 23%, but it avoids fines and returns.",
        "Estimated monthly loss is around $6000, so remediation comes before market entry.",
        "AI decision: the evidence chain is incomplete; finish CE, LVD, and RoHS first.",
      ],
    },
  } as const;

  return englishMap[value as keyof typeof englishMap] ?? englishMap.compliance;
}

function getPreviewBullets(
  locale: "zh" | "en",
  value: string,
  result: ScanResult,
  financialSummary: NonNullable<ScanResult["financialSummary"]>,
) {
  if (value === "roadmap") {
    return result.checklist.slice(0, 3).map((item) => {
      const category = locale === "en" ? item.categoryEn ?? item.category : item.category;
      const title = locale === "en" ? item.titleEn ?? item.title : item.title;
      return `${category}: ${title}`;
    });
  }

  if (value === "profit") {
    return locale === "zh"
      ? [
          `整改前单件收益 ${financialSummary.estimatedHeroicProfit}，合规后净收益 ${financialSummary.trueNetProfit}。`,
          `单产品合规成本 ${financialSummary.complianceCost}，月度净收益基准 ${financialSummary.monthlyNetProfit}。`,
          `当前得分 ${result.complianceScore} / ${result.scoreGrade}，建议先关闭高优先级风险再上架。`,
        ]
      : [
          `Per-unit return moves from ${financialSummary.estimatedHeroicProfit} before remediation to ${financialSummary.trueNetProfit} after compliance.`,
          `Compliance cost is ${financialSummary.complianceCost} per unit, with a monthly net baseline of ${financialSummary.monthlyNetProfit}.`,
          `The current score is ${result.complianceScore} / ${result.scoreGrade}; close priority risks before launch.`,
        ];
  }

  return result.riskPoints.slice(0, 3).map((riskRaw) => {
    const risk = localizeRiskPoint(locale, riskRaw);
    return `${risk.title}: ${risk.recommendedAction}`;
  });
}

export default function ResultPage() {
  const params = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const { locale } = useBlazeLocale();
  const copy = getCompliPilotCopy(locale);
  const sessionId = params.sessionId;
  const presetKey = search?.get("preset") ?? "";
  const presetCategory: ProductCategory | null =
    presetKey === "humidifier"
      ? "appliance"
      : presetKey === "toy"
        ? "toy"
        : presetKey === "charger"
          ? "electronics"
          : null;
  const isDemoSession = sessionId === "demo";
  const demoResult = isDemoSession
    ? presetCategory
      ? createMockScanResult("demo", { category: presetCategory })
      : mockScanResult
    : null;
  const [result, setResult] = useState<ScanResult | null>(demoResult);
  const [message, setMessage] = useState(copy.result.loadingMessage);
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null);
  const displayMessage = message;

  useEffect(() => {
    if (!sessionId || isDemoSession) {
      return;
    }

    let cancelled = false;

    const cached = sessionStorage.getItem(`scan:${sessionId}`);
    if (cached) {
      try {
        const cachedResult = JSON.parse(cached) as ScanResult;
        startTransition(() => {
          setResult(cachedResult);
          setSelectedRiskId(cachedResult.riskPoints[0]?.riskId ?? null);
          setMessage(copy.result.restored);
        });
        return;
      } catch {
        sessionStorage.removeItem(`scan:${sessionId}`);
      }
    }

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
            startTransition(() => {
              setMessage(copy.result.notFound);
            });
            return;
          }

          const payload: ScanStatus = await response.json();
          if (
            (payload.status === "ready" || payload.status === "degraded") &&
            payload.result
          ) {
            const resultPayload = payload.result;
            sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(resultPayload));
            startTransition(() => {
              if ("financialSummary" in resultPayload) {
                setResult(resultPayload);
                setSelectedRiskId(resultPayload.riskPoints?.[0]?.riskId ?? null);
              } else {
                setResult(resultPayload as ScanResult);
                setSelectedRiskId(
                  "riskPoints" in resultPayload
                    ? resultPayload.riskPoints?.[0]?.riskId ?? null
                    : null,
                );
              }
              setMessage(
                payload.status === "degraded"
                  ? locale === "zh"
                    ? "后端返回了明确标记的降级结果。"
                    : "The backend returned an explicitly degraded result."
                  : copy.result.loaded,
              );
            });
            return;
          }

          if (payload.status === "failed") {
            startTransition(() => {
              setMessage(payload.error ?? copy.result.failed);
            });
            return;
          }

          startTransition(() => {
            setMessage(copy.result.processing);
          });
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      } catch {
        if (!cancelled) {
          startTransition(() => {
            setMessage(
              locale === "zh"
                ? "结果加载失败，请检查本地服务后重新检测。"
                : "The result failed to load. Check the local service and scan again."
            );
          });
        }
      }
    }

    loadResult();

    return () => {
      cancelled = true;
    };
  }, [
    copy.result.failed,
    copy.result.loaded,
    copy.result.notFound,
    copy.result.processing,
    copy.result.restored,
    isDemoSession,
    locale,
    sessionId,
  ]);

  if (!result) {
    return (
      <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
        <CompliPilotFlowBackdrop tone="bright" />
        <div className="relative z-10">
          <CompliPilotFlowHeader
            backHref="/upload"
            backLabel={locale === "zh" ? "返回上传页" : "Back to upload"}
            flowTitle={locale === "zh" ? "合规检测结果" : "Compliance Result"}
            flowSubtitle={locale === "zh" ? "风险总览 · 法规依据 · 整改建议" : "Risks · citations · remediation"}
            primaryHref="/upload"
            primaryLabel={locale === "zh" ? "重新检测" : "Scan again"}
            statusLabel={locale === "zh" ? "加载中" : "Loading"}
            tone="bright"
          />
          <section className="mx-auto w-full max-w-5xl px-6 pt-8">
            <div className="blaze-panel p-8">
              <SectionEyebrow>Result</SectionEyebrow>
              <h1 className="mt-3 text-3xl font-semibold text-white">{copy.result.loading}</h1>
              <p className="mt-4 text-sm leading-7 text-white/60">{displayMessage}</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (result.riskPoints.length === 0) {
    return (
      <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
        <CompliPilotFlowBackdrop tone="bright" />
        <div className="relative z-10">
          <CompliPilotFlowHeader
            backHref="/upload"
            backLabel={locale === "zh" ? "返回上传页" : "Back to upload"}
            flowTitle={locale === "zh" ? "合规检测结果" : "Compliance Result"}
            flowSubtitle={locale === "zh" ? "真实后端结果 · 未伪造风险项" : "Backend result · no synthetic risks"}
            primaryHref="/upload"
            primaryLabel={locale === "zh" ? "重新检测" : "Scan again"}
            statusLabel={result.source === "fallback" ? "DEGRADED" : "INCOMPLETE"}
            tone="bright"
          />
          <section className="mx-auto w-full max-w-5xl px-6 pt-8">
            <div className="blaze-panel p-8">
              <SectionEyebrow>{result.source === "fallback" ? "Degraded" : "Incomplete"}</SectionEyebrow>
              <h1 className="mt-3 text-3xl font-semibold text-white">
                {locale === "zh" ? "后端未返回可展示的风险证据" : "No displayable risk evidence was returned"}
              </h1>
              <p className="mt-4 text-sm leading-7 text-white/60">
                {locale === "zh"
                  ? "页面不会用 Mock 数据替换真实结果。请检查检索库、模型响应和报告包中的 decisionView。"
                  : "The page will not replace this response with mock data. Check retrieval, model output, and reportPackage.decisionView."}
              </p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const criticalCount = result.riskPoints.filter((item) => item.severity === "critical").length;
  const financialSummary = result.financialSummary ?? {
    estimatedHeroicProfit: "—",
    trueNetProfit: "—",
    complianceCost: "—",
    monthlyNetProfit: "—",
    targetVolumeLabel: locale === "zh" ? "后端未提供" : "Not provided",
    riskExposureItems: [],
    costBreakdown: [],
  };
  const complianceView = scanResultToComplianceView(result, locale);
  const critical = result.riskPoints.find((item) => item.severity === "critical");
  const activeRiskRaw =
    result.riskPoints.find((item) => item.riskId === selectedRiskId) ??
    critical ??
    result.riskPoints[0];
  const activeRisk = localizeRiskPoint(locale, activeRiskRaw);
  const resultImages = result.images;
  const anchorId = activeRiskRaw?.imageId ?? resultImages[0]?.imageId;
  const riskImage =
    resultImages.find((item) => item.imageId === anchorId) ?? resultImages[0] ?? null;
  const riskCanvasImage = riskImage;
  const displayProductName = locale === "en" ? result.productNameEn ?? result.productName : result.productName;
  const displayProductCategory = productCategoryLabel(locale, result.productCategory);
  const roadmapRows = [
    ...result.checklist.map((item, index) => ({
      phase: locale === "en" ? item.categoryEn ?? item.category : item.category,
      time: localizeTimeText(locale, item.estimatedTime, copy.result.unknownTime),
      owner:
        locale === "zh"
          ? index === 0 ? "产品 / 采购" : "设计 / 合规"
          : index === 0 ? "Product / Procurement" : "Design / Compliance",
      output: locale === "en" ? item.titleEn ?? item.title : item.title,
    })),
    {
      phase: locale === "zh" ? "上架复核" : "Listing review",
      time: locale === "zh" ? "整改完成后" : "After remediation",
      owner: locale === "zh" ? "运营 / 法务" : "Operations / Legal",
      output:
        locale === "zh"
          ? `确认 ${result.targetMarkets.join(" / ")} 市场风险与报告均已闭环`
          : `Confirm ${result.targetMarkets.join(" / ")} risks and reports are closed`,
    },
  ];

  return (
    <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
      <CompliPilotFlowBackdrop tone="bright" />

      <div className="relative z-10">
        <CompliPilotFlowHeader
          backHref="/upload"
          backLabel={locale === "zh" ? "返回上传页" : "Back to upload"}
          flowTitle={locale === "zh" ? "合规检测结果" : "Compliance Result"}
          flowSubtitle={locale === "zh" ? "风险总览 · 法规依据 · 整改报告" : "Risk overview · citations · report"}
          primaryHref="#reports"
          primaryLabel={locale === "zh" ? "查看报告" : "View reports"}
          secondaryHref="/"
          secondaryLabel={locale === "zh" ? "返回首页" : "Back home"}
          tone="bright"
        />

      <section className="mx-auto w-full max-w-7xl space-y-6 overflow-hidden px-6 pt-6">
        <section id="overview" className="blaze-panel overflow-hidden p-5 sm:p-7">
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <SectionEyebrow>{locale === "zh" ? "STEP 01 · 先看结论" : "STEP 01 · Verdict"}</SectionEyebrow>
                <span className={cn("rounded-full border px-3 py-1 text-xs", severityClass(activeRisk.severity))}>
                  {criticalCount > 0
                    ? locale === "zh" ? "暂缓上架" : "Hold launch"
                    : locale === "zh" ? "可进入复核" : "Ready for review"}
                </span>
              </div>
              <h1 className="mt-4 text-4xl font-semibold leading-tight text-white sm:text-5xl">{displayProductName}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/62">
                {locale === "zh"
                  ? `已完成 ${result.images.length} 张图片分析。先处理 ${criticalCount} 个高危风险，再进入 ${result.targetMarkets.join(" / ")} 市场上架复核。`
                  : `${result.images.length} images analyzed. Close ${criticalCount} critical risks before ${result.targetMarkets.join(" / ")} launch review.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {result.targetMarkets.map((market) => <GlowPill key={market}>{market} {copy.result.marketSuffix}</GlowPill>)}
                <GlowPill>{displayProductCategory}</GlowPill>
                <GlowPill>{result.riskPoints.length} {copy.result.hotspotsCountSuffix}</GlowPill>
              </div>
              <div className="mt-6 grid overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.045] sm:grid-cols-4">
                {[
                  { label: locale === "zh" ? "合规得分" : "Score", value: `${result.complianceScore}/${result.scoreGrade}` },
                  { label: locale === "zh" ? "高危风险" : "Critical", value: String(criticalCount) },
                  { label: locale === "zh" ? "整改预算" : "Fix budget", value: financialSummary.complianceCost },
                  { label: locale === "zh" ? "整改后净利" : "Post-fix net", value: financialSummary.trueNetProfit },
                ].map((metric) => (
                  <div key={metric.label} className="border-b border-white/10 px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                    <p className="text-xs text-white/42">{metric.label}</p>
                    <p className="mt-2 font-mono text-xl font-semibold text-white">{metric.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <aside className="flex flex-col rounded-[28px] border border-[rgba(255,143,57,0.22)] bg-[linear-gradient(145deg,rgba(255,143,57,0.12),rgba(255,255,255,0.05))] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#073b54]">{locale === "zh" ? "当前最重要的事" : "Top priority"}</p>
              <h2 className="mt-4 text-2xl font-semibold leading-snug text-white">{activeRisk.title}</h2>
              <p className="mt-3 text-sm leading-6 text-white/60">{activeRisk.description}</p>
              <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.055] p-4">
                <p className="text-xs text-white/42">{locale === "zh" ? "建议动作" : "Recommended action"}</p>
                <p className="mt-2 text-sm leading-6 text-white/72">{activeRisk.recommendedAction}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-5">
                <a href="#evidence" className={cn(buttonVariants({ size: "sm" }), "rounded-full")}>
                  {locale === "zh" ? "查看风险证据" : "View evidence"}<MoveRight className="size-4" />
                </a>
                <Link href={`/profit/${sessionId}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-full border border-white/10 bg-white/8 text-white hover:bg-white/12")}>
                  {locale === "zh" ? "查看利润影响" : "Profit impact"}
                </Link>
              </div>
            </aside>
          </div>
        </section>
        <nav aria-label={locale === "zh" ? "结果阅读顺序" : "Result reading order"} className="blaze-panel grid gap-3 p-2 sm:grid-cols-3">
          {[
            { href: "#overview", step: "01", title: locale === "zh" ? "先看结论" : "Verdict", body: locale === "zh" ? "确认是否可以继续上架" : "Decide whether launch can continue" },
            { href: "#evidence", step: "02", title: locale === "zh" ? "再查证据" : "Evidence", body: locale === "zh" ? "定位风险、法规与成本" : "Review risks, citations, and cost" },
            { href: "#action", step: "03", title: locale === "zh" ? "最后执行" : "Action", body: locale === "zh" ? "按路线整改并导出报告" : "Remediate and export reports" },
          ].map((item) => (
            <a key={item.step} href={item.href} className="group flex items-center gap-4 rounded-[22px] border border-white/10 bg-white/[0.055] px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.09]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/8 font-mono text-xs font-semibold text-[var(--blaze-orange)]">{item.step}</span>
              <span><span className="block text-sm font-semibold text-white">{item.title}</span><span className="mt-0.5 block text-xs text-white/48">{item.body}</span></span>
            </a>
          ))}
        </nav>

        <section id="evidence" className="blaze-panel p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <SectionEyebrow>{locale === "zh" ? "STEP 02 · 查证据" : "STEP 02 · Evidence"}</SectionEyebrow>
              <h2 className="mt-3 text-3xl font-semibold text-white">{copy.result.interactive}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/58">{copy.result.interactiveBody}</p>
            </div>
            <GlowPill>{copy.result.clickHotspot}</GlowPill>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-[220px_1fr]">
            <div className="rounded-[22px] border border-[rgba(52,173,199,0.28)] bg-[rgba(211,248,250,0.16)] p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-white/42">
                {locale === "zh" ? "预计整改成本" : "ESTIMATED FIX COST"}
              </p>
              <p className="mt-2 font-mono text-3xl font-black text-[#073b54]">{financialSummary.complianceCost}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.055] p-4">
              <div className="flex items-center justify-between gap-3 text-xs text-white/48">
                <span>{locale === "zh" ? "风险证据完整度" : "Evidence coverage"}</span>
                <span>85%</span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-[linear-gradient(90deg,#76eadf,#54bde0)] shadow-[0_0_12px_rgba(93,224,220,0.35)]" style={{ width: "85%" }} />
              </div>
            </div>
          </div>

          <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_400px]">
            <div className="mt-5 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(117,222,230,0.12),rgba(74,135,198,0.12))] p-3 sm:p-4">
              <div
                data-flow-dark
                className="relative aspect-[4/3] overflow-hidden rounded-[24px] border border-white/10 bg-[#10243d]"
                style={{ aspectRatio: "4 / 3" }}
              >
                {riskCanvasImage ? (
                  <Image
                    src={riskCanvasImage.url}
                    alt={displayProductName ?? "Product risk canvas"}
                    fill
                    sizes="(min-width: 1280px) 62vw, (min-width: 768px) 92vw, 94vw"
                    className="object-cover"
                    priority
                    unoptimized={riskCanvasImage.url.startsWith("/api/")}
                  />
                ) : null}

                {result.riskPoints.filter((risk) => risk.estimatedFixCost).slice(0, 3).map((riskRaw, tagIndex) => {
                  const tagPositions = [
                    { left: "10%", top: "12%" },
                    { left: "62%", top: "14%" },
                    { left: "56%", top: "75%" },
                  ];
                  const pos = tagPositions[tagIndex % tagPositions.length];
                  return (
                    <div
                      key={`cost-tag-${riskRaw.riskId}`}
                      className="absolute hidden items-center gap-1.5 rounded-full border border-[rgba(102,224,226,0.46)] bg-[rgba(238,252,255,0.9)] px-2.5 py-1.5 font-mono text-[11px] font-semibold text-[#155b70] shadow-[0_10px_30px_rgba(5,48,70,0.14)] backdrop-blur-md sm:flex"
                      style={{ left: pos.left, top: pos.top }}
                    >
                      <CircleDollarSign className="size-3.5" />
                      {riskRaw.estimatedFixCost}
                    </div>
                  );
                })}

                {result.riskPoints.map((riskRaw) => {
                  const risk = localizeRiskPoint(locale, riskRaw);
                  const selected = riskRaw.riskId === activeRiskRaw?.riskId;
                  const hotspotLeft = risk.bbox.x * 100;
                  const hotspotTop = risk.bbox.y * 100;
                  return (
                    <button
                      key={riskRaw.riskId}
                      type="button"
                      onClick={() => setSelectedRiskId(riskRaw.riskId)}
                      aria-label={`${copy.result.riskLabel} ${risk.title}`}
                      className={`absolute z-10 flex items-center border text-left shadow-[0_12px_36px_rgba(4,39,61,0.22)] backdrop-blur-md transition ${
                        selected
                          ? "w-[min(170px,calc(100%-16px))] gap-2 rounded-[16px] border-[rgba(96,224,226,0.64)] bg-[rgba(236,251,255,0.94)] px-3 py-2 text-[#113f59]"
                          : "size-10 justify-center rounded-full border-[rgba(112,232,228,0.72)] bg-[rgba(230,250,253,0.92)] text-[#155b70] hover:scale-105"
                      }`}
                      style={{
                        left: selected
                          ? `clamp(8px, calc(${hotspotLeft}% - 8px), calc(100% - 178px))`
                          : `clamp(8px, calc(${hotspotLeft}% - 8px), calc(100% - 48px))`,
                        top: selected
                          ? `clamp(8px, calc(${hotspotTop}% - 8px), calc(100% - 68px))`
                          : `clamp(8px, calc(${hotspotTop}% - 8px), calc(100% - 48px))`,
                      }}
                    >
                      <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-[rgba(71,190,207,0.16)]">
                        <ScanLine className="size-4" />
                        <span className="absolute -inset-1 -z-10 rounded-full border border-[rgba(100,225,226,0.42)]" />
                      </span>
                      {selected ? (
                        <span className="min-w-0">
                          <span className="block text-[10px] uppercase tracking-[0.15em] text-[#347087]">{copy.result.riskLabel} {risk.riskId.slice(-2)}</span>
                          <span className="mt-0.5 block truncate text-xs font-semibold">{risk.title}</span>
                        </span>
                      ) : (
                        <span className="sr-only">{risk.riskId.slice(-2)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <article className="rounded-[26px] border border-white/10 bg-white/[0.06] p-5 sm:p-6">
              <SectionEyebrow>{copy.result.hotspotDetail}</SectionEyebrow>
              <h3 className="mt-3 text-2xl font-semibold text-white">{activeRisk.title}</h3>
              <p className="mt-3 text-sm leading-7 text-white/60">{activeRisk.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className={cn("rounded-full border px-3 py-1 text-xs", severityClass(activeRisk.severity))}>{severityLabel(locale, activeRisk.severity)}</span>
                <GlowPill>{copy.result.confidence} {Math.round(activeRisk.confidence * 100)}</GlowPill>
                <GlowPill>{copy.result.flameLevel} {activeRisk.flameLevel}</GlowPill>
              </div>
              <div className="relative mt-5 overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
                <div className="max-h-[340px] snap-y snap-mandatory space-y-3 overflow-y-auto p-3 pr-2 [scrollbar-color:rgba(91,196,207,0.45)_transparent] [scrollbar-width:thin]">
                  <article className="snap-start rounded-[18px] border border-white/10 bg-white/[0.07] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2d7b90]">{locale === "zh" ? "风险数据" : "Risk metrics"}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "置信度" : "Confidence"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{Math.round(activeRisk.confidence * 100)}%</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "整改成本" : "Fix cost"}</p><p className="mt-1 font-mono text-sm font-semibold text-white">{activeRisk.estimatedFixCost ?? copy.result.unknownCost}</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "法规数" : "Citations"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{activeRisk.regulations.length}</p></div>
                    </div>
                  </article>

                  <article className="snap-start rounded-[18px] border border-white/10 bg-white/[0.07] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2d7b90]">{locale === "zh" ? "证据定位" : "Evidence location"}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "图片" : "Image"}</p><p className="mt-1 truncate font-mono text-xs font-semibold text-white">{activeRiskRaw.imageId}</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "市场" : "Markets"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{result.targetMarkets.length}</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "风险编号" : "Risk ID"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{activeRisk.riskId.slice(-2)}</p></div>
                    </div>
                  </article>

                  {activeRisk.regulations.map((regulation) => (
                    <article key={regulation.regId} className="snap-start rounded-[18px] border border-white/10 bg-white/[0.07] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{regulation.market} · {regulation.code}</p>
                          <p className="mt-1 text-xs font-medium text-white/58">{regulation.name}</p>
                        </div>
                        <a href={regulation.sourceUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-[#2b8299]">{copy.result.source}</a>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-white/55">{regulation.summary}</p>
                    </article>
                  ))}

                  <article className="snap-start rounded-[18px] border border-[rgba(62,172,194,0.25)] bg-[rgba(217,248,250,0.14)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2d7b90]">{locale === "zh" ? "下一步整改" : "Next action"}</p>
                    <p className="mt-2 text-sm leading-6 text-white/68">{activeRisk.recommendedAction}</p>
                  </article>

                  <article className="snap-start rounded-[18px] border border-white/10 bg-white/[0.07] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2d7b90]">{locale === "zh" ? "利润影响" : "Margin impact"}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "总整改预算" : "Fix budget"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{financialSummary.complianceCost}</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "整改后净利" : "Post-fix net"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{financialSummary.trueNetProfit}</p></div>
                    </div>
                  </article>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-[linear-gradient(180deg,transparent,rgba(176,221,240,0.8))]" />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/46">
                <span>{locale === "zh" ? "向上滑动查看更多风险详情" : "Swipe up for more risk details"}</span>
                <span className="font-mono">{String(activeRisk.regulations.length + 4).padStart(2, "0")} {locale === "zh" ? "张卡片" : "cards"}</span>
              </div>
            </article>
          </div>

          <section className="mt-6 border-t border-white/10 pt-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <SectionEyebrow>{locale === "zh" ? "全部风险" : "All risks"}</SectionEyebrow>
                <h3 className="mt-2 text-xl font-semibold text-white">{copy.result.riskOverview}</h3>
              </div>
              <p className="text-xs text-white/44">{locale === "zh" ? "选择风险卡片可同步图中定位与法规详情" : "Select a risk to sync its location and citations"}</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {result.riskPoints.map((riskRaw) => {
                const risk = localizeRiskPoint(locale, riskRaw);
                const isActive = riskRaw.riskId === activeRiskRaw.riskId;
                return (
                  <button
                    type="button"
                    onClick={() => setSelectedRiskId(riskRaw.riskId)}
                    key={riskRaw.riskId}
                    className={`flex min-h-28 w-full flex-col rounded-[20px] border p-4 text-left transition ${
                      isActive
                        ? "border-[rgba(74,190,204,0.46)] bg-[rgba(210,247,249,0.18)] shadow-[0_12px_30px_rgba(25,104,129,0.08)]"
                        : "border-white/10 bg-white/[0.045] hover:border-white/20 hover:bg-white/[0.075]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className={cn("flex size-8 items-center justify-center rounded-full border", severityClass(risk.severity))}>
                        <CircleAlert className="size-4" />
                      </span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", severityClass(risk.severity))}>{severityLabel(locale, risk.severity)}</span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm font-semibold text-white">{risk.title}</p>
                    <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                      <span className="truncate text-[11px] text-white/45">{risk.regulations.map((item) => `${item.market} · ${item.code}`).join(" / ")}</span>
                      <span className="shrink-0 font-mono text-xs font-semibold text-[#24839b]">{risk.estimatedFixCost ?? copy.result.unknownCost}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </section>

        <section id="compliance-report" className="blaze-panel p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <SectionEyebrow>{locale === "zh" ? "STEP 02.5 · 合规扫描报告全文" : "STEP 02.5 · Full compliance report"}</SectionEyebrow>
              <h2 className="mt-3 text-3xl font-semibold text-white">
                {locale === "zh" ? "完整合规扫描报告(可下载 PDF / DOCX)" : "Full compliance scan (PDF / DOCX download)"}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/58">
                {locale === "zh"
                  ? "以下报告由合规扫描引擎生成,涵盖核心结论、法规引用、整改动作与责任方。可直接导出 PDF 给业务/法务/供应商。"
                  : "Generated by the compliance engine. Covers headline, citations, remediation, and owners. Export to PDF for business / legal / supplier teams."}
              </p>
            </div>
            <GlowPill>{locale === "zh" ? "导出 PDF / DOCX" : "PDF / DOCX"}</GlowPill>
          </div>
          <div className="mt-5">
            <ComplianceReportView result={complianceView} />
          </div>
        </section>

        <section id="action" className="grid gap-6 overflow-hidden lg:grid-cols-[1fr_1fr]">
          <div className="blaze-panel flex min-w-0 flex-col overflow-hidden p-6 sm:p-7">
            <SectionEyebrow>Roadmap</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold text-white">{copy.result.roadmap}</h2>
            <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.05]">
              {[
                { label: locale === "zh" ? "执行阶段" : "Phases", value: String(roadmapRows.length) },
                { label: locale === "zh" ? "预计周期" : "Timeline", value: locale === "zh" ? "2周" : "2 wks" },
                { label: locale === "zh" ? "参与角色" : "Owners", value: String(new Set(roadmapRows.flatMap((row) => row.owner.split(" / "))).size) },
              ].map((metric) => (
                <div key={metric.label} className="border-r border-white/10 px-3 py-3 text-center last:border-r-0">
                  <p className="text-[11px] text-white/42">{metric.label}</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-white">{metric.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 overflow-x-auto rounded-[24px] border border-white/8">
              <table className="w-full text-left text-sm text-white/68">
                <thead className="bg-white/6 text-white/42">
                  <tr>
                    {copy.result.roadmapHeaders.map((header, headerIndex) => (
                      <th
                        key={header}
                        className={`px-4 py-3 font-medium ${headerIndex === 2 ? "hidden sm:table-cell" : ""}`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roadmapRows.map((row) => (
                    <tr key={row.phase} className="border-t border-white/8">
                      <td className="px-4 py-3 text-white">{row.phase}</td>
                      <td className="px-4 py-3">{row.time}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">{row.owner}</td>
                      <td className="px-4 py-3">{row.output}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 rounded-[22px] border border-[rgba(58,169,190,0.22)] bg-[rgba(211,247,249,0.12)] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">{locale === "zh" ? "当前执行重点" : "Current priority"}</p>
                <span className="rounded-full border border-white/10 bg-white/7 px-2.5 py-1 text-[10px] text-white/50">01 / {String(roadmapRows.length).padStart(2, "0")}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-white/62">{activeRisk.recommendedAction}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <GlowPill>{roadmapRows[0]?.time}</GlowPill>
                <GlowPill>{roadmapRows[0]?.owner}</GlowPill>
              </div>
            </div>

          </div>

          <div id="reports" className="blaze-panel p-6 sm:p-7">
            <SectionEyebrow>Export</SectionEyebrow>
            <h2 className="mt-3 text-2xl font-semibold text-white">{copy.result.export}</h2>
            <p className="mt-4 text-sm leading-7 text-white/60">{copy.result.exportBody}</p>

            <div className="mt-6 grid gap-4">
              {blazeReportFiles.map((file) => (
                <article key={file.name} className="rounded-[22px] border border-white/10 bg-white/[0.06] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-2xl border border-[rgba(77,195,207,0.25)] bg-[rgba(207,247,249,0.14)] text-[#2d8298]">
                        {file.reportType === "roadmap" ? <FileStack className="size-5" /> : <Download className="size-5" />}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {locale === "zh"
                            ? file.label
                            : file.reportType === "compliance"
                              ? "Compliance report"
                              : file.reportType === "roadmap"
                                ? "Compliance roadmap"
                                : "Cost impact report"}
                        </p>
                        <p className="mt-1 text-xs text-white/45">{copy.result.exportSupport}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {file.formats.map((format) => (
                        <ResultExportButton
                          key={`${file.reportType}-${format}`}
                          result={result}
                          reportType={file.reportType}
                          format={format}
                          locale={locale}
                          presetKey={isDemoSession ? (presetKey as "charger" | "humidifier" | "toy") : undefined}
                        />
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <details id="report-previews" className="blaze-panel group p-6 sm:p-7">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
            <div>
              <SectionEyebrow>{locale === "zh" ? "可选查看" : "Optional preview"}</SectionEyebrow>
              <h2 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">{copy.result.preview}</h2>
            </div>
            <GlowPill>{locale === "zh" ? "展开报告样张" : "Open report sample"}</GlowPill>
          </summary>

          <Tabs defaultValue={blazeReportPreviewTabs[0].value} className="mt-6">
            <TabsList
              variant="line"
              className="w-full max-w-full justify-start overflow-x-auto rounded-full border border-white/8 bg-white/4 p-1 [scrollbar-width:none] sm:w-fit [&::-webkit-scrollbar]:hidden"
            >
              {blazeReportPreviewTabs.map((tab) => {
                const localized = getLocalizedPreviewTab(locale, tab.value);
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="flex-none rounded-full px-3 py-2 text-xs text-white/55 data-active:bg-white/8 data-active:text-white after:hidden sm:px-4 sm:text-sm"
                  >
                    {localized.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {blazeReportPreviewTabs.map((tab) => {
              const localized = getLocalizedPreviewTab(locale, tab.value);
              const previewBullets = getPreviewBullets(locale, tab.value, result, financialSummary);
              return (
                <TabsContent key={tab.value} value={tab.value} className="mt-5">
                  <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-3">
                      <article className="blaze-panel-soft min-h-32 p-5">
                        <p className="text-sm font-semibold text-white">{copy.result.reportUse}</p>
                        <p className="mt-2 text-sm leading-6 text-white/60">
                          {locale === "zh"
                            ? tab.value === "roadmap"
                              ? "用于对齐产品、设计、法务与实验室的执行顺序。"
                              : tab.value === "profit"
                                ? "用于解释利润变化，以及为什么需要先整改再上架。"
                                : "用于第一次风险同步，让业务、法务和供应商快速对齐。"
                            : tab.value === "roadmap"
                              ? "Align product, design, legal, and lab work in one sequence."
                              : tab.value === "profit"
                                ? "Explain margin changes and why remediation precedes launch."
                                : "Align business, legal, and suppliers for the first risk review."}
                        </p>
                      </article>
                      <article className="blaze-panel-soft min-h-32 p-5">
                        <p className="text-sm font-semibold text-white">{copy.result.deliveryFit}</p>
                        <p className="mt-2 text-sm leading-6 text-white/60">
                          {locale === "zh"
                            ? "样张保留标题、指标、关键发现与整改建议，导出前即可完成内容复核。"
                            : "Review titles, metrics, findings, and fixes before export."}
                        </p>
                      </article>
                      <article className="blaze-panel-soft min-h-32 p-5">
                        <p className="text-sm font-semibold text-white">{copy.result.liveExport}</p>
                        <p className="mt-2 text-sm leading-6 text-white/60">
                          {locale === "zh"
                            ? "支持 PDF、DOCX、Markdown 或 CSV，分别交付法务、运营与供应商。"
                            : "Export PDF, DOCX, Markdown, or CSV for legal, operations, and suppliers."}
                        </p>
                      </article>
                    </div>

                    <article className="overflow-hidden rounded-[28px] border border-[#d9e8fb] bg-[#f7fbff] text-[#1c2536] shadow-[0_18px_45px_rgba(4,18,45,0.12)]">
                      <div data-flow-dark className="bg-[#101b31] px-6 py-6 text-white">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--blaze-orange)]">
                              规航AI · CompliPilot
                            </p>
                            <h3 className="mt-4 text-2xl font-semibold text-white">
                              {localized.title}
                            </h3>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#dfe9ff]">
                              {displayProductName} ·{" "}
                              {locale === "zh" ? "目标市场" : "Target markets"}:{" "}
                              {result.targetMarkets.join(" / ")}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/7 px-4 py-3 text-right">
                            <p className="text-xs uppercase tracking-[0.18em] text-white/44">
                              {copy.result.generated}
                            </p>
                            <p className="mt-2 text-sm font-medium text-white">
                              {result.generatedAt.slice(0, 10)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="p-6">
                        <div className="grid overflow-hidden rounded-[22px] border border-[#d7e5f7] bg-[#edf4fb] sm:grid-cols-4">
                          {[
                            {
                              label: locale === "zh" ? "合规得分" : "Compliance score",
                              value: `${result.complianceScore} / ${result.scoreGrade}`,
                            },
                            {
                              label: locale === "zh" ? "真实净利" : "True net profit",
                              value: financialSummary.trueNetProfit,
                            },
                            {
                              label: locale === "zh" ? "合规成本" : "Compliance cost",
                              value: financialSummary.complianceCost,
                            },
                            {
                              label: locale === "zh" ? "月度风险敞口" : "Monthly exposure",
                              value: financialSummary.monthlyNetProfit,
                            },
                          ].map((metric) => (
                            <div key={metric.label} className="border-[#d7e5f7] px-4 py-4 text-center sm:border-r sm:last:border-r-0">
                              <p className="text-xs font-medium text-[#667693]">{metric.label}</p>
                              <p className="mt-2 text-lg font-semibold text-[#20345d]">{metric.value}</p>
                            </div>
                          ))}
                        </div>

                        <div className="mt-6 grid gap-5 lg:grid-cols-[0.86fr_1.14fr]">
                          <div>
                            <p className="text-sm font-semibold text-[#233252]">{copy.result.findings}</p>
                            <div className="mt-3 space-y-3">
                              {previewBullets.map((bullet) => (
                                <div
                                  key={bullet}
                                  className="rounded-[16px] border border-[#e0eaf8] bg-white px-4 py-3 text-sm leading-6 text-[#4f5e7e]"
                                >
                                  {bullet}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="overflow-hidden rounded-[18px] border border-[#d7e5f7] bg-white">
                            <div>
                              <div className="grid grid-cols-[1.4fr_0.6fr_0.8fr] bg-[#eaf2fc] px-4 py-3 text-xs font-semibold text-[#233252]">
                                <span>{locale === "zh" ? "风险点" : "Risk"}</span>
                                <span>{locale === "zh" ? "置信度" : "Conf."}</span>
                                <span>{locale === "zh" ? "成本" : "Cost"}</span>
                              </div>
                              {result.riskPoints.slice(0, 3).map((riskRaw) => {
                                const risk = localizeRiskPoint(locale, riskRaw);
                                return (
                                  <button
                                    key={riskRaw.riskId}
                                    type="button"
                                    onClick={() => setSelectedRiskId(riskRaw.riskId)}
                                    className="grid w-full grid-cols-[1.4fr_0.6fr_0.8fr] border-t border-[#e2ebf8] px-4 py-3 text-left text-sm text-[#40506d] transition hover:bg-[#f7fbff]"
                                  >
                                    <span className="truncate font-medium text-[#20345d]">{risk.title}</span>
                                    <span>{Math.round(risk.confidence * 100)}%</span>
                                    <span>{risk.estimatedFixCost ?? copy.result.unknownCost}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[#d7e5f7] bg-white px-4 py-3">
                          <p className="text-sm text-[#4f5e7e]">
                            {locale === "zh"
                              ? "同一份分析可导出为 PDF / DOCX / Markdown / CSV。"
                              : "The same analysis exports to PDF / DOCX / Markdown / CSV."}
                          </p>
                          <div className="flex gap-2 text-xs font-semibold text-[#20345d]">
                            {["PDF", "DOCX", tab.value === "roadmap" ? "CSV" : "MD"].map((format) => (
                              <span key={format} className="rounded-full border border-[#d7e5f7] bg-[#f4f8fd] px-3 py-1">
                                {format}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </article>

                  </div>
                </TabsContent>
              );
            })}
          </Tabs>
        </details>
      </section>
        <CompliPilotFlowFooter sessionId={sessionId} tone="bright" />
      </div>
    </main>
  );
}

