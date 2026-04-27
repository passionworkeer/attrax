"use client";

import { useEffect, useState } from "react";
import type { ScanStatus } from "@/lib/types";

export function useScanPolling(sessionId: string) {
  const [status, setStatus] = useState<ScanStatus | null>(null);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

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
        setStatus(data);

        if (data.status !== "processing") {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return status;
}
