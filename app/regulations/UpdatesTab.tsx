"use client";

import { useDeferredValue, useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Filter,
  ListChecks,
  Search,
  Clock3,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { RegulationUpdate } from "@/app/api/regulations/updates/types";

type RiskLevel = "critical" | "high" | "medium" | "low";
type ChangeType = "new" | "revision" | "enforcement" | "consultation";

const UPDATES_MARKETS = [
  "all",
  "EU",
  "US",
  "UK",
  "CN",
  "AU",
  "SA",
  "AE",
  "JP",
  "BR",
  "CA",
  "KR",
  "IN",
  // NZ 没有静态卡片，但 watchdog 注册表里有 2 个新西兰源，真实变更会以
  // market: "NZ" 进入列表——缺按钮时卡片只能混在「全部」里，市场标签还会因为
  // marketLabelKeys 没有映射而显示裸代码 "NZ"。
  "NZ",
  "SG",
  "MY",
  "TH",
  "VN",
  "ID",
  "GCC",
  "UN",
] as const;

const riskClasses: Record<RiskLevel, string> = {
  critical: "bg-red-50 text-red-700 ring-red-200",
  high: "bg-orange-50 text-orange-700 ring-orange-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  low: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

const riskBorderClasses: Record<RiskLevel, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-amber-500",
  low: "border-l-emerald-500",
};

const changeTypeClasses: Record<ChangeType, string> = {
  new: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  revision: "bg-violet-50 text-violet-700 ring-violet-200",
  enforcement: "bg-rose-50 text-rose-700 ring-rose-200",
  consultation: "bg-sky-50 text-sky-700 ring-sky-200",
};

const marketLabelKeys: Record<string, string> = {
  EU: "markets.EU",
  US: "markets.US",
  UK: "markets.UK",
  CN: "markets.CN",
  AU: "markets.AU",
  SA: "markets.SA",
  AE: "markets.UAE",
  JP: "markets.JP",
  BR: "markets.BR",
  CA: "markets.CA",
  KR: "markets.KR",
  IN: "markets.IN",
  NZ: "markets.NZ",
  SG: "markets.SG",
  MY: "markets.MY",
  TH: "markets.TH",
  VN: "markets.VN",
  ID: "markets.ID",
  GCC: "markets.GCC",
  UN: "markets.UN",
};

function getDaysUntilEffective(effectiveDate: string) {
  const effective = new Date(effectiveDate);
  const now = new Date();
  const diff = effective.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function UpdatesTab() {
  const { t, locale } = useTranslation();
  const [regulations, setRegulations] = useState<RegulationUpdate[]>([]);
  const [meta, setMeta] = useState<{
    matching: number;
    lastVerifiedAt: string | null;
    dataset: string | null;
  }>({ matching: 0, lastVerifiedAt: null, dataset: null });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedMarket, setSelectedMarket] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    const fetchRegulations = async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        // limit=100: 人工整理卡片 + watchdog 实时记录（2026-09-19 目录导入后
        // 静态侧就有 42 条），50 会把区域卡片截断在列表尾部。
        const params = new URLSearchParams({ limit: "100" });
        if (deferredSearch) params.set("search", deferredSearch);
        if (selectedMarket !== "all") params.set("market", selectedMarket);

        const response = await fetch(`/api/regulations/updates?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.success) {
          setRegulations(data.data ?? []);
          setMeta({
            matching: data.meta?.matching ?? 0,
            lastVerifiedAt: data.meta?.lastVerifiedAt ?? null,
            dataset: data.meta?.dataset ?? null,
          });
        } else {
          setLoadFailed(true);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to fetch regulations:", error);
        setLoadFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    const timer = setTimeout(fetchRegulations, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [deferredSearch, selectedMarket]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div>
      {meta.lastVerifiedAt ? (
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
          <Clock3 className="h-3 w-3" />
          {t("regulations.lastVerified")}: {formatDate(meta.lastVerifiedAt)}
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 glass-panel rounded-2xl p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={t("regulations.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900/60 py-3 pl-12 pr-4 text-white placeholder:text-slate-500 focus:border-blaze-red focus:outline-none focus:ring-2 focus:ring-blaze-red/30"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:max-w-3xl lg:pb-0">
          {UPDATES_MARKETS.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setSelectedMarket(code)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                selectedMarket === code
                  ? "bg-blaze-red text-white shadow-[0_0_15px_rgba(217,58,26,0.4)]"
                  : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60"
              }`}
            >
              {code === "all" ? t("regulations.allMarkets") : t(marketLabelKeys[code] || code)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blaze-red border-t-transparent" />
        </div>
      ) : loadFailed ? (
        <div role="alert" className="flex flex-col items-center justify-center glass-panel rounded-2xl py-16 text-center">
          <AlertTriangle className="mb-4 h-12 w-12 text-red-400" />
          <p className="mb-2 text-lg font-medium text-white">
            {locale === "zh" ? "法规加载失败" : "Failed to load regulations"}
          </p>
          <p className="max-w-md text-sm text-slate-400">
            {locale === "zh"
              ? "无法从服务器获取最新法规列表，请稍后重试或刷新页面。"
              : "Could not reach the regulation updates service. Try again or refresh the page."}
          </p>
        </div>
      ) : regulations.length > 0 ? (
        <div className="space-y-4">
          {regulations.map((regulation) => {
            const isExpanded = expandedIds.has(regulation.id);
            const daysUntil = regulation.daysUntilEffective ?? getDaysUntilEffective(regulation.effectiveDate);
            const isUrgent = daysUntil >= 0 && daysUntil <= 45;
            const marketLabel = t(marketLabelKeys[regulation.market] || regulation.market);
            const title = locale === "en" ? regulation.titleEn : regulation.title;
            const summary = locale === "en" ? regulation.summaryEn : regulation.summary;
            const sourceAgency = locale === "en" ? regulation.sourceAgencyEn : regulation.sourceAgency;
            const status = locale === "en" ? regulation.statusEn : regulation.status;
            const businessImpact = locale === "en" ? regulation.businessImpactEn : regulation.businessImpact;
            const categories = locale === "en" ? regulation.affectedCategoriesEn : regulation.affectedCategories;
            const requirements = locale === "en" ? regulation.requirementsEn : regulation.requirements;
            const actions = locale === "en" ? regulation.recommendedActionsEn : regulation.recommendedActions;

            return (
              <article
                key={regulation.id}
                className={`glass-panel rounded-2xl border-l-4 p-5 transition-all hover:border-blaze-red/40 hover:shadow-[0_0_25px_rgba(217,58,26,0.15)] ${riskBorderClasses[regulation.riskLevel]}`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
                        {marketLabel}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${riskClasses[regulation.riskLevel]}`}>
                        {t(`regulations.riskLevels.${regulation.riskLevel}`)}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${changeTypeClasses[regulation.changeType]}`}>
                        {t(`regulations.changeTypes.${regulation.changeType}`)}
                      </span>
                      {isUrgent ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700 ring-1 ring-orange-200">
                          <AlertTriangle className="h-3 w-3" />
                          {t("regulations.comingSoon")}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mb-2 text-lg font-semibold leading-7 text-white">{title}</h3>
                    <p className="mb-4 line-clamp-2 text-sm leading-6 text-slate-400">{summary}</p>
                    <div className="grid gap-2 text-sm text-slate-400 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-500" />
                        <span>{t("regulations.published")}: {formatDate(regulation.publishDate)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-500" />
                        <span>{t("regulations.effective")}: {formatDate(regulation.effectiveDate)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-slate-500" />
                        <span>{sourceAgency}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-slate-500" />
                        <span>{status}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleExpand(regulation.id)}
                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/60 hover:border-blaze-red/40 hover:text-white lg:shrink-0"
                  >
                    {isExpanded ? t("regulations.collapse") : t("regulations.viewDetails")}
                    <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                </div>

                {isExpanded ? (
                  <div className="mt-5 border-t border-white/10 pt-5">
                    <div className="mb-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                      <div>
                        <h4 className="mb-2 text-sm font-semibold text-white">{t("regulations.businessImpact")}</h4>
                        <p className="text-sm leading-6 text-slate-300">{businessImpact}</p>
                      </div>
                      <div>
                        <h4 className="mb-2 text-sm font-semibold text-white">{t("regulations.affectedCategories")}</h4>
                        <div className="flex flex-wrap gap-2">
                          {categories.map((category) => (
                            <span
                              key={category}
                              className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200"
                            >
                              {category}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-3 text-sm font-semibold text-white">{t("regulations.keyRequirements")}</h4>
                        <ul className="space-y-2">
                          {requirements.map((requirement) => (
                            <li key={requirement} className="flex gap-2 text-sm leading-6 text-slate-300">
                              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />
                              <span>{requirement}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="mb-3 text-sm font-semibold text-white">{t("regulations.recommendedActions")}</h4>
                        <ul className="space-y-2">
                          {actions.map((action) => (
                            <li key={action} className="flex gap-2 text-sm leading-6 text-slate-300">
                              <ListChecks className="mt-1 h-4 w-4 shrink-0 text-blaze-red" />
                              <span>{action}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="mt-5 flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-slate-400">
                        {daysUntil > 0
                          ? t("regulations.daysLeft", { days: daysUntil })
                          : t("regulations.inForce")}
                        <span className="mx-2 text-slate-600">/</span>
                        {t("regulations.lastChecked")}: {formatDate(regulation.lastVerifiedAt)}
                      </div>
                      <a
                        href={regulation.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-blaze-cyan hover:text-blaze-cyan/80"
                      >
                        {t("regulations.viewSource")}
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center glass-panel rounded-2xl py-20 text-center">
          <Filter className="mb-4 h-12 w-12 text-slate-500" />
          <p className="mb-2 text-lg font-medium text-white">{t("regulations.noResults")}</p>
        </div>
      )}

      {!loading && regulations.length > 0 ? (
        <div className="mt-6 glass-panel rounded-2xl p-5">
          <p className="text-sm text-slate-400">
            {t("regulations.showing", { from: 1, to: regulations.length, total: meta.matching || regulations.length })}
          </p>
          {meta.dataset ? (
            <p className="mt-1 text-sm text-slate-400">
              {t("regulations.dataset")}: <span className="font-medium text-white">{meta.dataset}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
