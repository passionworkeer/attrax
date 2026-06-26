"use client";

import { useTranslation } from "@/lib/i18n";

export type ReportLocale = "zh" | "en";

/**
 * Inline notice for non-real scan results (fallback heuristic, demo mode).
 * Returns null for real RAG-backed results.
 */
export function SourceNotice({ source }: { source?: "real" | "fallback" | "demo" }) {
  const { t } = useTranslation();
  if (source === "fallback") {
    return (
      <div className="mt-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm text-amber-300">
        {t("result.fallbackNotice")}
      </div>
    );
  }
  if (source === "demo") {
    return (
      <div className="mt-6 rounded-2xl border border-blaze-cyan/40 bg-blaze-cyan/10 px-5 py-4 text-sm text-blaze-cyan">
        {t("result.demoNotice")}
      </div>
    );
  }
  return null;
}
