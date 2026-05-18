"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadForm } from "@/components/upload/UploadForm";
import { useTranslation } from "@/lib/i18n";
import type { Category, Market } from "@/components/upload/UploadForm";

type ScanStartResponse = {
  sessionId: string;
  status: "processing";
  pollUrl: string;
};

export default function UploadPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        | ScanStartResponse
        | { error?: { message?: string } };

      if (!response.ok) {
        const errorPayload = payload as { error?: { message?: string } };
        throw new Error(errorPayload.error?.message ?? t("errors.uploadFailed"));
      }

      if (!("sessionId" in payload)) {
        throw new Error(t("errors.invalidSessionId"));
      }

      router.push(`/burning/${payload.sessionId}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : t("errors.uploadFailed")
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 sm:px-6 py-16">
      <div className="rounded-4xl border border-white/60 bg-white/85 p-8 shadow-[0_30px_100px_rgba(26,26,46,0.12)] backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-blaze-red/80">
          Upload
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
          {t("upload.title")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t("upload.description")}
        </p>

        <UploadForm
          onSubmit={handleSubmit}
          isSubmitting={submitting}
          error={error}
        />
      </div>
    </main>
  );
}