"use client";

import { useState, useEffect } from "react";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  Filter,
  Globe2,
  ListChecks,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

type RiskLevel = "critical" | "high" | "medium" | "low";
type ChangeType = "new" | "revision" | "enforcement" | "consultation";

export interface RegulationUpdate {
  id: string;
  market: string;
  title: string;
  titleEn: string;
  publishDate: string;
  effectiveDate: string;
  affectedCategories: string[];
  affectedCategoriesEn: string[];
  summary: string;
  summaryEn: string;
  sourceAgency: string;
  sourceAgencyEn: string;
  sourceUrl: string;
  riskLevel: RiskLevel;
  changeType: ChangeType;
  status: string;
  statusEn: string;
  businessImpact: string;
  businessImpactEn: string;
  requirements: string[];
  requirementsEn: string[];
  recommendedActions: string[];
  recommendedActionsEn: string[];
  lastVerifiedAt: string;
  daysUntilEffective?: number;
}

interface RegulationsMeta {
  total: number;
  matching: number;
  returned: number;
  markets: number;
  highRisk: number;
  effectiveSoon: number;
  lastVerifiedAt?: string;
  dataset?: string;
}

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
};

const marketFilterKeys: Record<string, string> = {
  all: "regulations.allMarkets",
  ...marketLabelKeys,
};

const marketCodes = ["all", "EU", "US", "UK", "CN", "AU", "SA", "AE", "JP", "BR", "CA", "KR", "IN"] as const;

const riskClasses: Record<RiskLevel, string> = {
  critical: "bg-red-500/15 text-red-300 ring-red-500/40",
  high: "bg-orange-500/15 text-orange-300 ring-orange-500/40",
  medium: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  low: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
};

const riskBorderClasses: Record<RiskLevel, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-amber-500",
  low: "border-l-emerald-500",
};

const changeTypeClasses: Record<ChangeType, string> = {
  new: "bg-blaze-cyan/15 text-blaze-cyan ring-blaze-cyan/40",
  revision: "bg-violet-500/15 text-violet-300 ring-violet-500/40",
  enforcement: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  consultation: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
};

const fallbackMeta: RegulationsMeta = {
  total: 0,
  matching: 0,
  returned: 0,
  markets: 0,
  highRisk: 0,
  effectiveSoon: 0,
};

