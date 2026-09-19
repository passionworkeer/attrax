"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { Search, FileText, ExternalLink, ShoppingCart, Filter, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { ArchiveEntry, ArchiveMeta } from "@/lib/regulations/types";

const ARCHIVE_MARKETS = [
  "all",
  "EU",
  "US",
  "CN",
  "UK",
  "CA",
  "JP",
  "KR",
  "AU",
  "IN",
  "BR",
  "SA",
  "AE",
  "NZ",
  "UN",
] as const;

const fallbackMeta: ArchiveMeta = {
  total: 0,
  matching: 0,
  returned: 0,
  markets: 0,
  withArticles: 0,
  generatedAt: null,
};

const marketLabel: Record<string, string> = {
  EU: "欧盟",
  US: "美国",
  CN: "中国",
  UK: "英国",
  CA: "加拿大",
  JP: "日本",
  KR: "韩国",
  AU: "澳大利亚",
  IN: "印度",
  BR: "巴西",
  SA: "沙特",
  AE: "阿联酋",
  NZ: "新西兰",
  UN: "国际",
};

const marketLabelEn: Record<string, string> = {
  EU: "EU",
  US: "US",
  CN: "China",
  UK: "UK",
  CA: "Canada",
  JP: "Japan",
  KR: "South Korea",
  AU: "Australia",
  IN: "India",
  BR: "Brazil",
  SA: "Saudi Arabia",
  AE: "UAE",
  NZ: "New Zealand",
  UN: "International",
};

function formatDate(dateStr: string | null, locale: "zh" | "en") {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ArchiveTab() {
  const { t, locale } = useTranslation();
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [meta, setMeta] = useState<ArchiveMeta>(fallbackMeta);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [market, setMarket] = useState<string>("all");

  useEffect(() => {
    const controller = new AbortController();
    const fetchArchive = async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const params = new URLSearchParams({ limit: "200" });
        if (deferredSearch) params.set("search", deferredSearch);
        if (market !== "all") params.set("market", market);

        const response = await fetch(`/api/regulations/archive?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.success) {
          setEntries(data.data ?? []);
          setMeta(data.meta ?? fallbackMeta);
        } else {
          setLoadFailed(true);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to fetch regulation archive:", error);
        setLoadFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    const timer = setTimeout(fetchArchive, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [deferredSearch, market]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 glass-panel rounded-2xl p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={t("regulations.archive.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900/60 py-3 pl-12 pr-4 text-white placeholder:text-slate-500 focus:border-blaze-red focus:outline-none focus:ring-2 focus:ring-blaze-red/30"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:max-w-3xl lg:pb-0">
          {ARCHIVE_MARKETS.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setMarket(code)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                market === code
                  ? "bg-blaze-red text-white shadow-[0_0_15px_rgba(217,58,26,0.4)]"
                  : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60"
              }`}
            >
              {code === "all"
                ? t("regulations.archive.allMarkets")
                : locale === "en"
                  ? marketLabelEn[code] ?? code
                  : marketLabel[code] ?? code}
            </button>
          ))}
        </div>
      </div>

      {meta.generatedAt ? (
        <p className="mb-3 text-xs text-slate-500">
          {t("regulations.archive.indexGenerated")}: {formatDate(meta.generatedAt, locale)}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blaze-red border-t-transparent" />
        </div>
      ) : loadFailed ? (
        <div role="alert" className="flex flex-col items-center justify-center glass-panel rounded-2xl py-16 text-center">
          <AlertTriangle className="mb-4 h-12 w-12 text-red-400" />
          <p className="mb-2 text-lg font-medium text-white">
            {locale === "zh" ? "法规档案加载失败" : "Failed to load regulation archive"}
          </p>
          <p className="max-w-md text-sm text-slate-400">
            {locale === "zh"
              ? "无法读取 regulations_index.json，请确认仓库数据文件存在。"
              : "Could not read regulations_index.json. Make sure the data file is present."}
          </p>
        </div>
      ) : entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="glass-panel rounded-2xl border-l-4 border-l-sky-500/70 p-5 transition-all hover:border-blaze-red/40"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
                      {locale === "en" ? marketLabelEn[entry.region] ?? entry.region : marketLabel[entry.region] ?? entry.region}
                    </span>
                    <code className="rounded-md bg-slate-800/80 px-2 py-1 font-mono text-xs text-slate-300">
                      {entry.id}
                    </code>
                    {entry.articleCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                        <FileText className="h-3 w-3" />
                        {entry.articleCount} {t("regulations.archive.articles")}
                      </span>
                    ) : null}
                    {entry.license ? (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                        {entry.license}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mb-1 text-base font-semibold text-white">{entry.shortName}</h3>
                  <p className="text-sm leading-6 text-slate-400">
                    {t("regulations.archive.citation")}: <span className="text-slate-300">{entry.officialCitation}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {entry.sourceUrl ? (
                    <a
                      href={entry.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/60 hover:text-white"
                    >
                      <ExternalLink className="h-4 w-4" />
                      {t("regulations.archive.source")}
                    </a>
                  ) : null}
                  {entry.purchaseUrl ? (
                    <a
                      href={entry.purchaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/60 hover:text-white"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      {t("regulations.archive.purchase")}
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center glass-panel rounded-2xl py-20 text-center">
          <Filter className="mb-4 h-12 w-12 text-slate-500" />
          <p className="mb-2 text-lg font-medium text-white">{t("regulations.archive.noResults")}</p>
        </div>
      )}

      {!loading && entries.length > 0 ? (
        <div className="mt-6 glass-panel rounded-2xl p-5">
          <p className="text-sm text-slate-400">
            {t("regulations.archive.showing", {
              from: 1,
              to: entries.length,
              total: meta.matching || entries.length,
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
