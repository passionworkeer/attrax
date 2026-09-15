"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
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
import { cn } from "@/lib/utils";
import { ComplianceReportView } from "@/components/result/ComplianceReportView";
import { DegradedBanner } from "@/components/result/DegradedBanner";
import { FallbackNotice } from "@/components/result/FallbackNotice";
import { FloatingEvidenceCrop } from "@/components/result/FloatingEvidenceCrop";
import { HotspotLayer, isRenderableBbox } from "@/components/result/HotspotLayer";
import { InspectionChecklistPanel } from "@/components/result/InspectionChecklistPanel";
import { ObservationHotspotLayer } from "@/components/result/ObservationHotspotLayer";
import { EvidenceRequestPanel } from "@/components/result/EvidenceRequestPanel";
import { SourceNotice } from "@/components/result/SourceNotice";
import { ResultExportButton } from "./result-export-button";
import { useResultLoader } from "./use-result-loader";
import { ResultIncompletePanel, ResultLoadingPanel } from "./result-state-panels";
import { synthesizeFinancialSummaryIfMissing } from "@/lib/pipeline/profit-report";
import {
  buildDemoPresetResult,
  buildRoadmapRows,
  computeEvidenceCoverage,
  financialSummaryOrFallback,
  scanResultToComplianceView,
  scanResultToRealComplianceView,
  severityClass,
  severityLabel,
  productCategoryLabel,
  localizeRiskPoint,
  getLocalizedPreviewTab,
  getPreviewBullets,
} from "@/lib/result-view-helpers";
import {
  buildInspectionResultViewModel,
  type InspectionResultVM,
} from "@/lib/result/inspection-view-model";
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
export default function ResultPage() {
  const params = useParams<{ sessionId: string }>();
  const search = useSearchParams();
  const { locale } = useBlazeLocale();
  const copy = getCompliPilotCopy(locale);
  const sessionId = params.sessionId;
  const isDemoSession = sessionId === "demo";
  const demoResult = isDemoSession ? buildDemoPresetResult(search) : null;
  const {
    result,
    degradedReason,
    message,
    selectedRiskId,
    setSelectedRiskId,
  } = useResultLoader({
    sessionId,
    isDemoSession,
    locale,
    initialResult: demoResult,
    loadingMessage: copy.result.loadingMessage,
    copy: {
      failed: copy.result.failed,
      loaded: copy.result.loaded,
      notFound: copy.result.notFound,
      processing: copy.result.processing,
      restored: copy.result.restored,
    },
  });
  const displayMessage = message;

  // ── Hooks: all before the early returns below (React rules-of-hooks —
  // the loading → loaded transition must not change the hook count). ──
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  // Plan 2026-09-14 §4.3 (J03): observation-selection linkage. Clicking a
  // checklist row / finding card selects the located observation, which the
  // image stage highlights via <ObservationHotspotLayer>.
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null);
  // Audit 2026-09-13 P1-2: the canvas used to force a fixed 4:3 box with
  // object-cover, which crops the photo and breaks percentage-anchored
  // hotspots. We now capture the image's natural dimensions onLoad and
  // adopt its intrinsic aspect ratio (plan §8.1 layout 1) — cover==contain
  // at that point, no cropping, boxes land where the model put them.
  // object-contain is the pre-load safety net: letterboxing beats cropping.
  const [canvasImageSize, setCanvasImageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const derivedResultImages = result?.images ?? [];
  // J03: when the checklist layer produced located observations, prefer the
  // first anchored image over "first risk's image" so checklist-mode scans
  // (zero riskPoints) open on a photo that actually carries a hotspot.
  const firstAnchoredObservationImageId =
    result?.inspectionFindings?.find(
      (finding) => finding.observationIds.length > 0,
    )?.observationIds
      .map((id) => result?.inspectionObservations?.find((obs) => obs.observationId === id))
      .find((obs) => obs?.region?.bbox && obs.imageId)?.imageId ?? null;
  const derivedAnchorImageId =
    selectedImageId ??
    result?.riskPoints.find((item) => item.severity === "critical")?.imageId ??
    firstAnchoredObservationImageId ??
    derivedResultImages[0]?.imageId ??
    null;
  // Reset intrinsic-ratio tracking when the displayed photo changes so a
  // 4:3 → 16:9 switch doesn't briefly render the new image letterboxed
  // against the old ratio. Derived state during render (React's documented
  // "adjust state when a prop changes" pattern): the captured size belongs
  // to the *previous* image until the new <img> onLoad fires.
  const [sizedForImage, setSizedForImage] = useState<string | null>(null);
  if (sizedForImage !== derivedAnchorImageId) {
    setSizedForImage(derivedAnchorImageId);
    setCanvasImageSize(null);
  }
  const canvasAspectRatio = canvasImageSize
    ? `${canvasImageSize.width} / ${canvasImageSize.height}`
    : "4 / 3";

  if (!result) {
    return <ResultLoadingPanel locale={locale} displayMessage={displayMessage} />;
  }

  // A scan is only "incomplete" when it produced NOTHING renderable.
  // Plan 2026-09-13 §1: "真实问题可以是零个" — with the pipeline-stage
  // nodes no longer promoted to risks, a clean scan legitimately has
  // zero riskPoints; when the checklist/findings layer exists, the page
  // renders normally (observations + 待补拍/待补资料 carry the value).
  const hasFindingsLayer =
    (result.inspectionObservations?.length ?? 0) > 0 ||
    (result.inspectionFindings?.length ?? 0) > 0;
  if (result.riskPoints.length === 0 && !hasFindingsLayer) {
    return (
      <ResultIncompletePanel
        locale={locale}
        displayMessage={displayMessage}
        degradedReason={degradedReason}
        result={result}
      />
    );
  }

  const criticalCount = result.riskPoints.filter((item) => item.severity === "critical").length;
  // Plan 2026-09-14 §4.3 (J03/J15) — the unified result ViewModel. Built for
  // every result; the checklist panel, observation hotspots and the
  // evidence-request block all consume THIS single join (finding →
  // observationIds → imageId/region), so the list, the image stage and the
  // summary can never drift apart.
  const inspectionVM: InspectionResultVM = buildInspectionResultViewModel({
    result,
    sessionId,
  });
  // Same synthesis path as /profit/[sessionId]: real backend RAG responses
  // carry profit data only in reportPackage.profitReport.markdown.
  const financialSummary = financialSummaryOrFallback(result, locale, synthesizeFinancialSummaryIfMissing);
  const evidenceCoverage = computeEvidenceCoverage(result);
  const coverageLabel =
    evidenceCoverage.totalFindings === 0
      ? locale === "zh" ? "—" : "—"
      : `${Math.round(evidenceCoverage.ratio * 100)}%`;
  const coverageWidth = `${Math.round(evidenceCoverage.ratio * 100)}%`;
  const complianceView = isDemoSession
    ? scanResultToComplianceView(result, locale)
    : scanResultToRealComplianceView(result);
  const critical = result.riskPoints.find((item) => item.severity === "critical");
  const activeRiskRaw =
    result.riskPoints.find((item) => item.riskId === selectedRiskId) ??
    critical ??
    result.riskPoints[0];
  // Zero-risk scans (plan §1: 真实问题可以是零个) have no active risk;
  // the risk-specific blocks render neutral empty states instead.
  const noRisks = !activeRiskRaw;
  const activeRisk = activeRiskRaw ? localizeRiskPoint(locale, activeRiskRaw) : null;
  const resultImages = result.images;
  const explicitImage = selectedImageId
    ? resultImages.find((item) => item.imageId === selectedImageId) ?? null
    : null;
  const anchorId =
    selectedImageId ?? activeRiskRaw?.imageId ?? firstAnchoredObservationImageId ?? resultImages[0]?.imageId;
  const riskImage =
    explicitImage ??
    resultImages.find((item) => item.imageId === anchorId) ?? resultImages[0] ?? null;
  const riskCanvasImage = riskImage;
  // Feature 1 (2.5D hotspots): risks whose vision-anchored bbox actually
  // points somewhere render as flat evidence frames via <HotspotLayer>;
  // the rest keep the legacy circular pins (fallback for scans without
  // vision data — including legacy/demo payloads).
  //
  // Audit 2026-09-13 P1-1: hotspots now also filter by `imageId`. Risks
  // emitted for image #2 used to draw their bbox on image #1 just because
  // the page defaulted to the first image. We render only the hotspots
  // that match the displayed image's id (or that have no imageId at all,
  // which is the legacy demo / fallback shape).
  const displayedImageId = riskImage?.imageId ?? null;
  // J03 (plan §4.3): the observation-driven anchors for the currently
  // displayed image. Only observations with a real region land in the VM's
  // anchor set — ungrounded document gaps stay in the checklist list, never
  // on the photo.
  const observationAnchors = displayedImageId
    ? inspectionVM.anchorsByImage[displayedImageId] ?? []
    : [];
  const locatedHotspots = result.riskPoints
    .filter((risk) => isRenderableBbox(risk.bbox))
    .filter((risk) => !risk.imageId || !displayedImageId || risk.imageId === displayedImageId)
    .map((risk) => ({
      id: risk.riskId,
      label: localizeRiskPoint(locale, risk).title,
      severity: risk.severity === "critical" ? ("critical" as const) : risk.severity === "warning" ? ("warning" as const) : ("info" as const),
      bbox: risk.bbox,
      regulationRef: risk.regulations[0]?.regId ?? null,
    }));
  const unlocatedRisks = result.riskPoints.filter(
    (risk) => !isRenderableBbox(risk.bbox),
  );
  // Pin display: same imageId rule applies. Risks without imageId (legacy
  // shape) keep the previous top-edge spread behavior for backwards
  // compatibility — only risks that target a different image get filtered
  // out of the pin strip.
  const pinnedRisks = unlocatedRisks.filter(
    (risk) => !risk.imageId || !displayedImageId || risk.imageId === displayedImageId,
  );
  // J11 (plan §4.3): never render an empty h1 / "undefined". The VM runs the
  // documented fallback chain (结构化产品名 → dossier → 类别 label +
  // 待确认型号); the legacy inline chain stays for the demo path where the
  // mock's localized fields read better.
  const rawProductName =
    locale === "en" ? result.productNameEn ?? result.productName : result.productName;
  const legacyProductFallback =
    locale === "en"
      ? `${productCategoryLabel(locale, result.productCategory)} (model TBD)`
      : `${productCategoryLabel(locale, result.productCategory)}（型号待确认）`;
  const displayProductName = isDemoSession
    ? rawProductName?.trim() || legacyProductFallback
    : rawProductName?.trim() ||
      inspectionVM.product.title ||
      legacyProductFallback;
  const displayProductCategory = productCategoryLabel(locale, result.productCategory);
  const roadmapRows = buildRoadmapRows(result, locale, copy.result.unknownTime);

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
        <DegradedBanner
          source={result.source}
          degradedReason={degradedReason ?? undefined}
          showProfitNotice={result.source === "fallback"}
        />
        <FallbackNotice
          validationStatus={result.reportPackage?.auditMetadata?.validationStatus}
        />
        <SourceNotice source={result.source} />
        <section id="overview" className="blaze-panel overflow-hidden p-5 sm:p-7">
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-stretch">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <SectionEyebrow>{locale === "zh" ? "STEP 01 · 先看结论" : "STEP 01 · Verdict"}</SectionEyebrow>
                <span className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  criticalCount > 0
                    ? severityClass("critical")
                    : (result.source === "fallback" ||
                       result.reportPackage?.auditMetadata?.validationStatus === "invalid" ||
                       result.reportPackage?.auditMetadata?.validationStatus === "fallback")
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : noRisks
                      ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
                      : severityClass(activeRisk!.severity)
                )}>
                  {criticalCount > 0
                    ? locale === "zh" ? "暂缓上架" : "Hold launch"
                    : (result.source === "fallback" ||
                       result.reportPackage?.auditMetadata?.validationStatus === "invalid" ||
                       result.reportPackage?.auditMetadata?.validationStatus === "fallback")
                    ? locale === "zh" ? "待人工核验" : "Needs verification"
                    : noRisks
                      ? inspectionVM.summary.observationOnly
                        ? locale === "zh" ? "观察模式" : "Observation mode"
                        : locale === "zh" ? "未发现可定位风险" : "No located risks"
                      : locale === "zh" ? "可进入复核" : "Ready for review"}
                </span>
              </div>
              <h1 className="mt-4 text-4xl font-semibold leading-tight text-white sm:text-5xl">{displayProductName}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/62">
                {locale === "zh"
                  ? criticalCount > 0
                    ? `已完成 ${result.images?.length ?? 0} 张图片分析。先处理 ${criticalCount} 个高危风险，再进入 ${(result.targetMarkets ?? []).join(" / ")} 市场上架复核。`
                    : inspectionVM.findings.length > 0
                      ? `已完成 ${result.images?.length ?? 0} 张图片分析。当前无高危阻断项，建议核对下方 ${inspectionVM.findings.length} 项待办后再进入 ${(result.targetMarkets ?? []).join(" / ")} 市场上架复核。`
                      : `已完成 ${result.images?.length ?? 0} 张图片分析，未发现阻断性合规风险，可直接进入 ${(result.targetMarkets ?? []).join(" / ")} 市场上架复核。`
                  : criticalCount > 0
                    ? `${result.images?.length ?? 0} images analyzed. Close ${criticalCount} critical risks before ${(result.targetMarkets ?? []).join(" / ")} launch review.`
                    : inspectionVM.findings.length > 0
                      ? `${result.images?.length ?? 0} images analyzed. No critical blockers; resolve ${inspectionVM.findings.length} findings before ${(result.targetMarkets ?? []).join(" / ")} launch review.`
                      : `${result.images?.length ?? 0} images analyzed. Ready for ${(result.targetMarkets ?? []).join(" / ")} launch review.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {(result.targetMarkets ?? []).map((market) => <GlowPill key={market}>{market} {copy.result.marketSuffix}</GlowPill>)}
                <GlowPill>{displayProductCategory}</GlowPill>
                {/* J03: zero-riskPoint checklist scans show the VM finding
                    count instead of a hard 0 热点 badge. */}
                <GlowPill>
                  {(result.riskPoints?.length ?? 0) > 0
                    ? `${result.riskPoints.length} ${copy.result.hotspotsCountSuffix}`
                    : inspectionVM.findings.length > 0
                      ? locale === "zh"
                        ? `${inspectionVM.findings.length} 项待办`
                        : `${inspectionVM.findings.length} findings`
                      : inspectionVM.summary.observationCount > 0
                        ? locale === "zh"
                          ? `${inspectionVM.summary.observationCount} 项观察`
                          : `${inspectionVM.summary.observationCount} observations`
                        : `0 ${copy.result.hotspotsCountSuffix}`}
                </GlowPill>
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
              {noRisks ? (
                <>
                  <h2 className="mt-4 text-2xl font-semibold leading-snug text-white">
                    {inspectionVM.summary.observationOnly
                      ? locale === "zh"
                        ? "观察模式：本次检查未产生问题项"
                        : "Observation mode: no issues from this scan"
                      : locale === "zh"
                        ? "本次扫描未发现可定位风险点"
                        : "No locatable risk found in this scan"}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-white/60">
                    {inspectionVM.summary.observationOnly
                      ? locale === "zh"
                        ? `共记录 ${inspectionVM.summary.observationCount} 项观察。已观察不等于合规通过——检查清单仍是逐项判断依据，未入镜的检查项需补拍后再下结论。`
                        : `${inspectionVM.summary.observationCount} observations recorded. Observed ≠ compliant — the checklist remains the per-check basis; off-photo checks need reshoots before a verdict.`
                      : locale === "zh"
                        ? "未发现风险不等于合规完成：下方检查清单里的「待补拍 / 待补资料」项仍需补齐后再做上架判断。"
                        : "No located risks ≠ compliant: complete the reshoot / material items in the checklist below before the launch decision."}
                  </p>
                  <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.055] p-4">
                    <p className="text-xs text-white/42">{locale === "zh" ? "建议动作" : "Recommended action"}</p>
                    <p className="mt-2 text-sm leading-6 text-white/72">
                      {inspectionVM.evidenceRequests[0]?.explanation ||
                        inspectionVM.findings[0]?.suggestedAction ||
                        (locale === "zh" ? "按检查清单补齐证据后重新扫描。" : "Gather the listed evidence and rescan.")}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="mt-4 text-2xl font-semibold leading-snug text-white">{activeRisk!.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-white/60">{activeRisk!.description}</p>
                  <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.055] p-4">
                    <p className="text-xs text-white/42">{locale === "zh" ? "建议动作" : "Recommended action"}</p>
                    <p className="mt-2 text-sm leading-6 text-white/72">{activeRisk!.recommendedAction}</p>
                  </div>
                </>
              )}
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
          {/*
            Profit impact summary lives in its own section AFTER #action (roadmap +
            export), so the verdict and hotspot-driven evidence get the user's
            attention first. The legacy in-overview strip (with its hard-coded
            ¥180万/day fine ceiling — J07) was removed; the summary now renders in
            #profit-impact without invented fine numbers. The full cost-breakdown
            panel remains on /profit/[sessionId].
          */}
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
                <span>
                  {locale === "zh"
                    ? `风险证据完整度（${evidenceCoverage.coveredFindings}/${evidenceCoverage.totalFindings}）`
                    : `Evidence coverage (${evidenceCoverage.coveredFindings}/${evidenceCoverage.totalFindings})`}
                </span>
                <span>{coverageLabel}</span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#76eadf,#54bde0)] shadow-[0_0_12px_rgba(93,224,220,0.35)]"
                  style={{ width: coverageWidth }}
                />
              </div>
              <p className="mt-2 text-[11px] text-white/40">
                {evidenceCoverage.totalCitations > 0
                  ? locale === "zh"
                    ? `${evidenceCoverage.matchedCitations}/${evidenceCoverage.totalCitations} 条引用已逐字对照原文` +
                      (evidenceCoverage.articleLocatedCount > 0
                        ? `；${evidenceCoverage.articleLocatedCount} 条已定位条款但未逐字核验`
                        : "")
                    : `${evidenceCoverage.matchedCitations}/${evidenceCoverage.totalCitations} citations verified verbatim against the source text` +
                      (evidenceCoverage.articleLocatedCount > 0
                        ? `; ${evidenceCoverage.articleLocatedCount} located the article but not verified verbatim`
                        : "")
                  : locale === "zh"
                    ? "本次扫描未提供结构化引用"
                    : "No structured citations in this scan"}
              </p>
            </div>
          </div>

          <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_400px]">
            <div className="mt-5 overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(117,222,230,0.12),rgba(74,135,198,0.12))] p-3 sm:p-4">
              {resultImages.length > 1 ? (
                <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-white/44">
                    {locale === "zh" ? "查看图片" : "Inspect image"}
                  </span>
                  {resultImages.map((image, index) => {
                    const isActive = image.imageId === (riskImage?.imageId ?? null);
                    const findingsHere = result.riskPoints.filter(
                      (risk) => risk.imageId === image.imageId,
                    ).length;
                    // J03: show the observation-anchor count (VM join) when
                    // the legacy riskPoints count is zero — the badge must
                    // still tell the user which photo carries evidence.
                    const anchorsHere =
                      inspectionVM.anchorsByImage[image.imageId]?.length ?? 0;
                    const badgeCount = findingsHere > 0 ? findingsHere : anchorsHere;
                    return (
                      <button
                        key={image.imageId}
                        type="button"
                        onClick={() => setSelectedImageId(image.imageId)}
                        aria-pressed={isActive}
                        aria-label={`${image.fileName ?? `Image ${index + 1}`} — ${badgeCount} findings`}
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition ${
                          isActive
                            ? "border-[rgba(102,224,226,0.65)] bg-[rgba(207,247,249,0.92)] text-[#155b70]"
                            : "border-white/10 bg-white/[0.045] text-white/72 hover:border-white/30 hover:bg-white/[0.085]"
                        }`}
                      >
                        <span
                          className="inline-block size-6 shrink-0 rounded-md bg-cover bg-center"
                          style={{ backgroundImage: `url(${image.thumbnail ?? image.url})` }}
                          aria-hidden
                        />
                        <span className="font-mono">#{index + 1}</span>
                        <span className="text-[10px] opacity-70">
                          {badgeCount}
                          {locale === "zh" ? " 项" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div
                data-flow-dark
                className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[#10243d]"
                style={{ aspectRatio: canvasAspectRatio }}
              >
                {riskCanvasImage ? (
                  <Image
                    src={riskCanvasImage.url}
                    alt={displayProductName ?? "Product risk canvas"}
                    fill
                    sizes="(min-width: 1280px) 62vw, (min-width: 768px) 92vw, 94vw"
                    className="object-contain"
                    priority
                    unoptimized={riskCanvasImage.url.startsWith("/api/")}
                    onLoad={(event) => {
                      const element = event.currentTarget;
                      if (element.naturalWidth > 0 && element.naturalHeight > 0) {
                        setCanvasImageSize({
                          width: element.naturalWidth,
                          height: element.naturalHeight,
                        });
                      }
                    }}
                  />
                ) : null}

                {/* Cost labels are pinned to the bbox of the matching risk
                    (audit 2026-09-13 P1-4). The legacy version dropped
                    these tags at three fixed canvas positions regardless
                    of where the risk actually was on the photo, which
                    made the chips look like real "findings" on the image.
                    Now: tag sits just above the bbox (or just below if
                    there's no room near the top), and is hidden when the
                    risk has no renderable bbox — those risks surface via
                    the unlocated pin strip / card list instead. */}
                {result.riskPoints
                  .filter((risk) => risk.estimatedFixCost && isRenderableBbox(risk.bbox))
                  .filter((risk) => !risk.imageId || !displayedImageId || risk.imageId === displayedImageId)
                  .slice(0, 3)
                  .map((riskRaw) => {
                    const bbox = riskRaw.bbox!;
                    const above = bbox.y > 0.12;
                    const left = `${Math.min(85, Math.max(0, bbox.x * 100))}%`;
                    const top = above
                      ? `calc(${bbox.y * 100}% - 24px)`
                      : `calc(${(bbox.y + bbox.h) * 100}% + 6px)`;
                    return (
                      <div
                        key={`cost-tag-${riskRaw.riskId}`}
                        className="absolute hidden items-center gap-1.5 rounded-full border border-[rgba(102,224,226,0.46)] bg-[rgba(238,252,255,0.9)] px-2.5 py-1.5 font-mono text-[11px] font-semibold text-[#155b70] shadow-[0_10px_30px_rgba(5,48,70,0.14)] backdrop-blur-md sm:flex"
                        style={{ left, top }}
                      >
                        <CircleDollarSign className="size-3.5" />
                        {riskRaw.estimatedFixCost}
                      </div>
                    );
                  })}

                {/* Feature 1: vision-anchored risks render as flat evidence
                    frames; clicking a severity chip jumps to the
                    corresponding risk card below. */}
                <HotspotLayer
                  hotspots={locatedHotspots}
                  activeId={selectedRiskId}
                  onHotspotClick={(id) => setSelectedRiskId(id)}
                  localizedLabel={(severity) =>
                    severity === "critical"
                      ? locale === "zh" ? "高危" : "Critical"
                      : severity === "warning"
                        ? locale === "zh" ? "警告" : "Warning"
                        : severity === "info"
                          ? locale === "zh" ? "提示" : "Info"
                          : severity
                  }
                  viewDetailLabel={locale === "zh" ? "查看风险详情" : "View risk detail"}
                />

                {/* J03 (plan §4.3): the NEW findings layer drives the image.
                    <ObservationHotspotLayer> draws the checklist-mode
                    observations' normalized regions (finding → observationIds
                    → imageId/region) with numbered chips; clicking a chip
                    selects that observation so the checklist row + hotspot
                    highlight stay in sync. Anchors only exist for
                    region-bearing observations — document gaps never appear
                    as fake hotspots. */}
                <ObservationHotspotLayer
                  anchors={observationAnchors}
                  activeObservationId={selectedObservationId}
                  onAnchorClick={(anchor) => {
                    setSelectedObservationId(anchor.observationId);
                    if (anchor.imageId && anchor.imageId !== displayedImageId) {
                      setSelectedImageId(anchor.imageId);
                    }
                  }}
                  anchorLabel={locale === "zh" ? "观察点" : "Observation"}
                />

                {/* Plan §8.2 capability B — 局部悬浮放大 for the active
                    located risk: a real crop of the same photo, floated
                    beside its hotspot with a leader-line feel. The 2.5D
                    transform lives HERE (on the copied card), not on the
                    evidence frame (audit P1-3). */}
                {activeRiskRaw &&
                riskCanvasImage &&
                isRenderableBbox(activeRiskRaw.bbox) &&
                (!activeRiskRaw.imageId ||
                  !displayedImageId ||
                  activeRiskRaw.imageId === displayedImageId) ? (
                  <FloatingEvidenceCrop
                    imageUrl={riskCanvasImage.url}
                    bbox={activeRiskRaw.bbox}
                    label={activeRisk!.title}
                    locale={locale}
                    unoptimized={riskCanvasImage.url.startsWith("/api/")}
                  />
                ) : null}

                {pinnedRisks.map((riskRaw, riskIndex) => {
                  const risk = localizeRiskPoint(locale, riskRaw);
                  const selected = riskRaw.riskId === activeRiskRaw?.riskId;
                  // Spread unlocated pins across the top edge instead of
                  // stacking them all in the top-left corner (audit P1.7).
                  const spreadLeft = 8 + (riskIndex % 5) * 22;
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
                          ? `clamp(8px, calc(${spreadLeft}% - 8px), calc(100% - 178px))`
                          : `clamp(8px, calc(${spreadLeft}% - 8px), calc(100% - 48px))`,
                        top: selected
                          ? `clamp(8px, calc(12% - 8px), calc(100% - 68px))`
                          : `clamp(8px, calc(12% - 8px), calc(100% - 48px))`,
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
              {noRisks ? (
                <>
                  <h3 className="mt-3 text-2xl font-semibold text-white">
                    {locale === "zh" ? "无可定位的风险详情" : "No located risk detail"}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-white/60">
                    {locale === "zh"
                      ? "本次扫描没有产生带位置的风险点。观察结果与待补项见下方检查清单；补齐所需照片/资料后重新扫描可获得完整风险定位。"
                      : "This scan produced no located risks. See the checklist below for observations and pending evidence; rescan after gathering them."}
                  </p>
                  <div className="mt-5 rounded-[18px] border border-white/10 bg-white/[0.055] p-4">
                    <p className="text-xs text-white/42">{locale === "zh" ? "已观察到（可定位）" : "Observed (located)"}</p>
                    <p className="mt-2 font-mono text-sm text-white">
                      {(result.inspectionObservations ?? []).filter((o) => o.region?.bbox).length}
                      {locale === "zh" ? " 项" : " items"}
                    </p>
                  </div>
                </>
              ) : (
                <>
              <h3 className="mt-3 text-2xl font-semibold text-white">{activeRisk!.title}</h3>
              <p className="mt-3 text-sm leading-7 text-white/60">{activeRisk!.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className={cn("rounded-full border px-3 py-1 text-xs", severityClass(activeRisk!.severity))}>{severityLabel(locale, activeRisk!.severity)}</span>
                <GlowPill>{copy.result.confidence} {Math.round(activeRisk!.confidence * 100)}</GlowPill>
                <GlowPill>{copy.result.flameLevel} {activeRisk!.flameLevel}</GlowPill>
              </div>
              <div className="relative mt-5 overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
                <div className="max-h-[340px] snap-y snap-mandatory space-y-3 overflow-y-auto p-3 pr-2 [scrollbar-color:rgba(91,196,207,0.45)_transparent] [scrollbar-width:thin]">
                  <article className="snap-start rounded-[18px] border border-white/10 bg-white/[0.07] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2d7b90]">{locale === "zh" ? "风险数据" : "Risk metrics"}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "置信度" : "Confidence"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{Math.round(activeRisk!.confidence * 100)}%</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "整改成本" : "Fix cost"}</p><p className="mt-1 font-mono text-sm font-semibold text-white">{activeRisk!.estimatedFixCost ?? copy.result.unknownCost}</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "法规数" : "Citations"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{activeRisk!.regulations.length}</p></div>
                    </div>
                  </article>

                  <article className="snap-start rounded-[18px] border border-white/10 bg-white/[0.07] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2d7b90]">{locale === "zh" ? "证据定位" : "Evidence location"}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "图片" : "Image"}</p><p className="mt-1 truncate font-mono text-xs font-semibold text-white">{activeRiskRaw!.imageId}</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "市场" : "Markets"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{result.targetMarkets.length}</p></div>
                      <div className="rounded-[13px] bg-white/[0.06] p-3"><p className="text-[10px] text-white/40">{locale === "zh" ? "风险编号" : "Risk ID"}</p><p className="mt-1 font-mono text-base font-semibold text-white">{activeRisk!.riskId.slice(-2)}</p></div>
                    </div>
                  </article>

                  {activeRisk!.regulations.map((regulation) => (
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
                    <p className="mt-2 text-sm leading-6 text-white/68">{activeRisk!.recommendedAction}</p>
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
                <span className="font-mono">{String(activeRisk!.regulations.length + 4).padStart(2, "0")} {locale === "zh" ? "张卡片" : "cards"}</span>
              </div>
                </>
              )}
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
                const isActive = riskRaw.riskId === activeRiskRaw?.riskId;
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

        {/* Plan 2026-09-13 §8 — 检查清单在报告与成本之前:先告诉用户
            "哪些检查项有结果、哪些需要补拍",再进入全文报告。
            Plan 2026-09-14 §4.3 (J03/J15): the panel now consumes the
            unified VM. Clicking a located row switches the image stage to
            the observation's image AND highlights its hotspot (selection
            linkage selectedObservationId → ObservationHotspotLayer).
            Renders when observations OR findings exist (findings without
            observations — e.g. deferred-material checks — still matter). */}
        {(result.inspectionObservations?.length ?? 0) > 0 ||
        (result.inspectionFindings?.length ?? 0) > 0 ? (
          <InspectionChecklistPanel
            observations={result.inspectionObservations ?? []}
            selectedCheckIds={result.selectedCheckIds}
            findings={result.inspectionFindings}
            locale={locale}
            vm={inspectionVM}
            activeImageId={riskImage?.imageId ?? null}
            selectedObservationId={selectedObservationId}
            onCheckClick={(observation) => {
              // J03 selection linkage: switch image + mark the observation
              // as selected so the hotspot layer highlights its box.
              if (observation.imageId) {
                setSelectedImageId(observation.imageId);
              }
              if (observation.region?.bbox) {
                setSelectedObservationId(observation.observationId);
              }
            }}
          />
        ) : null}

        {/* J10 (plan §5.3): supplement-evidence loop. Merged VM evidence
            requests become ONE actionable card — upload against the same
            session, then trigger an idempotent revision re-run. Real
            sessions only (demo has no backend session to supplement). */}
        {!isDemoSession && inspectionVM.evidenceRequests.length > 0 ? (
          <EvidenceRequestPanel
            sessionId={sessionId}
            locale={locale}
            requests={inspectionVM.evidenceRequests.map((request) => ({
              id: request.id,
              title: request.title,
              explanation: request.explanation,
              resolvesCheckIds: request.resolvesCheckIds,
            }))}
          />
        ) : null}

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
                // J16: 旧版此处写死「预计周期 2周」，与任务条目（21 天 / 多周）矛盾。
                // 改为从 roadmapRows 求合计项数，周期口径以各条目估时与依赖为准。
                {
                  label: locale === "zh" ? "任务合计 · 依估时" : "Tasks total · est. based",
                  value: locale === "zh"
                    ? `${roadmapRows.length} 项`
                    : `${roadmapRows.length} items`,
                },
                { label: locale === "zh" ? "参与角色" : "Owners", value: String(new Set(roadmapRows.flatMap((row) => row.owner.split(" / "))).size) },
              ].map((metric) => (
                <div key={metric.label} className="border-r border-white/10 px-3 py-3 text-center last:border-r-0">
                  <p className="text-[11px] text-white/42">{metric.label}</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-white">{metric.value}</p>
                </div>
              ))}
            </div>
            {/* J16: 周期说明 — 不给出确定总周期，明确以条目估时与依赖为准 */}
            <p className="mt-2 text-[11px] leading-4 text-white/40">
              {locale === "zh"
                ? "周期以各条目估时与依赖关系为准（逐项见下表），未提供估时的条目按待估处理。"
                : "The timeline follows each item's estimate and dependencies (see the table); items without estimates stay TBD."}
            </p>
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
              <p className="mt-2 text-sm leading-6 text-white/62">{noRisks ? (locale === "zh" ? "按检查清单补齐待补拍/待补资料项。" : "Complete the reshoot / material items in the checklist.") : activeRisk!.recommendedAction}</p>
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
                          presetKey={isDemoSession ? ((search?.get("preset") ?? undefined) as "charger" | "humidifier" | "toy" | undefined) : undefined}
                        />
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* #profit-impact — moved out of #overview in the 2026-09-13 dead-code /
            UX pass. The verdict and hotspot-driven evidence now come first;
            profit appears AFTER #action (roadmap + export) so users see
            compliance before cost. Full cost breakdown still lives at
            /profit/[sessionId] — this section is the summary anchor. */}
        <section id="profit-impact" className="blaze-panel p-5 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <SectionEyebrow>{locale === "zh" ? "STEP 04 · 利润影响" : "STEP 04 · Profit impact"}</SectionEyebrow>
              <h2 className="mt-3 text-3xl font-semibold text-white">
                {locale === "zh" ? "整改后的利润影响" : "Post-remediation profit impact"}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/58">
                {locale === "zh"
                  ? `根据上方合规报告中的整改动作,以下是 ${displayProductName} 在目标市场的利润变化估算。完整表格与决策流请前往利润报告页。`
                  : `Based on the remediation actions above, here is the estimated profit impact for ${displayProductName} across the target markets. The full cost table and decision flow live on the profit report page.`}
              </p>
            </div>
            {financialSummary.trueNetProfit !== "—" ? (
              <Link
                href={`/profit/${sessionId}`}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "shrink-0 rounded-full border border-[rgba(255,90,77,0.45)] bg-[rgba(255,90,77,0.18)] text-white hover:bg-[rgba(255,90,77,0.28)]"
                )}
              >
                {locale === "zh" ? "查看完整利润报告" : "Full profit report"}
                <MoveRight className="size-4" />
              </Link>
            ) : null}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {[
              {
                label: locale === "zh" ? "合规预算" : "Compliance budget",
                value: financialSummary.complianceCost,
                accent: "text-[#ff8a6a]",
                note: locale === "zh" ? "标签 / 测试 / 认证" : "Label / test / cert",
              },
              {
                label: locale === "zh" ? "整改后净利" : "Post-fix net",
                value: financialSummary.trueNetProfit,
                accent: "text-emerald-300",
                note: locale === "zh" ? "单件 / 平台" : "Per unit / channel",
              },
              {
                // J07 (plan §4.6): fine amounts need jurisdiction, violation
                // type, currency, period AND a legal source before they can
                // be shown as a number. Without structured cost/fine inputs
                // we state the dependency instead of inventing a figure.
                label: locale === "zh" ? "罚款风险" : "Fine exposure",
                value: locale === "zh" ? "待确认" : "To confirm",
                accent: "text-rose-300",
                note: locale === "zh"
                  ? "需提供适用违法行销与辖区信息"
                  : "Needs applicable violation + jurisdiction",
              },
              {
                label: locale === "zh" ? "目标市场" : "Target markets",
                value: String(result.targetMarkets?.length ?? 0),
                accent: "text-sky-300",
                note: (result.targetMarkets ?? []).join(" / "),
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-[22px] border border-white/10 bg-white/[0.045] p-5"
              >
                <p className="text-xs text-white/44">{metric.label}</p>
                <p className={cn("mt-2 font-mono text-2xl font-bold", metric.accent)}>
                  {metric.value}
                </p>
                <p className="mt-1 truncate text-[11px] text-white/42">{metric.note}</p>
              </div>
            ))}
          </div>

          <div
            data-testid="result-profit-summary-strip"
            className="mt-5 flex flex-wrap items-center gap-4 rounded-[22px] border border-[rgba(255,90,77,0.32)] bg-[linear-gradient(135deg,rgba(255,90,77,0.10),rgba(255,255,255,0.04))] px-5 py-4"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[rgba(255,90,77,0.4)] bg-[rgba(255,90,77,0.18)] text-[#ff5a4d]">
              <CircleAlert className="size-4" />
            </span>
            <p className="min-w-0 flex-1 text-sm leading-6 text-white/82">
              {locale === "zh" ? (
                <>
                  完成上方合规扫描报告中的全部整改动作后，
                  <span className="font-mono font-semibold text-white">{displayProductName}</span>{" "}
                  在 <span className="font-mono font-semibold text-white">{financialSummary.trueNetProfit}</span>{" "}
                  单件净利水平下进入目标市场，合规预算{" "}
                  <span className="font-mono font-semibold text-white">{financialSummary.complianceCost}</span>。
                  罚款金额取决于具体违法行为与辖区，本报告未获取适用条文与罚则输入，不作数字估算。
                </>
              ) : (
                <>
                  After completing the remediation actions in the compliance report above,{" "}
                  <span className="font-mono font-semibold text-white">{displayProductName}</span>{" "}
                  reaches a per-unit net of{" "}
                  <span className="font-mono font-semibold text-white">{financialSummary.trueNetProfit}</span>{" "}
                  in the target markets, with a compliance budget of{" "}
                  <span className="font-mono font-semibold text-white">{financialSummary.complianceCost}</span>.
                  Fine amounts depend on the specific violation and jurisdiction; no applicable
                  statute or fine input was provided, so no figure is estimated.
                </>
              )}
            </p>
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
