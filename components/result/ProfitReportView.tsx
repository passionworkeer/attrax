"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { downloadProfitReportAsPdf, downloadProfitReportAsDocx } from "@/lib/report-export";
import type { ProfitReportResult } from "@/lib/types";

type ReportLocale = "zh" | "en";

function DownloadButtons({
  onPdf,
  onDocx,
}: {
  onPdf: (locale: ReportLocale) => void;
  onDocx: (locale: ReportLocale) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(["zh", "en"] as const).map((locale) => (
        <div key={locale} className="flex overflow-hidden rounded-lg border border-border bg-muted">
          <button onClick={() => onPdf(locale)} className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-red-500">
            PDF {locale.toUpperCase()}
          </button>
          <button onClick={() => onDocx(locale)} className="border-l border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-blue-500">
            Word {locale.toUpperCase()}
          </button>
        </div>
      ))}
    </div>
  );
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  EUR: "€",
  GBP: "£",
  USD: "$",
  JPY: "¥",
};

function getCurrencySymbol(currency?: string): string {
  return currency ? (CURRENCY_SYMBOLS[currency.toUpperCase()] ?? "$") : "$";
}

interface MetricRow {
  label: string;
  barebone: number;
  compliant: number;
  unit?: string;
}

function fmt(n: number, unit?: string, currency?: string): string {
  const sym = getCurrencySymbol(currency);
  if (unit === "%") return `${n.toFixed(1)}%`;
  return `${sym}${n.toFixed(0)}${unit ? ` ${unit}` : ""}`;
}

