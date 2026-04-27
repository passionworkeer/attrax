"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ScanStartResponse = {
  sessionId: string;
  status: "processing";
  pollUrl: string;
};

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!files.length) {
      setError("请先选择至少 1 张图片。");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("images", file);
      }

      formData.append("category", "electronics");
      formData.append("markets", "EU,US");

      const response = await fetch("/api/scan", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | ScanStartResponse
        | { error?: { message?: string } };

      if (!response.ok) {
        const errorPayload = payload as { error?: { message?: string } };
        throw new Error(errorPayload.error?.message ?? "提交失败，请稍后重试。");
      }

      if (!("sessionId" in payload)) {
        throw new Error("接口未返回有效的 sessionId。");
      }

      router.push(`/burning/${payload.sessionId}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "提交失败，请稍后重试。"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-16">
      <div className="rounded-4xl border border-white/60 bg-white/85 p-8 shadow-[0_30px_100px_rgba(26,26,46,0.12)] backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-blaze-red/80">
          Upload
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
          选择产品图片
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          这是 P1 的占位上传页。当前默认按电子产品、EU+US 市场发起 Demo 扫描。
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <input
            type="file"
            multiple
            accept="image/*"
            className="block w-full rounded-2xl border border-dashed border-border bg-blaze-surface px-4 py-6 text-sm"
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
            }}
          />

          <div className="rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
            已选择 {files.length} 张图片
          </div>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            className="w-full bg-blaze-red text-white hover:bg-blaze-red/90"
            disabled={submitting}
          >
            {submitting ? "提交中…" : "提交并开始扫描"}
          </Button>
        </form>
      </div>
    </main>
  );
}
