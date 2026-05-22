"use client";

import { useState, useEffect } from "react";
import { Search, Filter, ChevronDown, Calendar, AlertTriangle, ExternalLink } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export interface RegulationUpdate {
  id: string;
  market: string;
  title: string;
  titleEn: string;
  publishDate: string;
  effectiveDate: string;
  affectedCategories: string[];
  summary: string;
  summaryEn: string;
  sourceUrl: string;
}

const marketLabelKeys: Record<string, string> = {
  EU: "markets.EU",
  US: "markets.US",
  UK: "markets.UK",
  CN: "markets.CN",
  AU: "markets.AU",
  SA: "markets.SA",
  AE: "markets.UAE",
};

const marketFilterKeys: Record<string, string> = {
  all: "regulations.allMarkets",
  EU: "markets.EU",
  US: "markets.US",
  UK: "markets.UK",
  CN: "markets.CN",
  AU: "markets.AU",
  SA: "markets.SA",
  AE: "markets.UAE",
};

const marketCodes = ["all", "EU", "US", "UK", "CN", "AU", "SA", "AE"] as const;

export default function RegulationsPage() {
  const { t, locale } = useTranslation();
  const [regulations, setRegulations] = useState<RegulationUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedMarket, setSelectedMarket] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchRegulations = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (selectedMarket !== "all") params.set("market", selectedMarket);

        const response = await fetch(`/api/regulations/updates?${params.toString()}`);
        const data = await response.json();

        if (data.success) {
          setRegulations(data.data);
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
      month: "long",
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
    <div className="min-h-screen bg-gray-50 py-12 px-6">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            {t("regulations.title")}
          </h1>
          <p className="text-gray-600">
            {t("regulations.subtitle")}
          </p>
        </div>

        {/* Search and Filter */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder={t("regulations.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-gray-900 placeholder-gray-400 focus:border-blaze-red focus:outline-none focus:ring-2 focus:ring-blaze-red/20"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0">
            {marketCodes.map((code) => (
              <button
                key={code}
                onClick={() => setSelectedMarket(code)}
                className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  selectedMarket === code
                    ? "bg-blaze-red text-white"
                    : "bg-white text-gray-600 hover:bg-gray-100"
                }`}
              >
                {t(marketFilterKeys[code])}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blaze-red border-t-transparent" />
          </div>
        ) : regulations.length > 0 ? (
          <div className="space-y-4">
            {regulations.map((regulation) => {
              const isExpanded = expandedIds.has(regulation.id);
              const daysUntil = getDaysUntilEffective(regulation.effectiveDate);
              const isUrgent = daysUntil > 0 && daysUntil <= 30;
              const marketInfo = marketLabelKeys[regulation.market] || regulation.market;
              const marketLabel = t(marketInfo);
              const title = locale === "en" ? regulation.titleEn : regulation.title;

              return (
                <div
                  key={regulation.id}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                          {marketLabel}
                        </span>
                        {isUrgent && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">
                            <AlertTriangle className="w-3 h-3" />
                            {t("regulations.comingSoon")}
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {title}
                      </h3>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>{t("regulations.published")}: {formatDate(regulation.publishDate)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>{t("regulations.effective")}: {formatDate(regulation.effectiveDate)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleExpand(regulation.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      {isExpanded ? t("regulations.collapse") : t("regulations.viewDetails")}
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <p className="text-gray-600 mb-4">
                        {locale === "en" ? regulation.summaryEn : regulation.summary}
                      </p>

                      <div className="mb-4">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">
                          {t("regulations.affectedCategories")}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {regulation.affectedCategories.map((category) => (
                            <span
                              key={category}
                              className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                            >
                              {category}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <a
                          href={regulation.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
                        >
                          {t("regulations.viewSource")}
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        {daysUntil > 0 && (
                          <span className="text-sm text-gray-500">
                            {t("regulations.daysLeft", { days: daysUntil })}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Filter className="mb-4 h-12 w-12 text-gray-300" />
            <p className="text-lg font-medium text-gray-900 mb-2">
              {t("regulations.noResults")}
            </p>
          </div>
        )}

        {/* Footer Stats */}
        {!loading && regulations.length > 0 && (
          <div className="mt-8 rounded-xl bg-white p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{t("regulations.showing", { from: 1, to: regulations.length, total: regulations.length })}</p>
                <p className="text-2xl font-bold text-gray-900">{regulations.length}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">{t("regulations.total")}</p>
                <p className="text-2xl font-bold text-blaze-red">96+</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
