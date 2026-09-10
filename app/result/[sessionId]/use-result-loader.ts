"use client";

import { startTransition, useEffect, useState } from "react";
import { createMockScanResult, mockScanResult } from "@/lib/mock/blaze-scan-result";
import type { Market, ProductCategory, ScanResult, ScanStatus } from "@/lib/types";
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
  const [message, setMessage] = useState(loadingMessage);
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || isDemoSession) {
      return;
    }

    let cancelled = false;

    const cached = sessionStorage.getItem(`scan:${sessionId}`);
    if (cached) {
      try {
        const cachedResult = JSON.parse(cached) as ScanResult;
        startTransition(() => {
          setResult(cachedResult);
          setSelectedRiskId(cachedResult.riskPoints[0]?.riskId ?? null);
          setMessage(copy.restored);
        });
        return;
      } catch {
        sessionStorage.removeItem(`scan:${sessionId}`);
      }
    }

    async function loadResult() {
      try {
        while (!cancelled) {
          const accessToken = readStoredAccessToken(sessionId);
          const headers: Record<string, string> = {};
          if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
          }
          const response = await fetch(`/api/scan/${sessionId}`, {
            cache: "no-store",
            headers,
          });
          if (!response.ok) {
            startTransition(() => {
              setMessage(copy.notFound);
            });
            return;
          }

          const payload: ScanStatus = await response.json();
          if (
            (payload.status === "ready" || payload.status === "degraded") &&
            payload.result
          ) {
            const resultPayload = payload.result;
            sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(resultPayload));
            startTransition(() => {
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
              setMessage(payload.error ?? copy.failed);
            });
            return;
          }

          startTransition(() => {
            setMessage(copy.processing);
          });
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      } catch {
        if (!cancelled) {
          startTransition(() => {
            setMessage(
              locale === "zh"
                ? "结果加载失败，请检查本地服务后重新检测。"
                : "The result failed to load. Check the local service and scan again."
            );
          });
        }
      }
    }

    loadResult();

    return () => {
      cancelled = true;
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
  ]);


  return {
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
