"use client";

import { useEffect, useState } from "react";
import type { ScanStatus } from "@/lib/types";

const TOKEN_STORAGE_PREFIX = "scan-token:";

function readStoredToken(sessionId: string): string | null {
  try {
    const value = sessionStorage.getItem(TOKEN_STORAGE_PREFIX + sessionId);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function readQueryToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function useScanPolling(
  sessionId: string,
  accessToken?: string | null,
) {
  const [status, setStatus] = useState<ScanStatus | null>(null);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        while (!cancelled) {
          // Token resolution (BFF accessToken handshake):
          //   1. accessToken argument (preferred — never logged)
          //   2. sessionStorage under "scan-token:<sessionId>" (page-persisted)
          //   3. ?token= query param (opt-in fallback for clients that can't
          //      set custom headers). When none of these is available, the
          //      server will reject with 401; we surface one warn so the
          //      handshake gap is obvious during dev instead of silent fail.
          const headers: Record<string, string> = {};
          let queryToken: string | null = null;

          if (sessionId !== "demo") {
            const tokenFromArg = accessToken?.trim();
            const tokenFromStorage = tokenFromArg ? null : readStoredToken(sessionId);
            const resolvedToken = tokenFromArg || tokenFromStorage;

            if (resolvedToken) {
              headers.Authorization = `Bearer ${resolvedToken}`;
            } else {
              queryToken = readQueryToken();
              if (!queryToken) {
                console.warn(
                  `[useScanPolling] No accessToken resolved for sessionId=${sessionId}; ` +
                    "Authorization header missing, ?token= fallback not present."
                );
              }
            }
          }

          const url = queryToken
            ? `/api/scan/${sessionId}?token=${encodeURIComponent(queryToken)}`
            : `/api/scan/${sessionId}`;

          const response = await fetch(url, {
            cache: "no-store",
            headers,
          });

          if (!response.ok) {
            setStatus({
              sessionId,
              status: "failed",
              progress: 0,
              stageText: "",
              stageKey: "failed",
              error: "会话已失效",
            });
            return;
          }

          const data: ScanStatus = await response.json();
          setStatus(data);

          if (data.status !== "processing") {
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch {
        if (!cancelled) {
          setStatus({
            sessionId,
            status: "failed",
            progress: 0,
            stageText: "连接本地扫描服务失败",
            stageKey: "failed",
            error: "连接本地扫描服务失败，请确认服务运行后重试。",
          });
        }
      }
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [sessionId, accessToken]);

  return status;
}
