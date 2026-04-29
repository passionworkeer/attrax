"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { mockScanResult } from "@/lib/mock/scan-result";
import type { ScanResult, ScanStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

        {result && result.documents.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold">已上传文档</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              共 {result.documents.length} 份文档
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {result.documents.map((doc) => {
                const typeLabel = doc.type.toUpperCase();
                const isPdf = doc.type === "pdf";
                const isDocx = doc.type === "docx";
                return (
                  <a
                    key={doc.documentId}
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-blaze-red/40 hover:bg-blaze-surface/60"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      {isPdf ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-5 text-red-500">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={cn("size-5", isDocx ? "text-blue-600" : "text-orange-500")}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">{doc.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {typeLabel} · {formatBytes(doc.size)}
                      </p>
                    </div>
                  </a>
                );
              })}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