function profitDelta(a: number, b: number, currency?: string): string {
  const diff = b - a;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${getCurrencySymbol(currency)}${diff.toFixed(0)}`;
}

function MetricTable({ rows, currency }: { rows: MetricRow[]; currency?: string }) {
  const { t } = useTranslation();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="py-2 pr-4 text-left font-medium text-muted-foreground">{t("report.columns.costItem")}</th>
          <th className="w-32 py-2 text-right font-medium text-blaze-red/80">{t("report.labels.noCompliance")}</th>
          <th className="w-32 py-2 text-right font-medium text-emerald-500">{t("report.labels.withCompliance")}</th>
          <th className="w-28 py-2 text-right font-medium text-muted-foreground">{t("report.columns.difference")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.label} className="hover:bg-muted/40 transition-colors">
            <td className="py-2.5 pr-4 font-medium">{r.label}</td>
            <td className="py-2.5 text-right tabular-nums text-blaze-red/80">
              {fmt(r.barebone, r.unit, currency)}
            </td>
            <td className="py-2.5 text-right tabular-nums text-emerald-500">
              {fmt(r.compliant, r.unit, currency)}
            </td>
            <td className="py-2.5 text-right tabular-nums text-muted-foreground">
              {profitDelta(r.barebone, r.compliant, currency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RiskBar({
  label,
  barebone,
  compliant,
  max,
  currency,
}: {
  label: string;
  barebone: number;
  compliant: number;
  max: number;
  currency?: string;
}) {
  const { t } = useTranslation();
  const bw = max > 0 ? Math.round((barebone / max) * 100) : 0;
  const cw = max > 0 ? Math.round((compliant / max) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          <span className="text-blaze-red/70">{t("report.labels.noCompliance")} {fmt(barebone, undefined, currency)}</span>
          <span className="mx-1.5">/</span>
          <span className="text-emerald-500">{t("report.labels.withCompliance")} {fmt(compliant, undefined, currency)}</span>
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-blaze-red/70 transition-all"
          style={{ width: `${bw}%` }}
          title={`${t("report.labels.noCompliance")}: ${fmt(barebone, undefined, currency)}`}
        />
        <div
          className="h-full bg-emerald-500/70 transition-all"
          style={{ width: `${cw}%` }}
          title={`${t("report.labels.withCompliance")}: ${fmt(compliant, undefined, currency)}`}
        />
      </div>
    </div>
  );
}

function ConclusionCard({ text }: { text: string }) {
  // Extract the headline (first non-empty line) and body
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const headline = lines[0] ?? "";
  const body = lines.slice(1).join(" ");

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4">
      <div className="flex items-start gap-3">
        <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-5 shrink-0 text-amber-400">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92ZM11 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm-1-8a1 1 0 0 0-1 1v3a1 1 0 0 0 0 2h.5a1 1 0 0 0 .5-.866V8a1 1 0 0 0-1-1H10Z" clipRule="evenodd"/>
        </svg>
        <div>
          <p className="font-semibold text-amber-300">{headline}</p>
          {body && <p className="mt-1 text-sm leading-relaxed text-amber-200/80">{body}</p>}
        </div>
      </div>
    </div>
  );
}

export function ProfitReportView({ result }: { result: ProfitReportResult }) {
  const { t, locale } = useTranslation();
  const currency = result.currency;
  const sym = getCurrencySymbol(currency);
  const rows: MetricRow[] = [
    { label: t("report.columns.bomCost"), barebone: result.barebone.bom, compliant: result.compliant.bom },
    { label: t("report.columns.packaging"), barebone: result.barebone.packaging, compliant: result.compliant.packaging },
    { label: t("report.columns.certAmortization"), barebone: result.barebone.cert, compliant: result.compliant.cert },
    { label: t("report.columns.eprFee"), barebone: result.barebone.epr, compliant: result.compliant.epr },
    { label: t("report.columns.logistics"), barebone: result.barebone.logistics, compliant: result.compliant.logistics },
    { label: t("report.columns.avgPriceAsp"), barebone: result.barebone.asp, compliant: result.compliant.asp },
    { label: t("report.columns.grossProfitGp"), barebone: result.barebone.gp, compliant: result.compliant.gp },
  ];

  const riskMax = Math.max(result.bareboneRiskExposure, result.compliantRiskExposure);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-blaze-red/70">Cost &amp; Profit</p>
          <h2 className="mt-1 text-2xl font-semibold">{t("report.costProfitReport")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.productType} · {result.market} {t("result.market")}
          </p>
        </div>
        <DownloadButtons
          onPdf={(downloadLocale) => downloadProfitReportAsPdf(result, downloadLocale)}
          onDocx={(downloadLocale) => downloadProfitReportAsDocx(result, downloadLocale)}
        />
      </div>

      {/* Two-column comparison cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Barebone card */}
        <div className="rounded-2xl border border-blaze-red/25 bg-blaze-red/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-blaze-red/60">{t("report.labels.noCompliance")}</p>
              <p className="mt-0.5 text-sm font-medium text-blaze-red/80">Barebone</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums text-blaze-red">
                {fmt(result.barebone.gp, undefined, currency)}
              </p>
              <p className="text-xs text-blaze-red/60">{t("report.cards.grossProfit")}</p>
            </div>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{t("report.cards.salePrice")}：{fmt(result.barebone.asp, undefined, currency)}</p>
            <p>{t("report.cards.totalCost")}：{fmt(result.barebone.bom + result.barebone.packaging + result.barebone.cert + result.barebone.epr + result.barebone.logistics, undefined, currency)}</p>
            <p>{t("report.cards.riskExposure")}：{fmt(result.bareboneRiskExposure, undefined, currency)}</p>
          </div>
        </div>

        {/* Compliant card */}
        <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-emerald-500/60">{t("report.labels.withCompliance")}</p>
              <p className="mt-0.5 text-sm font-medium text-emerald-500/80">Compliant</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums text-emerald-500">
                {fmt(result.compliant.gp, undefined, currency)}
              </p>
              <p className="text-xs text-emerald-500/60">{t("report.cards.grossProfit")}</p>
            </div>
          </div>
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{t("report.cards.salePrice")}：{fmt(result.compliant.asp, undefined, currency)}</p>
            <p>{t("report.cards.totalCost")}：{fmt(result.compliant.bom + result.compliant.packaging + result.compliant.cert + result.compliant.epr + result.compliant.logistics, undefined, currency)}</p>
            <p>{t("report.cards.riskExposure")}：{fmt(result.compliantRiskExposure, undefined, currency)}</p>
          </div>
        </div>
      </div>

      {/* Cost comparison table */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold">{t("report.cards.costComparison")}</h3>
        </div>
        <div className="p-5">
          <MetricTable rows={rows} currency={currency} />
        </div>
      </div>

      {/* Risk-adjusted profit bars */}
      <div className="rounded-2xl border border-border bg-card px-5 py-4">
        <h3 className="mb-4 text-sm font-semibold">{t("report.riskAdjustedRevenue")}</h3>
        <div className="mb-3 space-y-3">
          <RiskBar
            label={t("report.cards.grossProfit")}
            barebone={result.barebone.gp}
            compliant={result.compliant.gp}
            max={Math.max(result.barebone.gp, result.compliant.gp, 1)}
            currency={currency}
          />
          <RiskBar
            label={t("report.cards.riskExposure")}
            barebone={result.bareboneRiskExposure}
            compliant={result.compliantRiskExposure}
            max={riskMax}
            currency={currency}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-blaze-red/70" />
            {t("report.cards.barebone")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-emerald-500/70" />
            {t("report.cards.compliant")}
          </span>
        </div>
      </div>

      {/* Key conclusion */}
      {result.keyConclusion && (
        <ConclusionCard text={result.keyConclusion} />
      )}

      {/* Markdown report body */}
      {result.report && (
        <div className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h3 className="text-sm font-semibold">{t("report.cards.analysisReport")}</h3>
          </div>
          <div className="p-5 text-sm leading-relaxed [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_p]:mt-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {result.report}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Footer meta */}
      <p className="text-xs text-muted-foreground">
        {t("report.generatedAt")} {new Date(result.generatedAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN")}
      </p>
    </div>
  );
}
