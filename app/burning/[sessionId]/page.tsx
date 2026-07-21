"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { Button, buttonVariants } from "@/components/ui/button";
import { GlowPill, SectionEyebrow } from "@/components/blaze-hawks/ui";
import {
  CompliPilotFlowBackdrop,
  CompliPilotFlowFooter,
  CompliPilotFlowHeader,
} from "@/components/complipilot/flow-shell";
import { ScanImageStage } from "@/components/complipilot/scan-image-stage";
import { getCompliPilotCopy } from "@/lib/complipilot/copy";
import {
  resolveScanStageImages,
  type ScanStagePreset,
} from "@/lib/complipilot/scan-stage";
import {
  isDisplayableTerminalStatus,
  useScanPolling,
} from "@/lib/hooks/useScanPolling";
import { cn } from "@/lib/utils";
import brightFlow from "@/components/complipilot/bright-flow.module.css";

function readStoredAccessToken(sessionId: string): string | null {
  try {
    const value = sessionStorage.getItem(`scan-token:${sessionId}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function readStoredImageCount(sessionId: string): number {
  try {
    const value = Number.parseInt(
      sessionStorage.getItem(`scan-image-count:${sessionId}`) ?? "",
      10
    );
    return Number.isFinite(value) ? Math.min(Math.max(value, 0), 3) : 0;
  } catch {
    return 0;
  }
}

function parsePreset(value: string | null): ScanStagePreset {
  if (value === "humidifier" || value === "toy") {
    return value;
  }
  return "charger";
}
function getActiveIndex(progress: number) {
  if (progress >= 85) {
    return 3;
  }
  if (progress >= 55) {
    return 2;
  }
  if (progress >= 25) {
    return 1;
  }
  return 0;
}

function localizeStageText(
  locale: "zh" | "en",
  stageKey: string | undefined,
  fallback: string | undefined
) {
  const localized =
    locale === "zh"
      ? {
          queued: "准备中…",
          vision: "识别铭牌与认证标识…",
          retrieval: "匹配多市场法规库…",
          report: "生成合规报告与路线图…",
          done: "完成",
          failed: "扫描失败",
        }
      : {
          queued: "Preparing…",
          vision: "Detecting labels and certification marks…",
          retrieval: "Searching multi-market rule libraries…",
          report: "Generating compliance reports and roadmap…",
          done: "Done",
          failed: "Scan failed",
        };

  if (stageKey && stageKey in localized) {
    return localized[stageKey as keyof typeof localized];
  }

  return fallback;
}

export default function BurningPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useBlazeLocale();
  const copy = getCompliPilotCopy(locale);
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const isDemoSession = sessionId === "demo";
  const preset = isDemoSession ? parsePreset(searchParams.get("preset")) : null;
  const demoMarkets = searchParams.get("markets") ?? "EU,US";
  // Read the access token directly from sessionStorage on every render.
  // useScanPolling is keyed on sessionId, so the hook's effect re-fires when
  // sessionId changes and re-reads the token. sessionStorage is cheap and
  // synchronous; caching it in state would just mirror the same value with
  // a cascading render.
  const accessToken = isDemoSession ? null : readStoredAccessToken(sessionId);
  const { status, displayProgress } = useScanPolling(sessionId, accessToken);
  const displayStatus = isDemoSession
    ? {
        sessionId,
        status: "processing",
        progress: 58,
        stageText: locale === "zh" ? "正在匹配多市场法规库…" : "Matching multi-market rule libraries...",
        stageKey: "retrieval" as const,
      }
    : status;
  const progress = isDemoSession ? displayStatus?.progress ?? 8 : displayProgress || 8;
  const activeIndex = getActiveIndex(progress);
  const imageCount = isDemoSession
    ? 1
    : status?.imageCount || readStoredImageCount(sessionId);
  const stageImages = resolveScanStageImages({
    sessionId,
    imageCount,
    preset,
  });

  useEffect(() => {
    if (
      !isDemoSession &&
      status &&
      isDisplayableTerminalStatus(status.status) &&
      status.result
    ) {
      sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(status.result));
      router.push(`/result/${sessionId}`);
    }
  }, [isDemoSession, router, sessionId, status]);
  useEffect(() => {
    if (!isDemoSession) {
      return;
    }

    const timer = window.setTimeout(() => {
      router.push(
        `/result/demo?preset=${preset ?? "charger"}&markets=${encodeURIComponent(demoMarkets)}`
      );
    }, 5200);

    return () => window.clearTimeout(timer);
  }, [demoMarkets, isDemoSession, preset, router]);

  return (
    <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
      <CompliPilotFlowBackdrop tone="bright" />
      <CompliPilotFlowHeader
        backHref="/upload"
        backLabel={locale === "zh" ? "返回上传页" : "Back to upload"}
        flowTitle={locale === "zh" ? "AI 合规扫描中" : "AI Compliance Scan"}
        flowSubtitle={locale === "zh" ? "识别产品信息 · 检索目标市场法规 · 生成解释结论" : "Recognize · retrieve regulations · explain"}
        primaryHref="/upload"
        primaryLabel={locale === "zh" ? "重新上传" : "Upload again"}
        secondaryHref="/result/demo"
        secondaryLabel={locale === "zh" ? "查看演示结果" : "View demo result"}
        statusLabel={isDemoSession ? "00:02" : `${progress}%`}
        tone="bright"
      />

      <section className="mx-auto grid min-h-[960px] w-full max-w-7xl gap-6 px-6 pt-6 lg:grid-cols-[320px_1fr] xl:grid-cols-[340px_1fr]">
        <aside className="blaze-panel p-5 sm:p-6">
          <SectionEyebrow>Step 02</SectionEyebrow>
          <h1 className="mt-3 text-[26px] font-semibold leading-tight text-white xl:text-3xl">{copy.burning.title}</h1>
          <p className="mt-3 text-sm leading-7 text-white/58">
            {copy.burning.body}
          </p>

          <div className="mt-6 flex items-center justify-between">
            {copy.burning.analysisSteps.map((step, index) => {
              const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "queued";
              return (
                <div key={step.title} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-2">
                    <div
                      className={`flex size-8 items-center justify-center rounded-full border text-xs font-bold ${
                        state === "active"
                          ? "border-[var(--blaze-orange)] bg-[rgba(255,143,57,0.2)] text-[var(--blaze-orange)] shadow-[0_0_12px_rgba(255,143,57,0.3)]"
                          : state === "done"
                            ? "border-[var(--blaze-orange)] bg-[var(--blaze-orange)] text-[#0d1730]"
                            : "border-white/10 bg-[rgba(13,19,36,0.6)] text-white/40"
                      }`}
                    >
                      {state === "done" ? "✓" : index + 1}
                    </div>
                    <span className={`text-xs font-semibold ${state === "active" ? "text-white" : state === "done" ? "text-white/70" : "text-white/40"}`}>
                      {step.title}
                    </span>
                  </div>
                  {index < copy.burning.analysisSteps.length - 1 ? (
                    <div className="mx-1 mb-5 h-px flex-1 bg-white/10" />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center gap-4">
            <div className="relative size-28">
              <svg className="size-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50" cy="50" r="45"
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="4"
                />
                <circle
                  cx="50" cy="50" r="45"
                  fill="none"
                  stroke="var(--blaze-orange)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 45}`}
                  strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress / 100)}`}
                  className="transition-[stroke-dashoffset] duration-500"
                  style={{ filter: "drop-shadow(0 0 6px rgba(255,143,57,0.4))" }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="font-mono text-2xl font-bold text-white">{progress}%</div>
                  <div className="text-xs uppercase tracking-[0.18em] text-white/42">{copy.burning.progress}</div>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <GlowPill>Session · {sessionId.slice(0, 16)}</GlowPill>
              <p className="text-sm text-white/64">
                {localizeStageText(locale, displayStatus?.stageKey, displayStatus?.stageText) ??
                  copy.burning.waiting}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {copy.burning.analysisSteps.map((step, index) => {
              const state =
                index < activeIndex ? "done" : index === activeIndex ? "active" : "queued";
              return (
                <div
                  key={`${index}-${step.title}`}
                  className={`rounded-[22px] border px-4 py-4 ${
                    state === "active"
                      ? "border-[rgba(255,143,57,0.36)] bg-[rgba(255,143,57,0.14)]"
                      : state === "done"
                        ? "border-white/10 bg-white/7"
                        : "border-white/8 bg-white/4"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{step.title}</p>
                    <span className="text-xs uppercase tracking-[0.18em] text-white/38">
                      {state === "done"
                        ? locale === "zh"
                          ? "完成"
                          : "done"
                        : state === "active"
                          ? locale === "zh"
                            ? "进行中"
                            : "live"
                          : locale === "zh"
                            ? "等待"
                            : "wait"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-white/54">{step.description}</p>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="blaze-panel min-h-[820px] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionEyebrow>Exploded Stage</SectionEyebrow>
              <h2 className="mt-3 text-3xl font-semibold text-white">{copy.burning.preview}</h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/58">
                {copy.burning.stageNote}
              </p>
            </div>
            <GlowPill>{copy.burning.marketsPill}</GlowPill>
          </div>

          <div className="mt-6 space-y-4">
            <ScanImageStage
              images={stageImages}
              progress={progress}
              locale={locale}
              isPreset={isDemoSession}
            />

            <div className="hidden gap-3 xl:grid xl:grid-cols-3">
              {copy.burning.insightCards.map((card) => (
                <article key={card.title} className="blaze-panel-soft p-4">
                  <p className="text-sm font-semibold text-white">{card.title}</p>
                  <p className="mt-2 text-xs leading-6 text-white/56">{card.body}</p>
                </article>
              ))}
            </div>
            <article className="blaze-panel-soft p-4">
              <SectionEyebrow>{copy.burning.currentStage}</SectionEyebrow>
              <p className="mt-3 text-sm leading-7 text-white/62">
                {copy.burning.currentSessionLabel}{" "}
                <span className="font-mono text-white">{sessionId}</span>
              </p>
              <p className="mt-2 text-sm leading-7 text-white/62">
                {copy.burning.stageNote}
              </p>
            </article>
          </div>

          {displayStatus?.status === "failed" ? (
            <div className="mt-6 rounded-[26px] border border-[rgba(248,115,96,0.36)] bg-[rgba(248,115,96,0.1)] p-5">
              <p className="text-sm text-[#ffd9d1]">{status?.error ?? copy.burning.failed}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button size="lg" className="rounded-full" onClick={() => router.push("/upload")}>
                  {copy.burning.retry}
                </Button>
                <Link
                  href="/result/demo"
                  className={cn(
                    buttonVariants({ size: "lg", variant: "outline" }),
                    "rounded-full border-white/12 bg-white/4 text-white hover:bg-white/10"
                  )}
                >
                  {copy.burning.showDemo}
                </Link>
              </div>
            </div>
          ) : null}
        </section>
      </section>
      <CompliPilotFlowFooter sessionId={sessionId} tone="bright" />
    </main>
  );
}
