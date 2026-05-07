"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Button, buttonVariants } from "@/components/ui/button";
import { useScanPolling } from "@/lib/hooks/useScanPolling";
import { cn } from "@/lib/utils";

const STAGE_ICONS: Record<string, string> = {
  "准备中": "🕐",
  "分析上传图片": "🔍",
  "规划检索策略": "🧠",
  "检索合规法规库": "📚",
  "生成合规报告": "✍️",
  "报告生成完成": "✅",
};

function StageIcon({ text }: { text: string }) {
  const icon = Object.entries(STAGE_ICONS).find(([k]) => text.includes(k))?.[1] ?? "⚙️";
  return <span className="mr-1.5 text-base">{icon}</span>;
}

export default function BurningPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { status, displayProgress } = useScanPolling(sessionId);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (status?.status === "ready" && status.result) {
      setCompleting(true);
      // Brief flash so user sees "完成" before the page swaps
      sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(status.result));
      setTimeout(() => router.push(`/result/${sessionId}`), 700);
    }
  }, [router, sessionId, status]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-blaze-dark px-4 sm:px-6 py-16 text-white">
      {/* Screen flash on completion */}
      <AnimatePresence>
        {completing && (
          <motion.div
            key="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/20 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.1, opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex flex-col items-center gap-3"
            >
              <div className="text-5xl">🔥</div>
              <p className="text-lg font-semibold text-white">扫描完成！</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              <StageIcon text={completing ? "报告生成完成" : status?.stageText ?? "等待任务启动…"} />
              <span className="truncate">
                {completing ? "报告生成完成" : status?.stageText ?? "等待任务启动…"}
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

        {status?.status === "failed" ? (
          <div className="mt-6 space-y-4 rounded-3xl border border-red-400/30 bg-red-500/10 p-5">
            <p className="text-sm text-red-100">{status.error ?? "扫描失败。"}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={() => router.push("/upload")}>
                重新上传
              </Button>
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
    </main>
  );
}