"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  RefreshCw,
  CheckCircle2,
  Circle,
  Cpu,
  Zap,
  FileSearch,
  Lightbulb,
  AlertTriangle,
  Flame,
} from "lucide-react";
import { useScanPolling } from "@/lib/hooks/useScanPolling";
import { useTranslation } from "@/lib/i18n";

interface Stage {
  id: string;
  icon: React.ReactNode;
  label: string;
  labelEn: string;
  threshold: number;
}

const STAGES: Stage[] = [
  { id: "uploading", icon: <Circle className="h-4 w-4" />, label: "上传产品", labelEn: "Product uploaded", threshold: 0 },
  { id: "vision", icon: <Cpu className="h-4 w-4" />, label: "AI 视觉识别", labelEn: "AI vision recognition", threshold: 15 },
  { id: "disassembly", icon: <Zap className="h-4 w-4" />, label: "结构智能拆解", labelEn: "Structural disassembly", threshold: 35 },
  { id: "retrieval", icon: <FileSearch className="h-4 w-4" />, label: "法规条款检索", labelEn: "Compliance retrieval", threshold: 55 },
  { id: "risk", icon: <AlertTriangle className="h-4 w-4" />, label: "风险智能匹配", labelEn: "Risk matching", threshold: 75 },
  { id: "synthesis", icon: <Lightbulb className="h-4 w-4" />, label: "报告生成", labelEn: "Report generation", threshold: 90 },
];

