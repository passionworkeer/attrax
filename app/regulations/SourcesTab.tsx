"use client";

import { useDeferredValue, useEffect, useState } from "react";
import { Search, Radio, ExternalLink, Filter, AlertTriangle, Tag, Activity } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { healthLabel } from "@/lib/regulations/health-label";
import type { SourceEntry, SourcesMeta, SourceHealth } from "@/lib/regulations/types";

const SOURCES_MARKETS = [
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
] as const;

const HEALTH_FILTERS: ReadonlyArray<{ value: SourceHealth | "all"; key: string }> = [
  { value: "all", key: "allHealth" },
  { value: "ok", key: "ok" },
  { value: "anti_bot", key: "anti_bot" },
  { value: "waf_challenge_temporary", key: "waf_challenge_temporary" },
  { value: "unreachable", key: "unreachable" },
  { value: "unknown", key: "unknown" },
];

const fallbackMeta: SourcesMeta = {
  total: 0,
  matching: 0,
  returned: 0,
  markets: 0,
  healthy: 0,
  protected: 0,
  byHealth: { ok: 0, anti_bot: 0, waf_challenge_temporary: 0, unreachable: 0, unknown: 0 },
  byMarket: {},
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
};

function healthBadgeClasses(health: SourceHealth): string {
  switch (health) {
    case "ok":
      return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    case "anti_bot":
      return "bg-amber-50 text-amber-700 ring-amber-200";
    case "waf_challenge_temporary":
      return "bg-orange-50 text-orange-700 ring-orange-200";
    case "unreachable":
      return "bg-red-50 text-red-700 ring-red-200";
    case "unknown":
    default:
      return "bg-slate-100 text-slate-600 ring-slate-200";
  }
}

export function SourcesTab() {
  const { t, locale } = useTranslation();
  const [entries, setEntries] = useState<SourceEntry[]>([]);
  const [meta, setMeta] = useState<SourcesMeta>(fallbackMeta);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [market, setMarket] = useState<string>("all");
  const [health, setHealth] = useState<SourceHealth | "all">("all");

  useEffect(() => {
    const controller = new AbortController();
    const fetchSources = async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const params = new URLSearchParams({ limit: "200" });
        if (deferredSearch) params.set("search", deferredSearch);
        if (market !== "all") params.set("market", market);
        if (health !== "all") params.set("health", health);

        const response = await fetch(`/api/regulations/sources?${params.toString()}`, {
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
        console.error("Failed to fetch regulation sources:", error);
        setLoadFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    const timer = setTimeout(fetchSources, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [deferredSearch, market, health]);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 glass-panel rounded-2xl p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={t("regulations.sources.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900/60 py-3 pl-12 pr-4 text-white placeholder:text-slate-500 focus:border-blaze-red focus:outline-none focus:ring-2 focus:ring-blaze-red/30"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {SOURCES_MARKETS.map((code) => (
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
                ? t("regulations.sources.allMarkets")
                : locale === "en"
                  ? marketLabelEn[code] ?? code
                  : marketLabel[code] ?? code}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {HEALTH_FILTERS.map((f) => {
            const isActive = health === f.value;
            const label =
              f.value === "all"
                ? t("regulations.sources.allHealth")
                : healthLabel(f.value, locale as "zh" | "en");
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setHealth(f.value)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-slate-700 text-white ring-1 ring-slate-500"
                    : "bg-slate-800/40 text-slate-400 ring-1 ring-white/5 hover:bg-slate-700/60"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Activity className="h-3 w-3" />
          {locale === "zh" ? "健康分布" : "Health breakdown"}:{" "}
          <span className="text-emerald-400">{meta.byHealth.ok}</span> ·{" "}
          <span className="text-amber-400">{meta.byHealth.anti_bot}</span> ·{" "}
          <span className="text-orange-400">{meta.byHealth.waf_challenge_temporary}</span> ·{" "}
          <span className="text-red-400">{meta.byHealth.unreachable}</span> ·{" "}
          <span className="text-slate-400">{meta.byHealth.unknown}</span>
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blaze-red border-t-transparent" />
        </div>
      ) : loadFailed ? (
        <div role="alert" className="flex flex-col items-center justify-center glass-panel rounded-2xl py-16 text-center">
          <AlertTriangle className="mb-4 h-12 w-12 text-red-400" />
          <p className="mb-2 text-lg font-medium text-white">
            {locale === "zh" ? "抓取源加载失败" : "Failed to load ingestion sources"}
          </p>
          <p className="max-w-md text-sm text-slate-400">
            {locale === "zh"
              ? "无法读取 official_sources.json，请确认仓库数据文件存在。"
              : "Could not read official_sources.json. Make sure the data file is present."}
          </p>
        </div>
      ) : entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className="glass-panel rounded-2xl border-l-4 border-l-violet-500/70 p-5 transition-all hover:border-blaze-red/40"
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
                    {locale === "en" ? marketLabelEn[entry.market] ?? entry.market : marketLabel[entry.market] ?? entry.market}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${healthBadgeClasses(entry.humanViewStatus)}`}
                  >
                    {healthLabel(entry.humanViewStatus, locale as "zh" | "en")}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                    <Tag className="h-3 w-3" />
                    {entry.sourceType}
                  </span>
                  {entry.authorityTier && entry.authorityTier !== "primary" ? (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                      {entry.authorityTier}
                    </span>
                  ) : null}
                  {entry.regulationId ? (
                    <code className="rounded-md bg-slate-800/80 px-2 py-1 font-mono text-xs text-slate-300">
                      → {entry.regulationId}
                    </code>
                  ) : null}
                </div>
                <h3 className="text-base font-semibold text-white">{entry.title}</h3>
                <p className="text-sm text-slate-400">
                  <span className="text-slate-500">{t("regulations.sources.channel")}: </span>
                  <span className="text-slate-300">{entry.channel}</span>
                </p>
                <p className="text-sm text-slate-400">
                  <span className="text-slate-500">{t("regulations.sources.fetch")}: </span>
                  <span className="text-slate-300">{entry.watchdogActualFetch}</span>
                </p>
                {entry.productCategories.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-slate-500">{t("regulations.sources.categories")}:</span>
                    {entry.productCategories.map((cat) => (
                      <span
                        key={cat}
                        className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                ) : null}
                {entry.notes ? (
                  <p className="text-sm leading-6 text-slate-400">
                    <span className="text-slate-500">{t("regulations.sources.notes")}: </span>
                    <span className="text-slate-300">{entry.notes}</span>
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={entry.humanViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/60 hover:text-white"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {t("regulations.sources.openHuman")}
                  </a>
                  <a
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/60 hover:text-white"
                  >
                    <Radio className="h-4 w-4" />
                    {t("regulations.sources.openWatchdog")}
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center glass-panel rounded-2xl py-20 text-center">
          <Filter className="mb-4 h-12 w-12 text-slate-500" />
          <p className="mb-2 text-lg font-medium text-white">{t("regulations.sources.noResults")}</p>
        </div>
      )}

      {!loading && entries.length > 0 ? (
        <div className="mt-6 glass-panel rounded-2xl p-5">
          <p className="text-sm text-slate-400">
            {t("regulations.sources.showing", {
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
