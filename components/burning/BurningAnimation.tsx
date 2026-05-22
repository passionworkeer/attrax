"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

// stageId is English, icon is shared. stageText (backend Chinese) matched separately.
const STAGE_ICONS: { id: string; icon: string }[] = [
  { id: "preparing", icon: "🕐" },
  { id: "analyzingImages", icon: "🔍" },
  { id: "planningStrategy", icon: "🧠" },
  { id: "retrievingRegulations", icon: "📚" },
  { id: "generatingReport", icon: "✍️" },
  { id: "reportComplete", icon: "✅" },
  { id: "backendTimeout", icon: "⚠️" },
  { id: "backendUnavailable", icon: "⚠️" },
  { id: "demoResultGenerated", icon: "✅" },
  { id: "scanPassed", icon: "✅" },
  { id: "scanWarning", icon: "⚠️" },
  { id: "scanRisk", icon: "🔴" },
];

// Backend stageText may be in zh or en — match by emoji prefix or distinct keyword.
const STAGE_TEXT_TO_ID: [RegExp, string][] = [
  [/\u{1F550}|准备中|Preparing/u, "preparing"],
  [/分析上传图片|Analyzing uploaded images/u, "analyzingImages"],
  [/规划检索策略|Planning retrieval strategy/u, "planningStrategy"],
  [/检索合规法规库|Retrieving compliance regulation database/u, "retrievingRegulations"],
  [/生成合规报告|Generating compliance report/u, "generatingReport"],
  [/报告生成完成|Report generation complete/u, "reportComplete"],
  [/后端服务响应超时|Backend service timed out|RAG_SERVICE_TIMEOUT/u, "backendTimeout"],
  [/后端服务不可用|Backend service unavailable|RAG_SERVICE_UNAVAILABLE/u, "backendUnavailable"],
  [/演示结果已生成|Demo result generated/u, "demoResultGenerated"],
  [/合规扫描通过|Compliance scan passed/u, "scanPassed"],
  [/合规警告|Compliance warning/u, "scanWarning"],
  [/合规风险|Compliance risk/u, "scanRisk"],
];

export interface BurningAnimationProps {
  displayProgress: number;
  stageText: string | undefined;
  status: { status: string; error?: string } | null;
  completing: boolean;
  sessionId: string;
  onRetry: () => void;
}

const FAILURE_ERROR_KEYS: Record<string, string> = {
  SCAN_FAILED: "errors.scanFailed",
  RAG_SERVICE_TIMEOUT: "errors.backendTimeout",
  RAG_SERVICE_UNAVAILABLE: "errors.backendUnavailable",
};

function getStageId(stageText: string | undefined): string | undefined {
  const matched = stageText
    ? STAGE_TEXT_TO_ID.find(([pattern]) => pattern.test(stageText))
    : undefined;
  return matched?.[1];
}

function StageIcon({ stageId }: { stageId: string | undefined }) {
  const entry = stageId ? STAGE_ICONS.find((s) => s.id === stageId) : undefined;
  const icon = entry?.icon ?? "⚙️";
  return <span className="mr-1.5 text-base">{icon}</span>;
}

export function BurningAnimation({
  displayProgress,
  stageText,
  status,
  completing,
  sessionId,
  onRetry,
}: BurningAnimationProps) {
  const { t } = useTranslation();
  const isFailed = status?.status === "failed";
  const stageId = completing ? "reportComplete" : getStageId(stageText);
  const stageLabel = completing
    ? t("scanStages.reportComplete")
    : stageId
    ? t(`scanStages.${stageId}`)
    : stageText ?? t("animation.waitingForTask");
  const failureMessage = status?.error && FAILURE_ERROR_KEYS[status.error]
    ? t(FAILURE_ERROR_KEYS[status.error])
    : status?.error ?? t("errors.scanFailed");

  return (
    <section className="mx-4 w-full max-w-2xl rounded-4xl border border-white/10 bg-white/6 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:mx-auto">
      <p className="text-sm uppercase tracking-[0.28em] text-white/55">Burning</p>
      <h1 className="mt-4 text-3xl font-semibold">
        {completing ? t("animation.eagleReady") : t("animation.eagleAnalyzing")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-white/70">
        {t("animation.currentSession")} <span className="font-mono text-white">{sessionId}</span>
      </p>

      {/* Progress section */}
      <div className="mt-8 space-y-4 rounded-3xl bg-white/7 p-5">
        {/* Track */}
        <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blaze-red to-orange-400"
            animate={{ width: `${displayProgress}%` }}
            transition={{ duration: 0, ease: "linear" }}
            style={{ width: `${displayProgress}%` }}
          />
          {/* Shimmer pulse when active */}
          {status?.status === "processing" && !completing && (
            <motion.div
              className="absolute inset-y-0 rounded-full bg-white/20"
              animate={{ x: ["-100%", "200%"] }}
              transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
              style={{ width: "40%" }}
            />
          )}
        </div>

        {/* Stage + percentage */}
        <div className="flex items-center justify-between text-sm text-white/80">
          <span className="flex items-center gap-1 min-w-0">
            <StageIcon stageId={stageId} />
            <span className="truncate">
              {stageLabel}
            </span>
          </span>
          <span className="ml-2 shrink-0 tabular-nums font-medium text-white/90">
            {displayProgress}%
          </span>
        </div>

        {/* Step dots */}
        {status?.status === "processing" && !completing && (
          <div className="flex justify-center gap-1.5 pt-1">
            {[10, 30, 45, 65, 75, 90, 100].map((milestone) => (
              <div
                key={milestone}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-all duration-300",
                  displayProgress >= milestone
                    ? "bg-blaze-red scale-110"
                    : "bg-white/20"
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Failed state */}
      {isFailed ? (
        <div className="mt-6 space-y-4 rounded-3xl border border-red-400/30 bg-red-500/10 p-5">
          <p className="text-sm text-red-100">{failureMessage}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-blaze-red px-8 text-sm font-semibold text-white transition-colors hover:bg-blaze-red/90"
            >
              {t("result.reupload")}
            </button>
            <Link
              href="/result/demo"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "border-white/20 bg-transparent text-white hover:bg-white/10"
              )}
            >
              {t("result.viewDemo")}
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}