export default function RegulationsPage() {
  const { t, locale } = useTranslation();
  const [regulations, setRegulations] = useState<RegulationUpdate[]>([]);
  const [meta, setMeta] = useState<RegulationsMeta>(fallbackMeta);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedMarket, setSelectedMarket] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();

    const fetchRegulations = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search) params.set("search", search);
        if (selectedMarket !== "all") params.set("market", selectedMarket);

        const response = await fetch(`/api/regulations/updates?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await response.json();

        if (data.success) {
          setRegulations(data.data);
          setMeta(data.meta ?? fallbackMeta);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to fetch regulations:", error);
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
  }, [search, selectedMarket]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getDaysUntilEffective = (effectiveDate: string) => {
    const effective = new Date(effectiveDate);
    const now = new Date();
    const diffTime = effective.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
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
    <div className="min-h-[calc(100vh-5rem)] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <section className="glass-panel rounded-3xl p-8 shadow-[0_30px_120px_rgba(0,0,0,0.5)]">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="label-caps mb-3 text-xs text-blaze-red/80">
              <ShieldCheck className="mr-2 inline h-3.5 w-3.5" />
              {t("regulations.demoBadge")}
            </p>
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">
              {t("regulations.title")}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
              {t("regulations.subtitle")}
            </p>
          </div>

          {meta.lastVerifiedAt && (
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-sm text-slate-300 backdrop-blur">
              <Clock3 className="h-4 w-4 text-slate-400" />
              <span>{t("regulations.lastVerified")}: {formatDate(meta.lastVerifiedAt)}</span>
            </div>
          )}
        </div>

        <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-sm leading-6 text-amber-300">
          {t("regulations.mockNotice")}
        </div>
        </section>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{t("regulations.total")}</span>
              <ListChecks className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-white">{meta.total || regulations.length}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{t("regulations.trackedMarkets")}</span>
              <Globe2 className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-white">{meta.markets || "-"}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{t("regulations.highPriority")}</span>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </div>
            <p className="text-2xl font-bold text-orange-400">{meta.highRisk || 0}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{t("regulations.effectiveSoon")}</span>
              <Calendar className="h-4 w-4 text-blaze-red" />
            </div>
            <p className="text-2xl font-bold text-blaze-red">{meta.effectiveSoon || 0}</p>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-4 glass-panel rounded-2xl p-4 lg:flex-row lg:items-center">
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
            {marketCodes.map((code) => (
              <button
                key={code}
                onClick={() => setSelectedMarket(code)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  selectedMarket === code
                    ? "bg-blaze-red text-white shadow-[0_0_15px_rgba(217,58,26,0.4)]"
                    : "bg-slate-800/60 text-slate-300 hover:bg-slate-700/60"
                }`}
              >
                {t(marketFilterKeys[code])}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blaze-red border-t-transparent" />
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
                        <span className="inline-flex items-center rounded-full bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-200">
                          {marketLabel}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${riskClasses[regulation.riskLevel]}`}>
                          {t(`regulations.riskLevels.${regulation.riskLevel}`)}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${changeTypeClasses[regulation.changeType]}`}>
                          {t(`regulations.changeTypes.${regulation.changeType}`)}
                        </span>
                        {isUrgent && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-3 py-1 text-xs font-medium text-orange-300 ring-1 ring-orange-500/40">
                            <AlertTriangle className="h-3 w-3" />
                            {t("regulations.comingSoon")}
                          </span>
                        )}
                      </div>

                      <h3 className="mb-2 text-lg font-semibold leading-7 text-white">
                        {title}
                      </h3>
                      <p className="mb-4 line-clamp-2 text-sm leading-6 text-slate-400">
                        {summary}
                      </p>

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
                      onClick={() => toggleExpand(regulation.id)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/60 hover:border-blaze-red/40 hover:text-white lg:shrink-0"
                    >
                      {isExpanded ? t("regulations.collapse") : t("regulations.viewDetails")}
                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-5 border-t border-white/10 pt-5">
                      <div className="mb-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-white">
                            {t("regulations.businessImpact")}
                          </h4>
                          <p className="text-sm leading-6 text-slate-300">{businessImpact}</p>
                        </div>
                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-white">
                            {t("regulations.affectedCategories")}
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {categories.map((category) => (
                              <span
                                key={category}
                                className="inline-flex items-center rounded-full bg-slate-800/80 px-3 py-1 text-xs font-medium text-slate-200"
                              >
                                {category}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-5 lg:grid-cols-2">
                        <div>
                          <h4 className="mb-3 text-sm font-semibold text-white">
                            {t("regulations.keyRequirements")}
                          </h4>
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
                          <h4 className="mb-3 text-sm font-semibold text-white">
                            {t("regulations.recommendedActions")}
                          </h4>
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
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center glass-panel rounded-2xl py-20 text-center">
            <Filter className="mb-4 h-12 w-12 text-slate-500" />
            <p className="mb-2 text-lg font-medium text-white">
              {t("regulations.noResults")}
            </p>
          </div>
        )}

        {!loading && regulations.length > 0 && (
          <div className="mt-6 glass-panel rounded-2xl p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-400">
                {t("regulations.showing", {
                  from: 1,
                  to: regulations.length,
                  total: meta.matching || regulations.length,
                })}
              </p>
              <p className="text-sm text-slate-400">
                {t("regulations.dataset")}: <span className="font-medium text-white">{meta.dataset ?? "static-demo"}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
