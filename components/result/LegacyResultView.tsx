"use client";

import { useTranslation } from "@/lib/i18n";
import { localizeScanResult } from "@/lib/report-localization";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import type { ScanResult } from "@/lib/types";

/**
 * Fallback view for legacy ScanResult payloads (pre-ComplianceReport era).
 * Renders the raw JSON dump and a downloadable list of uploaded documents.
 * Used when the session does not expose a ComplianceReportResult.
 */
export function LegacyResultView({ result }: { result: ScanResult }) {
  const { t, locale } = useTranslation();
  const viewResult = localizeScanResult(result, locale);
  return (
    <>
      <div className="overflow-hidden rounded-3xl glass-panel">
        <pre className="max-h-[70vh] overflow-auto p-6 text-xs leading-6 text-slate-200 sm:text-sm data-mono">
          {JSON.stringify(viewResult, null, 2)}
        </pre>
      </div>

      {viewResult.documents.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-white">{t("result.uploadedDocs")}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {t("result.documentCount", { count: viewResult.documents.length })}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {viewResult.documents.map((doc) => {
              const typeLabel = doc.type.toUpperCase();
              const isPdf = doc.type === "pdf";
              const isDocx = doc.type === "docx";
              return (
                <a
                  key={doc.documentId}
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/40 p-4 transition-all hover:border-blaze-red/40 hover:bg-slate-800/60"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-800/60">
                    {isPdf ? (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="size-5 text-blaze-red"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                        />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className={cn("size-5", isDocx ? "text-blaze-cyan" : "text-amber-400")}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                        />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight text-white">{doc.name}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {typeLabel} · {formatBytes(doc.size)}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
