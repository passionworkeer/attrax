"use client";

import { useEffect, useRef, useState } from "react";
import type { ScanStatus } from "@/lib/types";

const POLL_INTERVAL_MS = 800;

function failedStatus(sessionId: string, error: string): ScanStatus {
  return {
    sessionId,
    status: "failed",
    progress: 0,
    stageText: "",
    error,
  };
}

function isScanStatusLike(value: unknown): value is ScanStatus {
  if (!value || typeof value !== "object") return false;

  const status = (value as { status?: unknown }).status;
  return status === "processing" || status === "ready" || status === "failed";
}

export function useScanPolling(sessionId: string) {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [displayProgress, setDisplayProgress] = useState(0);
  const targetProgressRef = useRef(0);

  useEffect(() => {
    let rafId: number;
    const tick = () => {
      setDisplayProgress((prev) => {
        const target = targetProgressRef.current;
        const diff = target - prev;
        if (Math.abs(diff) < 0.15) return target;
        return prev + diff * 0.12;
      });
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        let response: Response;
        try {
          response = await fetch(`/api/scan/${sessionId}`, {
            cache: "no-store",
          });
        } catch (error) {
          if (!cancelled) {
            setStatus(
              failedStatus(
                sessionId,
                error instanceof Error ? error.message : "Scan request failed."
              )
            );
          }
          return;
        }

        if (!response.ok) {
          if (!cancelled) {
            setStatus(failedStatus(sessionId, "Scan session expired."));
          }
          return;
        }

        let data: unknown;
        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (!isScanStatusLike(data)) {
          if (!cancelled) {
            setStatus(failedStatus(sessionId, "Invalid scan response."));
          }
          return;
        }

        targetProgressRef.current = data.progress ?? 0;
        if (!cancelled) {
          setStatus(data);
        }

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
