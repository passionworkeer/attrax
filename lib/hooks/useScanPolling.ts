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

/**
 * Per-stage asymptotic time constant (ms). The simulator advances
 * displayProgress toward the stage ceiling using
 * `target = floor + (ceiling - floor - 1) × (1 - exp(-elapsed / tau))`
 * so the user always sees real motion inside the active stage even when
 * the backend only emits 10 → 100 (audit 2026-09-13 §4.1). Larger tau
 * means slower growth — vision/generate are typically the longest stages
 * and need a longer tau to avoid jumping ahead too fast.
 */
const STAGE_TAU_MS: Record<string, number> = {
  queued: 2_500,
  vision: 4_500,
  retrieval: 6_000,
  report: 12_000,
  done: 1_500,
};
const STAGE_TAU_FALLBACK = 4_000;
const HARD_DISPLAY_CAP = 99; // never round up to 100 until backend confirms ready + 100

export function useScanPolling(
  sessionId: string,
  accessToken?: string | null,
) {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [displayProgress, setDisplayProgress] = useState(0);
  const targetProgressRef = useRef(0);
  const stageKeyRef = useRef<string>("queued");
  const stageEnteredAtRef = useRef<number>(0);
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
        const stageKey = stageKeyRef.current;
        const milestone = STAGE_MILESTONES[stageKey] ?? STAGE_MILESTONES.queued;
        const [floor, ceiling] = milestone;
        const stageTarget = Math.min(ceiling, SIMULATED_CEILING);

        const lastTick = lastTickAtRef.current || now;
        const dt = Math.max(0, now - lastTick);
        lastTickAtRef.current = now;

        if (isTerminalRef.current) {
          // Backend says ready/degraded but progress hasn't jumped yet — hold.
          return prev;
        }

        if (prev >= stageTarget) {
          // Already at the stage ceiling, wait for the next poll to unlock.
          return prev;
        }

        // Stage-asymptotic interpolation: displayProgress approaches the
        // stage ceiling with time constant `tau`, starting from `floor`.
        // This replaces the old broken `Math.max(realTarget, floor)` floor
        // that pinned progress to 10 forever (audit 2026-09-13 P0 §4.1).
        const tau = STAGE_TAU_MS[stageKey] ?? STAGE_TAU_FALLBACK;
        const stageEnteredAt = stageEnteredAtRef.current || now;
        const elapsed = Math.max(0, now - stageEnteredAt);
        const ceilingMargin = Math.max(0, ceiling - floor - 1);
        const eased = ceilingMargin * (1 - Math.exp(-elapsed / tau));
        const stageProgress = Math.min(stageTarget, floor + eased);

        // The simulator's value is authoritative within the active stage.
        // The real backend `progress` is a one-shot ramp (only 10 → 100) so
        // we never let it pin the UI backwards to 10 — but we still respect
        // monotonicity (displayProgress never decreases).
        return Math.max(prev, stageProgress);
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
        const previousStage = stageKeyRef.current;
        if (data.stageKey && data.stageKey !== previousStage) {
          stageKeyRef.current = data.stageKey;
          // Reset the per-stage clock so the asymptotic interpolation restarts
          // from the new stage's floor on the very next animation frame. This
          // is what the 2026-09-13 plan §4.1 calls out: each stage should
          // visibly ramp inside its own [floor, ceiling] range.
          stageEnteredAtRef.current = Date.now();
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

  return {
    status,
    /**
     * The simulator's progress rounded for display. Capped at 99 — never
     * round up to 100% before the backend reports a terminal `ready` /
     * `degraded` with `progress >= 100`. The burning page waits for the
     * backend confirmation before jumping to the result route (audit
     * 2026-09-13 §4.3).
     */
    displayProgress: Math.min(HARD_DISPLAY_CAP, Math.round(displayProgress)),
  };
}
