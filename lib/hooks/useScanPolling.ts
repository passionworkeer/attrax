"use client";

import { useEffect, useRef, useState } from "react";
import { unwrapApiData } from "@/lib/api-response";
import type { ScanStatus } from "@/lib/types";
import {
  POLL_INITIAL_INTERVAL_MS,
  POLL_MAX_DURATION_MS,
  POLL_MAX_INTERVAL_MS,
} from "@/lib/constants";

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
      let intervalMs = POLL_INITIAL_INTERVAL_MS;
      const startedAt = Date.now();

      while (!cancelled) {
        let response: Response;
        try {
          const token = sessionStorage.getItem(`scan-token:${sessionId}`);
          response = await fetch(`/api/scan/${sessionId}`, {
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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

        let rawData: unknown;
        try {
          rawData = await response.json();
        } catch {
          rawData = null;
        }

        const data = unwrapApiData<ScanStatus>(rawData);

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

        if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
          if (!cancelled) {
            setStatus(failedStatus(sessionId, "Scan timed out."));
          }
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        intervalMs = Math.min(intervalMs * 1.5, POLL_MAX_INTERVAL_MS);
      }
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { status, displayProgress: Math.round(displayProgress) };
}
