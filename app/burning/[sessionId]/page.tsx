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
import { MARKET_IDS, type Market } from "@/lib/types";
import waitingStyles from "./waiting.module.css";
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
          report: "正在生成合规报告",
          verify: "核对报告引用与证据…",
          persist: "保存报告，准备展示…",
          done: "完成",
          failed: "扫描失败",
        }
      : {
          queued: "Preparing…",
          vision: "Detecting labels and certification marks…",
          retrieval: "Searching multi-market rule libraries…",
          report: "Generating compliance reports and roadmap…",
          verify: "Checking citations and evidence…",
          persist: "Saving your report…",
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
  const [storedMarkets, setStoredMarkets] = useState<Market[]>([]);

  useEffect(() => {
    if (!isDemoSession && sessionId) {
      startTransition(() => {
        setAccessToken(readStoredAccessToken(sessionId));
        setStoredImageCount(readStoredImageCount(sessionId));
        try {
          setStoredMarkets((sessionStorage.getItem(`scan-markets:${sessionId}`) ?? "")
            .split(",").filter((market): market is Market => MARKET_IDS.includes(market as Market)));
        } catch { setStoredMarkets([]); }
      });
    }
  }, [isDemoSession, sessionId]);

  // Hold-timer origin: the poller captures the timestamp of the FIRST
  // response that reported completing (event-handler context — pure-render
  // compliant). The page just consumes it; no Date.now() during render.
  const { status, displayProgress, lastContactAt, reconnecting, completedAt: holdReadyAt } = useScanPolling(sessionId, accessToken);

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
  const stageIndex = { queued: 0, vision: 1, retrieval: 2, report: 3, done: 5, failed: 0 };
  const phase = displayStatus?.stageText?.split(":")[0];
  const cacheHits = Number(displayStatus?.stageText?.match(/cache_hits=(\d+)/)?.[1] ?? 0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [clockNow, setClockNow] = useState(0);
  useEffect(() => {
    const started = Date.now();
    if (status?.status && status.status !== "processing") return;
    const timer = window.setInterval(() => { setClockNow(Date.now()); setElapsedSeconds(Math.floor((Date.now() - started) / 1000)); }, 1000);
    return () => window.clearInterval(timer);
  }, [sessionId, status?.status]);
  const contactAge = lastContactAt ? Math.max(0, Math.floor((clockNow - lastContactAt) / 1000)) : null;
  const connectionDelayed = reconnecting || (contactAge !== null && contactAge > 15);
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const activeIndex = phase === "verify" ? 4 : phase === "persist" ? 5 : displayStatus?.stageKey
    ? stageIndex[displayStatus.stageKey]
    : getActiveIndex(progress);
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
  // 去重 guard：timer 与按钮点击可能同时触发导航。ref 提供同步的"已导航"
  // 判断（只在回调里读写，react-hooks/refs 禁止 render 期访问 ref）；
  // state 负责渲染侧隐藏按钮。之前用 useState 当 ref 用，timer 回调里
  // 读到的永远是调度时的旧闭包值。
  const navigatedRef = useRef(false);
  const [navigated, setNavigated] = useState(false);
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
        setNavigated(true);
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
    <main className={`${brightFlow.page} ${brightFlow.scanGlass} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
      <CompliPilotFlowBackdrop tone="bright" />
      <CompliPilotFlowHeader
        backHref="/upload"
        backLabel={locale === "zh" ? "返回上传页" : "Back to upload"}
        flowTitle={locale === "zh" ? "AI 合规扫描中" : "AI Compliance Scan"}
        flowSubtitle={locale === "zh" ? "识别产品信息 · 检索目标市场法规 · 生成解释结论" : "Recognize · retrieve regulations · explain"}
        primaryHref="/upload"
        primaryLabel={locale === "zh" ? "重新上传" : "Upload again"}

        statusLabel={isDemoSession ? "00:02" : elapsedLabel}
        tone="bright"
      />

      <section className="mx-auto grid min-h-[960px] w-full max-w-7xl gap-6 px-6 pt-6 lg:grid-cols-[320px_1fr] xl:grid-cols-[340px_1fr]">
        <aside className="blaze-panel p-5 sm:p-6">
          <SectionEyebrow>{locale === "zh" ? "正在检测" : "SCAN IN PROGRESS"}</SectionEyebrow>
          <div className={waitingStyles.currentTask} aria-live="polite">
            {displayStatus?.status !== "failed" && <span className={waitingStyles.activity} aria-hidden="true" />}
            <h1 className={waitingStyles.title}>{localizeStageText(locale, phase === "verify" || phase === "persist" ? phase : displayStatus?.stageKey, undefined) ?? copy.burning.waiting}</h1>
            <p className={waitingStyles.description}>{copy.burning.analysisSteps[activeIndex]?.description}</p>
          </div>
          <div className={waitingStyles.timer}>
            <span>{locale === "zh" ? "本页已等待" : "Time on this page"}</span>
            <strong>{isDemoSession ? "00:02" : elapsedLabel}</strong>
          </div>
          {!isDemoSession && displayStatus?.status !== "failed" && <div className={waitingStyles.connection} data-delayed={connectionDelayed} role="status">
            <span className={waitingStyles.connectionDot} aria-hidden="true" />
            <div><strong>{locale === "zh" ? (connectionDelayed ? "状态同步暂时中断" : lastContactAt ? "服务连接正常" : "正在连接检测服务") : (connectionDelayed ? "Status connection interrupted" : lastContactAt ? "Service connected" : "Connecting")}</strong>
            <p>{locale === "zh" ? (connectionDelayed ? "正在重新获取状态，请勿重复提交。" : contactAge !== null ? `${contactAge} 秒前收到任务状态` : "正在获取当前任务状态…") : (connectionDelayed ? "Reconnecting. Please do not resubmit." : contactAge !== null ? `Task status received ${contactAge}s ago` : "Fetching task status…")}</p></div>
          </div>}
          {displayStatus?.status === "processing" && activeIndex === 3 && elapsedSeconds >= 60 && <p className={waitingStyles.longWait}>{locale === "zh" ? "本次生成等待较久。暂未收到报告，完成后会自动展示；服务状态更新不代表模型已完成。" : "This report is taking longer. We are still waiting for its output and will open it when ready."}</p>}
          {activeIndex === 3 && <p className={waitingStyles.explanation}>{locale === "zh" ? "正在综合产品照片、补充材料与目标市场要求，生成本次报告。这个环节通常比资料准备耗时更长。" : "Combining product images, supporting evidence and market requirements into your report. This usually takes longer than preparation."}</p>}
          {activeIndex > 0 && <div className={waitingStyles.receipt}>
            <h2>{locale === "zh" ? "已就绪的资料" : "Ready for analysis"}</h2>
            <p>{locale === "zh" ? `${imageCount} 张产品照片已接收` : `${imageCount} product images received`}</p>
            {activeIndex > 1 && <p>{cacheHits > 0 ? (locale === "zh" ? `${cacheHits} 张照片的识别结果已复用` : `Reused observations for ${cacheHits} images`) : (locale === "zh" ? "图片识别已完成" : "Image observations ready")}</p>}
            {activeIndex > 2 && <p>{locale === "zh" ? "适用检查与法规范围已整理" : "Applicable checks and sources prepared"}</p>}
            {cacheHits > 0 && <small>{locale === "zh" ? "相同照片无需重复识别；本次报告仍会重新分析生成。" : "Matching images need no repeat recognition. This report is generated afresh."}</small>}
          </div>}
          <p className={waitingStyles.next}>{locale === "zh" ? "生成后核对引用，再自动打开报告。" : "Citations are checked before your report opens automatically."}</p>
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
            <GlowPill>{storedMarkets.length
              ? storedMarkets.map((market) => copy.upload.marketLabels[market]).join(" · ")
              : locale === "zh" ? "按所选市场分析" : "Analyzing selected markets"}</GlowPill>
          </div>

          <div className="mt-6 space-y-4">
            <ScanImageStage
              images={stageImages}
              progress={progress}
              locale={locale}
              stageKey={phase === "verify" || phase === "persist" ? phase : displayStatus?.stageKey ?? "queued"}
              cacheHits={cacheHits}
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
              </div>
            </div>
          ) : null}

          {/* Plan §4.1 (8): fallback escape hatch. If the backend has already
              finished (ready + resultReady) but the animated bar is still
              settling, the user can reach the result page directly instead of
              being trapped by the 99% deadlock (bug J01). */}
          {realProgressComplete && !navigated ? (
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
                    setNavigated(true);
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
