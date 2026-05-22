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
  critical: "bg-red-50 text-red-700 ring-red-100",
  high: "bg-orange-50 text-orange-700 ring-orange-100",
  medium: "bg-amber-50 text-amber-700 ring-amber-100",
  low: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

const riskBorderClasses: Record<RiskLevel, string> = {
  critical: "border-l-red-500",
  high: "border-l-orange-400",
  medium: "border-l-amber-400",
  low: "border-l-emerald-400",
};

const changeTypeClasses: Record<ChangeType, string> = {
  new: "bg-blue-50 text-blue-700 ring-blue-100",
  revision: "bg-violet-50 text-violet-700 ring-violet-100",
  enforcement: "bg-rose-50 text-rose-700 ring-rose-100",
  consultation: "bg-cyan-50 text-cyan-700 ring-cyan-100",
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
    const fetchRegulations = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search) params.set("search", search);
        if (selectedMarket !== "all") params.set("market", selectedMarket);

        const response = await fetch(`/api/regulations/updates?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setRegulations(data.data);
          setMeta(data.meta ?? fallbackMeta);
        }
      } catch (error) {
        console.error("Failed to fetch regulations:", error);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(fetchRegulations, 300);
    return () => clearTimeout(timer);
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
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
              <ShieldCheck className="h-3.5 w-3.5 text-blaze-red" />
              {t("regulations.demoBadge")}
            </div>
            <h1 className="mb-2 text-3xl font-bold text-slate-950">
              {t("regulations.title")}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
              {t("regulations.subtitle")}
            </p>
          </div>

          {meta.lastVerifiedAt && (
            <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
              <Clock3 className="h-4 w-4 text-slate-400" />
              <span>{t("regulations.lastVerified")}: {formatDate(meta.lastVerifiedAt)}</span>
            </div>
          )}
        </div>

        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          {t("regulations.mockNotice")}
        </div>

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">{t("regulations.total")}</span>
              <ListChecks className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-950">{meta.total || regulations.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">{t("regulations.trackedMarkets")}</span>
              <Globe2 className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-950">{meta.markets || "-"}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">{t("regulations.highPriority")}</span>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </div>
            <p className="text-2xl font-bold text-orange-600">{meta.highRisk || 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-500">{t("regulations.effectiveSoon")}</span>
              <Calendar className="h-4 w-4 text-blaze-red" />
            </div>
            <p className="text-2xl font-bold text-blaze-red">{meta.effectiveSoon || 0}</p>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t("regulations.search")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-12 pr-4 text-slate-950 placeholder-slate-400 focus:border-blaze-red focus:outline-none focus:ring-2 focus:ring-blaze-red/20"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:max-w-3xl lg:pb-0">
            {marketCodes.map((code) => (
              <button
                key={code}
                onClick={() => setSelectedMarket(code)}
                className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  selectedMarket === code
                    ? "bg-blaze-red text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
                  className={`rounded-lg border border-l-4 border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${riskBorderClasses[regulation.riskLevel]}`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {marketLabel}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${riskClasses[regulation.riskLevel]}`}>
                          {t(`regulations.riskLevels.${regulation.riskLevel}`)}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ${changeTypeClasses[regulation.changeType]}`}>
                          {t(`regulations.changeTypes.${regulation.changeType}`)}
                        </span>
                        {isUrgent && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700 ring-1 ring-orange-100">
                            <AlertTriangle className="h-3 w-3" />
                            {t("regulations.comingSoon")}
                          </span>
                        )}
                      </div>

                      <h3 className="mb-2 text-lg font-semibold leading-7 text-slate-950">
                        {title}
                      </h3>
                      <p className="mb-4 line-clamp-2 text-sm leading-6 text-slate-600">
                        {summary}
                      </p>

                      <div className="grid gap-2 text-sm text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-slate-400" />
                          <span>{t("regulations.published")}: {formatDate(regulation.publishDate)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-slate-400" />
                          <span>{t("regulations.effective")}: {formatDate(regulation.effectiveDate)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-slate-400" />
                          <span>{sourceAgency}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-slate-400" />
                          <span>{status}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => toggleExpand(regulation.id)}
                      className="inline-flex items-center justify-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-950 lg:shrink-0"
                    >
                      {isExpanded ? t("regulations.collapse") : t("regulations.viewDetails")}
                      <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-5 border-t border-slate-100 pt-5">
                      <div className="mb-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-slate-900">
                            {t("regulations.businessImpact")}
                          </h4>
                          <p className="text-sm leading-6 text-slate-600">{businessImpact}</p>
                        </div>
                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-slate-900">
                            {t("regulations.affectedCategories")}
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {categories.map((category) => (
                              <span
                                key={category}
                                className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                              >
                                {category}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-5 lg:grid-cols-2">
                        <div>
                          <h4 className="mb-3 text-sm font-semibold text-slate-900">
                            {t("regulations.keyRequirements")}
                          </h4>
                          <ul className="space-y-2">
                            {requirements.map((requirement) => (
                              <li key={requirement} className="flex gap-2 text-sm leading-6 text-slate-600">
                                <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
                                <span>{requirement}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4 className="mb-3 text-sm font-semibold text-slate-900">
                            {t("regulations.recommendedActions")}
                          </h4>
                          <ul className="space-y-2">
                            {actions.map((action) => (
                              <li key={action} className="flex gap-2 text-sm leading-6 text-slate-600">
                                <ListChecks className="mt-1 h-4 w-4 shrink-0 text-blaze-red" />
                                <span>{action}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm text-slate-500">
                          {daysUntil > 0
                            ? t("regulations.daysLeft", { days: daysUntil })
                            : t("regulations.inForce")}
                          <span className="mx-2 text-slate-300">/</span>
                          {t("regulations.lastChecked")}: {formatDate(regulation.lastVerifiedAt)}
                        </div>
                        <a
                          href={regulation.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
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
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-20 text-center">
            <Filter className="mb-4 h-12 w-12 text-slate-300" />
            <p className="mb-2 text-lg font-medium text-slate-950">
              {t("regulations.noResults")}
            </p>
          </div>
        )}

        {!loading && regulations.length > 0 && (
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                {t("regulations.showing", {
                  from: 1,
                  to: regulations.length,
                  total: meta.matching || regulations.length,
                })}
              </p>
              <p className="text-sm text-slate-500">
                {t("regulations.dataset")}: <span className="font-medium text-slate-700">{meta.dataset ?? "static-demo"}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
