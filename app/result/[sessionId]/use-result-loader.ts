"use client";

import { startTransition, useEffect, useState } from "react";
import { isRetryableStatus, MAX_TRANSIENT_RETRIES, transientRetryDelayMs } from "@/lib/transient-retry";
import type { ScanResult, ScanStatus } from "@/lib/types";
import { readStoredAccessToken } from "@/lib/result-view-helpers";

/**
 * Result 页结果加载轮询 hook（2026-09-10 自 page.tsx 抽出，审计 2.5）。
 * 逻辑与原实现一致：sessionStorage 恢复 → /api/scan/{id} 轮询 → degraded
 * 状态记录（P0-1）。demo session 直接用 mock，不发起请求。
 */

interface CopyTexts {
  failed: string;
  loaded: string;
  notFound: string;
  processing: string;
  restored: string;
}

export function useResultLoader(options: {
  sessionId: string;
  isDemoSession: boolean;
  locale: "zh" | "en";
  initialResult: ScanResult | null;
  loadingMessage: string;
  copy: CopyTexts;
}) {
  const { sessionId, isDemoSession, locale, initialResult, loadingMessage, copy } = options;
  const [result, setResult] = useState<ScanResult | null>(initialResult);
  // P0-1 闭环：降级原因随轮询记录，驱动顶部红色 DegradedBanner（审计 1.3）
  const [degradedReason, setDegradedReason] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(initialResult ? "ready" : "loading");
  const [retryKey, setRetryKey] = useState(0);
  const [message, setMessage] = useState(loadingMessage);
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || isDemoSession) {
      return;
    }

    let cancelled = false;
    // Audit P1-F: share the AbortController between the polling loop and
    // the effect cleanup so navigation away cancels in-flight fetches.
    const abortController = new AbortController();

    startTransition(() => setLoadState("loading"));
    let cached: string | null = null;
    try { cached = sessionStorage.getItem(`scan:${sessionId}`); } catch { /* storage is optional */ }
    if (cached && retryKey === 0) {
      try {
        const cachedResult = JSON.parse(cached) as ScanResult;
        if (!cachedResult || cachedResult.sessionId !== sessionId || !Array.isArray(cachedResult.riskPoints)) throw new Error("Invalid cached scan");
        startTransition(() => {
          setResult(cachedResult);
          setSelectedRiskId(cachedResult.riskPoints[0]?.riskId ?? null);
          setMessage(copy.restored);
          setLoadState("ready");
        });
        return;
      } catch {
        try { sessionStorage.removeItem(`scan:${sessionId}`); } catch { /* storage is optional */ }
      }
    }

    async function loadResult() {
      // Audit P1-F: cap the total polling window so a stuck scan cannot
      // hammer the backend forever, exponential-backoff between polls so
      // idle scans don't generate ~3 req/s, and abort the in-flight fetch
      // when the consumer unmounts (previously the request ran to
      // completion even after navigation away).
      const startedAt = Date.now();
      const POLL_MAX_MS = 5 * 60 * 1000;
      const POLL_BACKOFF_MS = 1500;
      const POLL_BACKOFF_CAP_MS = 8000;

      try {
        let idleStreak = 0;
        let transientRetries = 0;
        while (!cancelled) {
          if (Date.now() - startedAt > POLL_MAX_MS) {
            startTransition(() => {
              setLoadState("error");
              setMessage(
                locale === "zh"
                  ? "扫描超时，请稍后刷新或重新检测。"
                  : "The scan timed out. Please reload or try again.",
              );
            });
            return;
          }
          const accessToken = readStoredAccessToken(sessionId);
          const headers: Record<string, string> = {};
          if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
          }
          const response = await fetch(`/api/scan/${sessionId}`, {
            cache: "no-store",
            headers,
            signal: abortController.signal,
          });
          if (!response.ok) {
            // 429/5xx 是可自愈的（限流排队、上游重启），退避重试若干次；
            // 直接进错误面板会让用户以为结果坏了（扫描往往还在跑）。
            if (isRetryableStatus(response.status) && transientRetries < MAX_TRANSIENT_RETRIES) {
              transientRetries += 1;
              await new Promise((resolve) =>
                setTimeout(resolve, transientRetryDelayMs(transientRetries)),
              );
              if (abortController.signal.aborted || cancelled) return;
              continue;
            }
            startTransition(() => {
              setLoadState("error");
              setMessage(response.status === 401 || response.status === 403
                ? locale === "zh" ? "此结果的访问凭证已失效，请从原浏览器打开或重新检测。" : "Access to this result has expired. Open it in the original browser or start a new scan."
                : response.status === 404 ? copy.notFound
                : locale === "zh" ? "结果服务暂时不可用，请重试加载。" : "The results service is temporarily unavailable. Retry loading.");
            });
            return;
          }

          const payload: ScanStatus = await response.json();
          if (
            (payload.status === "ready" || payload.status === "degraded") &&
            payload.result
          ) {
            const resultPayload = payload.result;
            try { sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(resultPayload)); } catch { /* show the result even if storage is full */ }
            startTransition(() => {
              setLoadState("ready");
              if ("financialSummary" in resultPayload) {
                setResult(resultPayload);
                setSelectedRiskId(resultPayload.riskPoints?.[0]?.riskId ?? null);
              } else {
                setResult(resultPayload as ScanResult);
                setSelectedRiskId(
                  "riskPoints" in resultPayload
                    ? resultPayload.riskPoints?.[0]?.riskId ?? null
                    : null,
                );
              }
              setDegradedReason(payload.status === "degraded" ? payload.degradedReason ?? "degraded" : null);
              setMessage(
                payload.status === "degraded"
                  ? locale === "zh"
                    ? "后端返回了明确标记的降级结果。"
                    : "The backend returned an explicitly degraded result."
                  : copy.loaded,
              );
            });
            return;
          }

          if (payload.status === "failed") {
            startTransition(() => {
              setLoadState("error");
              setMessage(payload.error ?? copy.failed);
            });
            return;
          }

          startTransition(() => {
            setMessage(copy.processing);
          });
          // Exponential backoff with a ceiling: idle polls space out (1.5s →
          // 3s → 6s → 8s) so a 3-minute scan produces ~70 polls instead of
          // 200. Resets whenever the backend reports fresh progress; falls
          // back to the cap on idle streaks.
          idleStreak = payload.progress > 0 ? 0 : idleStreak + 1;
          const delay = Math.min(
            POLL_BACKOFF_CAP_MS,
            POLL_BACKOFF_MS * 2 ** Math.min(idleStreak, 4),
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch (error) {
        if (abortController.signal.aborted || cancelled) return;
        startTransition(() => {
          setLoadState("error");
          setMessage(
            locale === "zh"
              ? "结果加载失败，请检查本地服务后重新检测。"
              : "The result failed to load. Check the local service and scan again.",
          );
        });
      } finally {
        // Always release the abort controller so a future re-mount doesn't
        // trip over a stale AbortSignal.
        abortController.abort();
      }
    }

    loadResult();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    copy.failed,
    copy.loaded,
    copy.notFound,
    copy.processing,
    copy.restored,
    isDemoSession,
    locale,
    sessionId,
    retryKey,
  ]);


  return {
    loadState,
    retry: () => setRetryKey((key) => key + 1),
    result,
    setResult,
    degradedReason,
    setDegradedReason,
    message,
    setMessage,
    selectedRiskId,
    setSelectedRiskId,
  };
}