export default function BurningPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const { status, displayProgress } = useScanPolling(sessionId);
  const completing = status?.status === "ready" && Boolean(status.result);
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (status?.status === "ready" && status.result) {
      sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(status.result));
      setTimeout(() => router.push(`/result/${sessionId}`), 800);
    }
  }, [router, sessionId, status]);

  function handleRetry() {
    router.push("/upload");
  }

  // Derive current step from progress
  const currentStepIndex = useMemo(() => {
    return STAGES.findIndex((s) => displayProgress < s.threshold) === -1
      ? STAGES.length - 1
      : STAGES.findIndex((s) => displayProgress < s.threshold);
  }, [displayProgress]);

  const stageLabel = status?.stageText ?? t("animation.waitingForTask");
  const isFailed = status?.status === "failed";

  return (
    <div className="min-h-[calc(100vh-5rem)] flex text-white">
      {/* Screen flash on completion */}
      <AnimatePresence>
        {completing && (
          <motion.div
            key="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blaze-red/20 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.1, opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex flex-col items-center gap-3"
            >
              <div className="text-6xl drop-shadow-[0_0_30px_rgba(217,58,26,0.8)]">&#128293;</div>
              <p className="text-xl font-bold text-white text-glow">{t("burning.scanComplete")}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Left sidebar: V-12 EX-ENGINE panel */}
      <aside className="w-72 shrink-0 hidden lg:flex flex-col border-r border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="px-6 pt-6 pb-8 border-b border-white/10">
          <h1 className="font-display-xl text-3xl font-black italic text-blaze-red tracking-tighter">
            ATTRAX
          </h1>
          <p className="label-caps text-[10px] text-slate-400 mt-1">V-12 EX-ENGINE</p>
        </div>

        <nav className="flex-grow py-6 flex flex-col">
          {[
            { label: t("burning.sidebar.scan"), icon: "scan", active: false },
            { label: t("burning.sidebar.disassembly"), icon: "disassembly", active: true },
            { label: t("burning.sidebar.analysis"), icon: "analysis", active: false },
            { label: t("burning.sidebar.heatmap"), icon: "heatmap", active: false },
            { label: t("burning.sidebar.export"), icon: "export", active: false },
          ].map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-3 px-6 py-3.5 text-sm font-medium transition-all ${
                item.active
                  ? "bg-blaze-red/15 text-blaze-red border-l-4 border-blaze-red"
                  : "text-slate-500 opacity-70 hover:opacity-100 hover:bg-white/5"
              }`}
            >
              <Zap className="h-4 w-4" />
              {item.label}
            </div>
          ))}
        </nav>

        <div className="px-6 pb-8 mt-auto space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-2">
              {t("burning.aiAnalyzing")}
            </h2>
            <div className="inline-block text-blaze-red label-caps text-[10px] bg-blaze-red/10 px-3 py-1 rounded-full mb-4">
              {t("burning.step2Tag")}
            </div>
            <ul className="space-y-2.5 data-mono text-xs">
              {STAGES.map((stage, idx) => {
                const isDone = displayProgress >= stage.threshold + 5 || (idx < currentStepIndex) || completing;
                const isCurrent = idx === currentStepIndex && !isFailed;
                return (
                  <li
                    key={stage.id}
                    className={`flex items-center gap-2 ${
                      isCurrent ? "text-blaze-red" : isDone ? "text-slate-300" : "text-slate-500 opacity-50"
                    }`}
                  >
                    {isCurrent && !isDone ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-blaze-red" />
                    ) : (
                      <Circle className="h-3.5 w-3.5" />
                    )}
                    <span>{stage.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Progress ring */}
          <div className="relative w-40 h-40 mx-auto flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="transparent"
                stroke="currentColor"
                strokeWidth="4"
                className="text-slate-700"
              />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="transparent"
                stroke="currentColor"
                strokeWidth="4"
                strokeDasharray="282.743"
                strokeDashoffset={282.743 - (282.743 * displayProgress) / 100}
                strokeLinecap="round"
                className="text-blaze-red drop-shadow-[0_0_8px_rgba(217,58,26,0.6)]"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center">
              <span className="data-mono text-2xl font-bold text-white">
                {displayProgress}%
              </span>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">
                {mounted ? (stageLabel.length > 20 ? stageLabel.slice(0, 20) + "…" : stageLabel) : t("burning.processing")}
              </span>
            </div>
          </div>

          {isFailed ? (
            <button
              type="button"
              onClick={handleRetry}
              className="w-full bg-blaze-red hover:bg-blaze-red/90 text-white font-bold text-sm py-3 rounded-lg shadow-[0_0_20px_rgba(217,58,26,0.5)] transition-all active:scale-95 border border-white/20"
            >
              {t("result.reupload")}
            </button>
          ) : (
            <div className="w-full bg-slate-800/50 border border-white/10 text-slate-400 font-bold text-sm py-3 rounded-lg text-center data-mono">
              {t("burning.autoRunning")}
            </div>
          )}
        </div>
      </aside>

      {/* Main: 3D Disassembly Canvas */}
      <main className="flex-1 relative bg-[#0b0f11] flex items-center justify-center overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 50% 50%, rgba(76,201,240,0.1) 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
        </div>

        {/* 3D Placeholder visualization */}
        <div className="relative w-[min(800px,80vw)] h-[min(800px,80vw)] flex items-center justify-center">
          {/* Central product silhouette */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-72 h-72 rounded-3xl border-2 border-dashed border-blaze-cyan/30 flex items-center justify-center bg-blaze-cyan/5 backdrop-blur-sm">
              <Cpu className="h-24 w-24 text-blaze-cyan/40" />
              <div className="absolute inset-0 rounded-3xl border border-blaze-cyan/20 animate-pulse" />
            </div>
          </div>

          {/* Floating component cards - exploded view */}
          <ComponentLabel
            position="top-1/4 left-[8%]"
            color="blaze-red"
            label={t("burning.components.casing")}
            glow
          />
          <ComponentLabel
            position="top-[18%] right-[10%]"
            color="blaze-cyan"
            label={t("burning.components.battery")}
          />
          <ComponentLabel
            position="bottom-[28%] left-[15%]"
            color="blaze-cyan"
            label={t("burning.components.motherboard")}
          />
          <ComponentLabel
            position="bottom-[18%] right-[8%]"
            color="blaze-orange"
            label={t("burning.components.label")}
          />
          <ComponentLabel
            position="top-[55%] left-[42%]"
            color="blaze-gold"
            label={t("burning.components.packaging")}
          />
        </div>

        {/* Bottom-center status badge */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-black/60 border border-white/20 px-5 py-2.5 backdrop-blur-md">
          <Flame className="h-4 w-4 text-blaze-red animate-pulse" />
          <span className="text-sm font-semibold text-white data-mono">
            {mounted ? stageLabel : t("burning.processing")}
          </span>
        </div>
      </main>
    </div>
  );
}

function ComponentLabel({
  position,
  color,
  label,
  glow = false,
}: {
  position: string;
  color: string;
  label: string;
  glow?: boolean;
}) {
  const colorMap: Record<string, { border: string; text: string; shadow: string }> = {
    "blaze-red": {
      border: "border-l-blaze-red",
      text: "text-blaze-red",
      shadow: "shadow-[0_0_15px_rgba(217,58,26,0.4)]",
    },
    "blaze-cyan": {
      border: "border-l-blaze-cyan",
      text: "text-blaze-cyan",
      shadow: "shadow-[0_0_15px_rgba(76,201,240,0.4)]",
    },
    "blaze-orange": {
      border: "border-l-blaze-orange",
      text: "text-blaze-orange",
      shadow: "shadow-[0_0_15px_rgba(255,138,31,0.4)]",
    },
    "blaze-gold": {
      border: "border-l-blaze-gold",
      text: "text-blaze-gold",
      shadow: "shadow-[0_0_15px_rgba(255,210,63,0.4)]",
    },
  };
  const c = colorMap[color] ?? colorMap["blaze-cyan"];
  return (
    <div
      className={`absolute ${position} glass-panel px-3 py-1.5 rounded data-mono text-xs text-white border-l-2 ${c.border} ${glow ? c.shadow : ""} z-10`}
    >
      {label}
    </div>
  );
}
