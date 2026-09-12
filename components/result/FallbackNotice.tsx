"use client";

import { useTranslation } from "@/lib/i18n";

/**
 * Soft-yellow notice shown when the KB-anchored pipeline successfully produced
 * a report but used the markdown-fallback path (LLM failed, partial chunks
 * exist, validator kept the partial package).
 *
 * Audit P1-2: previously, `validationStatus="fallback"` was the schema's honest
 * flag for "this report is real-shaped but the LLM did not produce it" — yet
 * no UI component read it, so users saw a clean 4-scene report with no
 * warning. The red `DegradedBanner` only fires when the WHOLE pipeline fails
 * (`payload.status === "degraded"`); this softer notice fills the middle case.
 *
 * Reads from `reportPackage.auditMetadata.validationStatus`, which the schema
 * normalizer sets to "fallback" when `_fallback_report_package` is emitted.
 */
export interface FallbackNoticeProps {
  validationStatus?: string;
  fallbackReason?: string;
}

export function FallbackNotice({ validationStatus, fallbackReason }: FallbackNoticeProps) {
  const { t } = useTranslation();

  if (validationStatus !== "fallback") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="fallback-notice"
      className="mt-6 rounded-2xl border border-amber-400/55 bg-amber-400/10 px-5 py-4 shadow-[0_0_24px_rgba(245,158,11,0.18)]"
    >
      <div className="flex items-start gap-3">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-amber-300"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-100">
            {t("result.partialFallbackNotice")}
          </p>
          {fallbackReason ? (
            <p className="mt-1 font-mono text-[11px] text-amber-200/80">
              [{fallbackReason}]
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}