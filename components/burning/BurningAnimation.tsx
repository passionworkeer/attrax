"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const STAGE_ICONS: Record<string, string> = {
  "准备中": "🕐",
  "分析上传图片": "🔍",
  "规划检索策略": "🧠",
  "检索合规法规库": "📚",
  "生成合规报告": "✍️",
  "报告生成完成": "✅",
};

export interface BurningAnimationProps {
  displayProgress: number;
  stageText: string | undefined;
  status: { status: string; error?: string } | null;
  completing: boolean;
  sessionId: string;
  onRetry: () => void;
}

function StageIcon({ text }: { text: string }) {
  const icon = Object.entries(STAGE_ICONS).find(([k]) => text.includes(k))?.[1] ?? "⚙️";
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
  const isFailed = status?.status === "failed";

  return (
    <section className="mx-4 w-full max-w-2xl rounded-4xl border border-white/10 bg-white/6 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:mx-auto">
      <p className="text-sm uppercase tracking-[0.28em] text-white/55">Burning</p>
      <h1 className="mt-4 text-3xl font-semibold">
        {completing ? "雄鹰已准备就绪！" : "雄鹰正在分析你的产品"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-white/70">
        当前会话：<span className="font-mono text-white">{sessionId}</span>
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
            <StageIcon text={completing ? "报告生成完成" : stageText ?? "等待任务启动…"} />
            <span className="truncate">
              {completing ? "报告生成完成" : stageText ?? "等待任务启动…"}
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
          <p className="text-sm text-red-100">{status.error ?? "扫描失败。"}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-blaze-red px-8 text-sm font-semibold text-white transition-colors hover:bg-blaze-red/90"
            >
              重新上传
            </button>
            <Link
              href="/result/demo"
              className={cn(
                buttonVariants({ size: "lg", variant: "outline" }),
                "border-white/20 bg-transparent text-white hover:bg-white/10"
              )}
            >
              查看 Demo
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}