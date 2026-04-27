"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { mockScanResult } from "@/lib/mock/scan-result";
import type { ScanResult, ScanStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function ResultPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const isDemoSession = sessionId === "demo";
  const [result, setResult] = useState<ScanResult | null>(
    isDemoSession ? mockScanResult : null
  );
  const [message, setMessage] = useState("正在加载扫描结果…");

  useEffect(() => {
    if (!sessionId || isDemoSession) {
      return;
    }

    const cached = sessionStorage.getItem(`scan:${sessionId}`);
    if (cached) {
      try {
        const cachedResult = JSON.parse(cached) as ScanResult;
        startTransition(() => {
          setResult(cachedResult);
          setMessage("已从会话缓存恢复结果。");
        });
        return;
      } catch {
        sessionStorage.removeItem(`scan:${sessionId}`);
      }
    }

    async function loadResult() {
      const response = await fetch(`/api/scan/${sessionId}`, { cache: "no-store" });
      if (!response.ok) {
        startTransition(() => {
          setMessage("未找到对应扫描结果。");
        });
        return;
      }

      const payload: ScanStatus = await response.json();
      if (payload.status === "ready" && payload.result) {
        startTransition(() => {
          setResult(payload.result ?? null);
          setMessage("结果已从接口载入。");
        });
        return;
      }

      if (payload.status === "failed") {
        startTransition(() => {
          setMessage(payload.error ?? "扫描失败。");
        });
        return;
      }

      startTransition(() => {
        setMessage("扫描仍在处理中，请稍后刷新或返回加载页。");
      });
    }

    loadResult();
  }, [isDemoSession, sessionId]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-16">
      <section className="rounded-4xl border border-white/60 bg-white/85 p-8 shadow-[0_30px_100px_rgba(26,26,46,0.12)] backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-blaze-red/80">Result</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {isDemoSession ? "Demo 扫描结果" : `扫描结果 · ${sessionId}`}
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {isDemoSession ? "已载入 Demo 数据。" : message}
            </p>
          </div>
          <Link
            href="/upload"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "shrink-0")}
          >
            重新上传
          </Link>
        </div>

        <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-blaze-dark/95">
          <pre className="max-h-[70vh] overflow-auto p-6 text-sm leading-6 text-white/90">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      </section>
    </main>
  );
}
