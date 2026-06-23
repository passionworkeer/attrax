"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BurningAnimation } from "@/components/burning/BurningAnimation";
import { useScanPolling } from "@/lib/hooks/useScanPolling";
import { useTranslation } from "@/lib/i18n";

export default function BurningPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const { status, displayProgress } = useScanPolling(sessionId);
  const completing = status?.status === "ready" && Boolean(status.result);
  const { t } = useTranslation();

  useEffect(() => {
    if (status?.status === "ready" && status.result) {
      sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(status.result));
      setTimeout(() => router.push(`/result/${sessionId}`), 700);
    }
  }, [router, sessionId, status]);

  function handleRetry() {
    router.push("/upload");
  }

  return (
    <main className="flex min-h-[calc(100vh-5rem)] items-center justify-center px-4 sm:px-6 py-12 text-white">
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

      <BurningAnimation
        displayProgress={displayProgress}
        stageText={status?.stageText}
        status={status}
        completing={completing}
        sessionId={sessionId}
        onRetry={handleRetry}
      />
    </main>
  );
}
