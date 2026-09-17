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
  const [lastContactAt, setLastContactAt] = useState<number | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [displayProgress, setDisplayProgress] = useState(0);
  // J01: `completing` is mirrored into state so the returned displayProgress
  // can branch on it without reading a ref during render (lint rule). The
  // ref remains the source of truth for the animation loop.
  const [isCompleting, setIsCompleting] = useState(false);
  /**
   * Wall-clock timestamp (ms) of the poll response that FIRST reported the
   * completing state. The burning page uses this as the hold-timer origin —
   * "when did we learn it's done" — instead of calling Date.now() during
   * render (React purity rules forbid that; capturing in the poll event
   * handler is the sanctioned spot).
   */
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const targetProgressRef = useRef(0);
  const stageKeyRef = useRef<string>("queued");
  const stageEnteredAtRef = useRef<number>(0);
  const isTerminalRef = useRef<boolean>(false);
  /**
   * Plan 2026-09-14 §4.1: the 99 cap only applies to NON-terminal states.
   * Once the backend reports `ready`/`degraded` AND `resultReady`, the poller
   * enters `completing` and the display progress is completed to a real 100
   * (backend terminal progress is already 100; we chase it directly instead
   * of holding at 99 forever — that exact deadlock is bug J01).
   */
  const isCompletingRef = useRef<boolean>(false);

  useEffect(() => {
    let rafId: number;
    const tick = (now: number) => {
      setDisplayProgress((prev) => {
        if (isCompletingRef.current) {
          // Backend confirmed ready + result addressable. Chase the backend's
          // terminal progress (100) directly — the real number is the truth.
          const diff = targetProgressRef.current - prev;
          if (Math.abs(diff) < 0.2) return targetProgressRef.current;
          return prev + diff * 0.2;
        }

        // Backend says ready/degraded but resultReady hasn't arrived yet —
        // hold wherever we are, never simulate into 100 (plan §4.1 rule: only
        // `ready && resultReady` may complete).
        if (isTerminalRef.current) {
          return prev;
        }

        // Otherwise drive progress via the active stage's [floor, ceiling].
        // We do NOT cross stage ceilings without backend confirmation —
        // a stage claim "report" stays inside [72, 92] until the poll returns
        // a later stage.
        const stageKey = stageKeyRef.current;
        const milestone = STAGE_MILESTONES[stageKey] ?? STAGE_MILESTONES.queued;
        const [floor, ceiling] = milestone;
        const stageTarget = Math.min(ceiling, SIMULATED_CEILING);

        if (prev >= stageTarget) {
          // Already at the stage ceiling, wait for the next poll to unlock.
          return prev;
        }

        // The real backend `progress` for the active stage, clamped to the
        // stage window — respects monotonicity without letting one-shot
        // backend jumps (10 → 100) pin the bar or leak the 99 cap early.
        const realTarget = targetProgressRef.current;

        // Stage-asymptotic interpolation: displayProgress approaches the
        // stage ceiling with time constant `tau`, starting from `floor`.
        // This replaces the old broken `Math.max(realTarget, floor)` floor
        // that pinned progress to 10 forever (audit 2026-09-13 P0 §4.1).
        // The real backend `progress` inside a stage is respected as a lower
        // bound (monotonic display) but the simulator owns pacing within the
        // stage so one-shot backend jumps (10 → 100) don't pin the bar.
        const tau = STAGE_TAU_MS[stageKey] ?? STAGE_TAU_FALLBACK;
        const stageEnteredAt = stageEnteredAtRef.current || now;
        const elapsed = Math.max(0, now - stageEnteredAt);
        const ceilingMargin = Math.max(0, ceiling - floor - 1);
        const eased = ceilingMargin * (1 - Math.exp(-elapsed / tau));
        const stageProgress = Math.min(stageTarget, floor + eased);
        return Math.max(prev, stageProgress, Math.min(realTarget, stageTarget));
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
      let hasResponse = false;
      let connectionFailures = 0;

      while (!cancelled) {
        let response: Response;
        try {
          const token =
            accessToken?.trim() ||
            sessionStorage.getItem(`scan-token:${sessionId}`)?.trim();
          response = await fetch(`/api/scan/${sessionId}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
        } catch (error) {
          if (cancelled) return;
          if (hasResponse && connectionFailures++ < 3) {
            setReconnecting(true);
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }
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

        if (!response.ok && response.status >= 500 && hasResponse && connectionFailures++ < 3) {
          if (cancelled) return;
          setReconnecting(true);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          continue;
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

        if (cancelled) return;
        hasResponse = true;
        connectionFailures = 0;
        setLastContactAt(Date.now());
        setReconnecting(false);
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
        // Plan 2026-09-14 §4.1: `ready && resultReady` (BFF contract) moves
        // the poller into the `completing` state — the simulator stops
        // pretending and the display progress is driven to a real 100.
        // A terminal status WITHOUT resultReady (failed, or a ready transition
        // racing the result persist) stays capped; only a failure path may
        // leave the poller non-complete.
        isCompletingRef.current =
          isDisplayableTerminalStatus(data.status) && data.resultReady === true;
        if (!cancelled) {
          setStatus(data);
          setIsCompleting(isCompletingRef.current);
          // Capture the completion timestamp once, in the poll event
          // handler (pure-render compliant). Cleared if a later poll flips
          // back (e.g. a revision re-run restarts processing).
          if (isCompletingRef.current && completedAt === null) {
            setCompletedAt(Date.now());
          } else if (!isCompletingRef.current && completedAt !== null) {
            setCompletedAt(null);
          }
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
  }, [sessionId, accessToken, completedAt]);

  return {
    lastContactAt,
    reconnecting,
    status,
    /**
     * Timestamp (ms) of the first poll response that reported the completing
     * state; null while non-complete. Serves as the burning page's hold-timer
     * origin (plan §4.1 (4): hold ~600ms from the observed completion).
     */
    completedAt,
    /**
     * The simulator's progress rounded for display. Capped at 99 while the
     * scan is NOT complete — plan 2026-09-14 §4.1 (bug J01): once the backend
     * reports a terminal `ready`/`degraded` WITH `resultReady`, the poller is
     * in `completing` state and the cap is lifted so the display reaches a
     * real 100 and the burning page can complete its hold-then-navigate
     * sequence. Failures stay capped (no fake 100 on failure paths).
     */
    displayProgress: isCompleting
      ? Math.round(Math.min(100, displayProgress))
      : Math.min(HARD_DISPLAY_CAP, Math.round(displayProgress)),
  };
}
