"use client";

import { useEffect, useRef, useState } from "react";
import type { ScanStatus } from "@/lib/types";

const POLL_INTERVAL_MS = 800;

export function useScanPolling(sessionId: string) {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  // Smoothly animated progress — interpolates toward the server's target value
  const [displayProgress, setDisplayProgress] = useState(0);
  const targetProgressRef = useRef(0);
  const rafRef = useRef<number>(0);

  // Easing: animate display toward targetProgress
  useEffect(() => {
    const tick = () => {
      setDisplayProgress((prev) => {
        const target = targetProgressRef.current;
        const diff = target - prev;
        if (Math.abs(diff) < 0.15) return target;
        // Ease toward target (small steps = smooth feel)
        return prev + diff * 0.12;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Polling loop
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        const response = await fetch(`/api/scan/${sessionId}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          setStatus({
            sessionId,
            status: "failed",
            progress: 0,
            stageText: "",
            error: "会话已失效",
          });
          return;
        }

        const data: ScanStatus = await response.json();
        targetProgressRef.current = data.progress ?? 0;
        setStatus(data);

        if (data.status !== "processing") {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { status, displayProgress: Math.round(displayProgress) };
}