"use client";

import { useTranslation } from "@/lib/i18n";

/**
 * P0-1: Unmissable red banner shown when a scan result is degraded or demo.
 *
 * Triggered by ANY of:
 * - `source` is "fallback" or "demo" (mock data path)
 * - `isDegraded` flag set by the poller (session.status === "degraded")
 * - `degradedReason` present (RAG error code)
 *
 * The banner is intentionally red (not amber) and persistent (always at the
 * top of the report) so the user cannot mistake fallback data for a real
 * compliance verdict. The amber `SourceNotice` below is a secondary cue;
 * this banner is the primary one.
 *
 * `showProfitNotice` is set by the caller when the profit report is also
 * degraded (it shares the same fallback path) — we cannot detect it inside
 * this component because ProfitReportResult has no `source` field.
 */
export interface DegradedBannerProps {
  source?: "real" | "fallback" | "demo";
  isDegraded?: boolean;
  degradedReason?: string;
  showProfitNotice?: boolean;
}

export function DegradedBanner({
  source,
  isDegraded,
  degradedReason,
  showProfitNotice,
}: DegradedBannerProps) {
  const { t } = useTranslation();

  if (source !== "fallback" && source !== "demo" && !isDegraded && !degradedReason) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mt-6 rounded-2xl border border-red-500/60 bg-red-500/15 px-5 py-4 shadow-[0_0_28px_rgba(239,68,68,0.25)]"
    >
      <div className="flex items-start gap-3">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-red-400"
        >
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-red-100">
            {t("result.degradedBanner")}
          </p>
          {showProfitNotice ? (
            <p className="mt-1 text-xs leading-5 text-red-200/85">
              {t("result.degradedProfitNotice")}
            </p>
          ) : null}
          {degradedReason ? (
            <p className="mt-1 font-mono text-[11px] text-red-300/80">
              [{degradedReason}]
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
