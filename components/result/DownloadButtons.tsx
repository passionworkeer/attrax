"use client";

import type { ReportLocale } from "@/components/result/SourceNotice";

/**
 * PDF + Word download buttons for a single report section, in both locales.
 * Used for compliance / profit / decision / roadmap exports.
 *
 * `label` is optional: when omitted, buttons render just `PDF ZH` / `Word EN`
 * (back-compat for the profit-report view). When provided, it prefixes the
 * locale tag with a space, e.g. `利润 PDF ZH`.
 */
export function DownloadButtons({
  onPdf,
  onDocx,
  label,
}: {
  onPdf: (dlLocale: ReportLocale) => void;
  onDocx: (dlLocale: ReportLocale) => void;
  label?: string;
}) {
  const prefix = label ? `${label} ` : "";
  return (
    <div className="flex flex-wrap gap-2">
      {(["zh", "en"] as const).map((dlLocale) => (
        <div
          key={dlLocale}
          className="flex overflow-hidden rounded-lg border border-white/10 bg-slate-900/40 backdrop-blur-sm"
        >
          <button
            onClick={() => onPdf(dlLocale)}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-blaze-red transition-colors"
          >
            {prefix}PDF {dlLocale.toUpperCase()}
          </button>
          <button
            onClick={() => onDocx(dlLocale)}
            className="border-l border-white/10 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-blaze-cyan transition-colors"
          >
            Word {dlLocale.toUpperCase()}
          </button>
        </div>
      ))}
    </div>
  );
}
