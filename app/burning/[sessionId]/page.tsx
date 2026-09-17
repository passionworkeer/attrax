"use client";

import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";
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
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(`scan-token:${sessionId}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function readStoredImageCount(sessionId: string): number {
  if (typeof window === "undefined") return 0;
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
/**
 * J21: analysisSteps 现与 ScanImageStage 的 6 阶段流水线统一，
 * activeIndex 也改为 0-5 的六档映射（旧版按 4 步只映射到 3）。
 */
function getActiveIndex(progress: number) {
  if (progress >= 92) {
    return 5;
  }
  if (progress >= 78) {
    return 4;
  }
  if (progress >= 60) {
    return 3;
  }
  if (progress >= 30) {
    return 2;
  }
  if (progress >= 12) {
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

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [storedImageCount, setStoredImageCount] = useState<number>(0);

  useEffect(() => {
    if (!isDemoSession && sessionId) {
      startTransition(() => {
        setAccessToken(readStoredAccessToken(sessionId));
        setStoredImageCount(readStoredImageCount(sessionId));
      });
    }
  }, [isDemoSession, sessionId]);

  // Hold-timer origin: the poller captures the timestamp of the FIRST
  // response that reported completing (event-handler context — pure-render
  // compliant). The page just consumes it; no Date.now() during render.
  const { status, displayProgress, completedAt: holdReadyAt } = useScanPolling(sessionId, accessToken);

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
    : status?.imageCount || storedImageCount;
  const stageImages = resolveScanStageImages({
    sessionId,
    imageCount,
    preset,
  });

  // Plan 2026-09-14 §4.1 (bug J01): the completion state machine keys off
  // `ready && resultReady` — an explicit BFF contract — not `progress >= 100`
  // inferred from text. The 100% hold is measured from when the DISPLAY shows
  // 100 (not from when the backend said ready), so the user always sees the
  // completed bar before the route change.
  const HUNDRED_PERCENT_HOLD_MS = 600;
  // 跨 effect 重跑的真值标（cleanup 会取消旧 timer，但 navigation 标记要跨
  // tick 保留）。用 useRef 而非 useState：state 翻转会触发 effect 重跑 →
  // cleanup 清掉 timer，guard 失效。
  const navigatedRef = useRef(false);
  const realProgressComplete =
    !isDemoSession &&
    status != null &&
    isDisplayableTerminalStatus(status.status) &&
    status.resultReady === true &&
    status.result != null;
  const displayShowsComplete =
    !isDemoSession && progress >= 100;

  useEffect(() => {
    if (
      !isDemoSession &&
      status &&
      realProgressComplete &&
      holdReadyAt !== null &&
      displayShowsComplete
    ) {
      const elapsed = Date.now() - holdReadyAt;
      const remaining = HUNDRED_PERCENT_HOLD_MS - elapsed;
      const timer = window.setTimeout(() => {
        // Plan §4.1 (6): the completion jump must not depend on
        // sessionStorage writes succeeding. Cache failures are skipped —
        // the result page re-fetches the session via /api/scan/{id}.
        try {
          sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(status.result));
        } catch {
          // Quota / private-mode storage failures must not block result access.
        }
        if (navigatedRef.current) return;
        navigatedRef.current = true;
        router.push(`/result/${sessionId}`);
      }, Math.max(0, remaining));
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [
    displayShowsComplete,
    holdReadyAt,
    isDemoSession,
    realProgressComplete,
    router,
    sessionId,
    status,
  ]);
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
              {/* J21: 「Exploded Stage」超出实际能力——这里是图像证据分析舞台 */}
              <SectionEyebrow>Image Evidence Stage</SectionEyebrow>
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
              stageKey={displayStatus?.stageKey ?? "vision"}
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

          {/* Plan §4.1 (8): fallback escape hatch. If the backend has already
              finished (ready + resultReady) but the animated bar is still
              settling, the user can reach the result page directly instead of
              being trapped by the 99% deadlock (bug J01). */}
          {realProgressComplete && !navigatedRef.current ? (
            <div className="mt-6 rounded-[26px] border border-[rgba(126,231,135,0.36)] bg-[rgba(126,231,135,0.08)] p-5">
              <p className="text-sm text-[#d3ffd7]">
                {locale === "zh"
                  ? "扫描已完成，正在准备结果页…"
                  : "Scan complete — preparing the result page…"}
              </p>
              <div className="mt-4">
                <Button
                  size="lg"
                  className="rounded-full"
                  onClick={() => {
                    if (navigatedRef.current) return;
                    navigatedRef.current = true;
                    router.push(`/result/${sessionId}`);
                  }}
                >
                  {locale === "zh" ? "查看已完成结果" : "View completed result"}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </section>
      <CompliPilotFlowFooter sessionId={sessionId} tone="bright" />
    </main>
  );
}
