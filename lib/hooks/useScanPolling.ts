"use client";

import { useEffect, useRef, useState } from "react";
import { unwrapApiData } from "@/lib/api-response";
import type { ScanStatus } from "@/lib/types";
import {
  POLL_INITIAL_INTERVAL_MS,
  POLL_MAX_DURATION_MS,
  POLL_MAX_INTERVAL_MS,
} from "@/lib/constants";

/** @internal Exported for unit tests only — not part of the public hook API. */
export function failedStatus(sessionId: string, error: string): ScanStatus {
  return {
    sessionId,
    status: "failed",
    progress: 0,
    stageText: "",
    error,
  };
}

/** @internal Exported for unit tests only — not part of the public hook API. */
export function isScanStatusLike(value: unknown): value is ScanStatus {
  if (!value || typeof value !== "object") return false;

  const status = (value as { status?: unknown }).status;
  // Includes `degraded` (RAG unavailable fallback) so the poller surfaces the
  // fallback result instead of treating the payload as invalid and polling
  // until timeout. See lib/types.ts ScanStatus for the full contract.
  return (
    status === "processing" ||
    status === "ready" ||
    status === "degraded" ||
    status === "failed"
  );
}

export function isDisplayableTerminalStatus(status: ScanStatus["status"]): boolean {
  return status === "ready" || status === "degraded";
}

/**
 * Per-stage progress milestones the backend never reports but the burning
 * page needs in order to give the user real motion between polls. Each stage
 * has a [floor, ceiling] range; the simulator advances displayProgress
 * inside the active stage and never crosses into the next one until the
 * backend confirms it (poll returns a new stageKey). The simulator also
 * caps at `SIMULATED_CEILING` so we never display 100% before the backend
 * actually completes (which would race the real `progress` jump to 100).
 */
const STAGE_MILESTONES: Record<string, [number, number]> = {
  queued: [8, 18],
  vision: [18, 42],
  retrieval: [42, 72],
  report: [72, 92],
  done: [92, 99],
};
const SIMULATED_CEILING = 92;

export function useScanPolling(
  sessionId: string,
  accessToken?: string | null,
) {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [displayProgress, setDisplayProgress] = useState(0);
  const targetProgressRef = useRef(0);
  const stageKeyRef = useRef<string>("queued");
  const lastTickAtRef = useRef<number>(0);
  const isTerminalRef = useRef<boolean>(false);

  useEffect(() => {
    let rafId: number;
    const tick = (now: number) => {
      setDisplayProgress((prev) => {
        // Once the backend has reported a real terminal progress (>= 95),
        // chase it directly without simulation — the real number is the truth.
        const realTarget = targetProgressRef.current;
        if (realTarget >= 95) {
          const diff = realTarget - prev;
          if (Math.abs(diff) < 0.2) return realTarget;
          return prev + diff * 0.2;
        }

        // Otherwise drive progress via the active stage's [floor, ceiling].
        // We do NOT cross stage ceilings without backend confirmation —
        // a stage claim "report" stays inside [72, 92] until the poll returns
        // a later stage.
        const milestone = STAGE_MILESTONES[stageKeyRef.current] ??
          STAGE_MILESTONES.queued;
        const [floor, ceiling] = milestone;
        const stageTarget = Math.min(ceiling, SIMULATED_CEILING);

        // Pseudo-random jitter so two concurrent scans don't look in lockstep,
        // and so a stuck session still shows motion rather than freezing.
        const lastTick = lastTickAtRef.current || now;
        const dt = Math.max(0, now - lastTick);
        lastTickAtRef.current = now;

        // Speed in percent-per-millisecond. The base speed is calibrated so a
        // stage covering ~25 progress points takes ~6-9 seconds, which is
        // long enough to feel like work without dragging.
        const baseSpeed = 0.0035; // ~ 3.5 percent per second
        const jitter = isTerminalRef.current
          ? 0
          : (Math.sin(now * 0.0011) + Math.cos(now * 0.0007)) * 0.0008;
        const advance = (baseSpeed + jitter) * dt;

        if (isTerminalRef.current) {
          // Backend says ready/degraded but progress hasn't jumped yet — hold.
          return prev;
        }

        if (prev >= stageTarget) {
          // Already at the stage ceiling, wait for the next poll to unlock.
          return prev;
        }
        const next = Math.min(stageTarget, Math.max(floor, prev + advance));
        // Never let the simulator race ahead of the latest real progress.
        return Math.min(next, Math.max(realTarget, floor));
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
          const token =
            accessToken?.trim() ||
            sessionStorage.getItem(`scan-token:${sessionId}`)?.trim();
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
        if (data.stageKey) {
          stageKeyRef.current = data.stageKey;
        }
        isTerminalRef.current = data.status !== "processing";
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
  }, [sessionId, accessToken]);

  return { status, displayProgress: Math.round(displayProgress) };
}
