"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera, CloudUpload, Flame, PlusCircle, ScanLine } from "lucide-react";
import { UploadForm } from "@/components/upload/UploadForm";
import { useTranslation } from "@/lib/i18n";
import { unwrapApiData } from "@/lib/api-response";
import type { Category, Market } from "@/components/upload/UploadForm";
import { cn } from "@/lib/utils";

type ScanStartResponse = {
  sessionId: string;
  accessToken: string;
  status: "processing";
  pollUrl: string;
};

type ScanStartError = {
  success?: false;
  error?: {
    code?: string;
    reason?: string;
    message?: string;
    messageEn?: string;
  };
};

const SCAN_ERROR_REASON_KEYS: Record<string, string> = {
  INVALID_REQUEST: "errors.invalidRequest",
  UPLOAD_AT_LEAST_ONE_IMAGE: "errors.uploadAtLeastOne",
  TOO_MANY_DOCUMENTS: "errors.tooManyDocuments",
};

export default function UploadPage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getUploadErrorMessage(payload: ScanStartError): string {
    const error = "error" in payload && payload.error ? payload.error : undefined;
    const reason = error?.reason;
    const key = reason ? SCAN_ERROR_REASON_KEYS[reason] : undefined;
    if (key) return t(key);
    if (locale === "en") return error?.messageEn ?? t("errors.uploadFailed");
    return error?.message ?? t("errors.uploadFailed");
  }

  async function handleSubmit(data: {
    images: File[];
    documents: File[];
    category: Category;
    markets: Market[];
  }) {
    setSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      for (const file of data.images) {
        formData.append("images", file);
      }
      for (const file of data.documents) {
        formData.append("documents", file);
      }
      formData.append("category", data.category);
      formData.append("markets", data.markets.join(","));

      const response = await fetch("/api/scan", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as
        | { success: true; data: ScanStartResponse }
        | ScanStartResponse
        | ScanStartError;
      const startData = unwrapApiData<ScanStartResponse>(payload);

      if (!response.ok) {
        throw new Error(getUploadErrorMessage(payload as ScanStartError));
      }

      if (!startData?.sessionId || !startData.accessToken) {
        throw new Error(t("errors.invalidSessionId"));
      }

      sessionStorage.setItem(`scan-token:${startData.sessionId}`, startData.accessToken);
      router.push(`/burning/${startData.sessionId}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : t("errors.uploadFailed")
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isEn = locale === "en";

  return (
    <main className="min-h-[calc(100vh-5rem)] px-4 sm:px-6 py-8">
      <div className="mx-auto max-w-[1440px]">
        {/* Top bar with back + title */}
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm data-mono text-slate-400 hover:text-blaze-red transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {isEn ? "Back to Home" : "返回首页"}
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {isEn ? "Overseas Compliance Scan" : "出海合规全流程扫描"}
          </h1>
          <div className="w-[120px]" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left column: Control panel */}
          <div className="lg:col-span-5 glass-panel rounded-2xl p-6 sm:p-8 flex flex-col gap-6 h-full">
            <div className="space-y-2">
              <p className="label-caps text-xs text-blaze-red/80">Step 1 / 4</p>
              <h2 className="text-2xl font-bold text-white">
                {isEn ? "Upload & Configure" : "上传产品 · 配置参数"}
              </h2>
            </div>

            <UploadForm
              onSubmit={handleSubmit}
              isSubmitting={submitting}
              error={error}
            />
          </div>

          {/* Right column: Camera preview */}
          <div className="lg:col-span-7 glass-panel rounded-2xl overflow-hidden relative min-h-[520px] flex items-center justify-center border border-white/10">
            {/* Camera feed background */}
            <div
              className="absolute inset-0 bg-cover bg-center z-0"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #0b0f11 0%, #16213e 50%, #1a1a2e 100%)",
              }}
            />
            <div className="absolute inset-0 bg-blaze-dark/60 z-10" />
            <div
              className="absolute inset-0 opacity-30 z-10"
              style={{
                backgroundImage:
                  "radial-gradient(circle at center, rgba(217,58,26,0.15) 0%, transparent 70%)",
              }}
            />

            <div className="relative z-20 w-full h-full flex flex-col items-center justify-between py-10 px-6 min-h-[520px]">
              {/* Top badge */}
              <div className="bg-black/60 backdrop-blur-md border border-white/20 rounded-full px-5 py-2.5 flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-blaze-red animate-pulse" />
                <span className="text-base font-semibold text-white">
                  {isEn
                    ? "Place the product flat, facing the camera"
                    : "请将产品平放，正对镜头拍摄"}
                </span>
              </div>

              {/* Alignment frame */}
              <div className="relative w-[min(420px,80vw)] h-[min(420px,80vw)] flex items-center justify-center">
                <div className="corner-mark corner-tl" />
                <div className="corner-mark corner-tr" />
                <div className="corner-mark corner-bl" />
                <div className="corner-mark corner-br" />
                <div className="w-64 h-64 border-2 border-dashed border-white/20 rounded-lg flex flex-col items-center justify-center text-white/40 bg-white/5 backdrop-blur-sm">
                  <CloudUpload className="h-16 w-16 mb-3" />
                  <span className="data-mono text-sm">Product Area</span>
                </div>
              </div>

              {/* Camera button */}
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  className="w-[160px] h-12 bg-blaze-red hover:bg-blaze-red/90 text-white rounded-full text-lg font-bold shadow-[0_0_25px_rgba(217,58,26,0.6)] transition-all flex items-center justify-center gap-2 border border-white/20"
                >
                  <Camera className="h-5 w-5" fill="white" />
                  {isEn ? "Capture" : "拍摄"}
                </button>
                <div className="flex items-center gap-2 text-xs text-slate-400 data-mono">
                  <PlusCircle className="h-3.5 w-3.5 text-blaze-red" />
                  {isEn ? "BOM list / spec sheet (optional)" : "补充上传 BOM 清单/规格书（选填）"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
