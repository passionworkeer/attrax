"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useScanPolling } from "@/lib/hooks/useScanPolling";
import { cn } from "@/lib/utils";

export default function BurningPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const status = useScanPolling(sessionId);

  useEffect(() => {
    if (status?.status === "ready" && status.result) {
      sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(status.result));
      router.push(`/result/${sessionId}`);
    }
  }, [router, sessionId, status]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-blaze-dark px-4 sm:px-6 py-16 text-white">
      <section className="mx-4 w-full max-w-2xl rounded-4xl border border-white/10 bg-white/6 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur sm:mx-auto">
        <p className="text-sm uppercase tracking-[0.28em] text-white/55">Burning</p>
        <h1 className="mt-4 text-3xl font-semibold">雄鹰正在分析你的产品</h1>
        <p className="mt-3 text-sm leading-6 text-white/70">
          当前会话：<span className="font-mono text-white">{sessionId}</span>
        </p>

        <div className="mt-8 space-y-4 rounded-3xl bg-white/7 p-5">
          <Progress value={status?.progress ?? 0} className="h-2 bg-white/10" />
          <div className="flex items-center justify-between text-sm text-white/80">
            <span>{status?.stageText ?? "等待任务启动…"}</span>
            <span>{status?.progress ?? 0}%</span>
          </div>
        </div>

        {status?.status === "failed" ? (
          <div className="mt-6 space-y-4 rounded-3xl border border-red-400/30 bg-red-500/10 p-5">
            <p className="text-sm text-red-100">{status.error ?? "扫描失败。"}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={() => router.push("/upload")}>
                重新上传
              </Button>
              <Link
                href="/result/demo"
                className={cn(
                  buttonVariants({ size: "lg", variant: "outline" }),
                  "border-white/20 bg-transparent text-white hover:bg-white/10"
                )}
              >
                查看 Demo
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
