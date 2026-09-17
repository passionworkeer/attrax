"use client";

import type { ReportLocale } from "@/components/result/SourceNotice";
import { useState } from "react";
import { useTranslation } from "@/lib/i18n";

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
  onPdf: (dlLocale: ReportLocale) => void | Promise<void>;
  onDocx: (dlLocale: ReportLocale) => void | Promise<void>;
  label?: string;
}) {
  const prefix = label ? `${label} ` : "";
  const { locale } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function download(format: "PDF" | "Word", dlLocale: ReportLocale) {
    if (busy) return;
    setBusy(`${format} ${dlLocale.toUpperCase()}`);
    setMessage("");
    setFailed(false);
    try {
      await (format === "PDF" ? onPdf(dlLocale) : onDocx(dlLocale));
      setMessage(locale === "zh" ? "文件已生成，请查看浏览器下载列表。" : "File generated. Check your browser downloads.");
    } catch {
      setFailed(true);
      setMessage(locale === "zh" ? "导出失败，请重试；仍失败可先下载文本版。" : "Export failed. Retry or download the text version.");
    } finally { setBusy(null); }
  }
  return (
    <div className="flex flex-wrap gap-2" aria-busy={busy !== null}>
      {(["zh", "en"] as const).map((dlLocale) => (
        <div
          key={dlLocale}
          className="flex overflow-hidden rounded-lg border border-white/10 bg-slate-900/40 backdrop-blur-sm"
        >
          <button
            onClick={() => void download("PDF", dlLocale)}
            disabled={busy !== null}
            className="min-h-10 px-3 py-2 text-xs font-medium text-slate-300 hover:text-blaze-red transition-colors disabled:opacity-50"
          >
            {prefix}PDF {dlLocale.toUpperCase()}
          </button>
          <button
            onClick={() => void download("Word", dlLocale)}
            disabled={busy !== null}
            className="min-h-10 border-l border-white/10 px-3 py-2 text-xs font-medium text-slate-300 hover:text-blaze-cyan transition-colors disabled:opacity-50"
          >
            Word {dlLocale.toUpperCase()}
          </button>
        </div>
      ))}
      {(busy || message) && <p role={failed ? "alert" : "status"} className="w-full text-xs leading-6">{busy ? `${locale === "zh" ? "正在生成" : "Generating"} ${busy}…` : message}</p>}
    </div>
  );
}
