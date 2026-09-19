"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, FileText, Radio, Activity, Filter, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import styles from "./regulations.module.css";
import { ArchiveTab } from "./ArchiveTab";
import { SourcesTab } from "./SourcesTab";
import { UpdatesTab } from "./UpdatesTab";

type TabKey = "archive" | "sources" | "updates";

interface TopStats {
  archive: { total: number; markets: number; withArticles: number; generatedAt: string | null } | null;
  sources: { total: number; markets: number; healthy: number; protected: number } | null;
  updates: { total: number; matching: number; returned: number; markets: number; highRisk: number; effectiveSoon: number; lastVerifiedAt: string | null; dataset: string | null } | null;
}

const TAB_KEYS: TabKey[] = ["archive", "sources", "updates"];

const fallbackStats: TopStats = {
  archive: null,
  sources: null,
  updates: null,
};

export default function RegulationsPage() {
  const { t, locale } = useTranslation();
  const [tab, setTab] = useState<TabKey>("archive");
  const [stats, setStats] = useState<TopStats>(fallbackStats);
  const [statsFailed, setStatsFailed] = useState(false);

  // Preload all three datasets on mount so tab switching is instant and the
  // top stat row reflects the real catalog size. The per-tab components
  // reuse the same data and only re-fetch when their own filter changes.
  useEffect(() => {
    const controller = new AbortController();
    const fetchAll = async () => {
      try {
        const [archiveRes, sourcesRes, updatesRes] = await Promise.all([
          fetch("/api/regulations/archive?limit=200", { signal: controller.signal }),
          fetch("/api/regulations/sources?limit=200", { signal: controller.signal }),
          fetch("/api/regulations/updates?limit=50", { signal: controller.signal }),
        ]);
        const [archiveJson, sourcesJson, updatesJson] = await Promise.all([
          archiveRes.ok ? archiveRes.json() : null,
          sourcesRes.ok ? sourcesRes.json() : null,
          updatesRes.ok ? updatesRes.json() : null,
        ]);
        const archive = archiveJson?.success
          ? {
              total: archiveJson.meta?.total ?? 0,
              markets: archiveJson.meta?.markets ?? 0,
              withArticles: archiveJson.meta?.withArticles ?? 0,
              generatedAt: archiveJson.meta?.generatedAt ?? null,
            }
          : null;
        const sources = sourcesJson?.success
          ? {
              total: sourcesJson.meta?.total ?? 0,
              markets: sourcesJson.meta?.markets ?? 0,
              healthy: sourcesJson.meta?.healthy ?? 0,
              protected: sourcesJson.meta?.protected ?? 0,
            }
          : null;
        const updates = updatesJson?.success
          ? {
              total: updatesJson.meta?.total ?? 0,
              matching: updatesJson.meta?.matching ?? 0,
              returned: updatesJson.meta?.returned ?? 0,
              markets: updatesJson.meta?.markets ?? 0,
              highRisk: updatesJson.meta?.highRisk ?? 0,
              effectiveSoon: updatesJson.meta?.effectiveSoon ?? 0,
              lastVerifiedAt: updatesJson.meta?.lastVerifiedAt ?? null,
              dataset: updatesJson.meta?.dataset ?? null,
            }
          : null;
        setStats({ archive, sources, updates });
        // HTTP 层的失败（5xx / 502 窗口）不会让 fetch 抛异常，只让 res.ok 为 false。
        // 不在这里标记的话，副标题会一直显示「— 篇法规档案（覆盖 — 个区域）」
        // 且没有任何横幅解释，看起来像数据本来就是空的。
        if (!archive || !sources || !updates) {
          setStatsFailed(true);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load regulations stats:", error);
        setStatsFailed(true);
      }
    };
    fetchAll();
    return () => controller.abort();
  }, []);

  const tabLabel = (key: TabKey) => t(`regulations.tabs.${key}`);

  return (
    <div className={`${styles.page} min-h-[calc(100vh-5rem)] px-4 py-8 sm:px-6 lg:px-8`}>
      <div className="mx-auto max-w-7xl">
        <Link href="/" className={styles.backLink}>
          ← {locale === "zh" ? "返回首页" : "Back to home"}
        </Link>

        <section className="glass-panel mb-6 rounded-3xl p-8 shadow-[0_30px_120px_rgba(0,0,0,0.5)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="label-caps mb-3 text-xs text-blaze-red/80">
                <Filter className="mr-2 inline h-3.5 w-3.5" />
                {t("regulations.demoBadge")}
              </p>
              <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">
                {t("regulations.title")}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
                {t("regulations.subtitle", {
                  archive: stats.archive?.total ?? "—",
                  markets: stats.archive?.markets ?? "—",
                  sources: stats.sources?.total ?? "—",
                  updates: stats.updates?.matching ?? "—",
                })}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-sm text-slate-300 backdrop-blur">
              <Activity className="h-4 w-4 text-slate-400" />
              <span>
                {locale === "zh" ? "数据源" : "Sources"}:{" "}
                <span className="font-medium text-white">regulations_index.json</span> +{" "}
                <span className="font-medium text-white">official_sources.json</span>
              </span>
            </div>
          </div>
        </section>

        {statsFailed ? (
          <div role="alert" className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200/40 bg-amber-50/10 p-4 text-amber-100">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
            <span className="text-sm">
              {locale === "zh"
                ? "法规元数据加载失败，部分统计可能缺失。"
                : "Failed to load regulation metadata; some stats may be missing."}
            </span>
          </div>
        ) : null}

        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{t("regulations.archive.totalLabel")}</span>
              <FileText className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-white">
              {stats.archive?.total ?? <span className="text-slate-500">—</span>}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {stats.archive
                ? `${stats.archive.markets} ${locale === "zh" ? "市场" : "markets"} · ${stats.archive.withArticles} ${
                    locale === "zh" ? "已结构化" : "with articles"
                  }`
                : ""}
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{t("regulations.sources.totalLabel")}</span>
              <Radio className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-white">
              {stats.sources?.total ?? <span className="text-slate-500">—</span>}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {stats.sources
                ? `${stats.sources.healthy} ${locale === "zh" ? "可达" : "reachable"} · ${
                    stats.sources.protected
                  } ${locale === "zh" ? "受限" : "restricted"}`
                : ""}
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{t("regulations.highPriority")}</span>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </div>
            <p className="text-2xl font-bold text-orange-400">{stats.updates?.highRisk ?? 0}</p>
            <p className="mt-1 text-xs text-slate-500">
              {stats.updates
                ? `${stats.updates.effectiveSoon} ${locale === "zh" ? "45 天内生效" : "effective within 45d"}`
                : ""}
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">{t("regulations.trackedMarkets")}</span>
              <Search className="h-4 w-4 text-blaze-red" />
            </div>
            <p className="text-2xl font-bold text-blaze-red">
              {new Set([
                ...(stats.archive?.markets ? [stats.archive.markets] : []),
                ...(stats.sources?.markets ? [stats.sources.markets] : []),
                ...(stats.updates?.markets ? [stats.updates.markets] : []),
              ]).size > 0
                ? Math.max(stats.archive?.markets ?? 0, stats.sources?.markets ?? 0, stats.updates?.markets ?? 0)
                : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {stats.updates?.dataset
                ? `updates · ${stats.updates.dataset}`
                : locale === "zh"
                  ? "updates · pending watchdog"
                  : "updates · pending watchdog"}
            </p>
          </div>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/40 p-1 backdrop-blur">
          {TAB_KEYS.map((key) => {
            const count =
              key === "archive"
                ? stats.archive?.total
                : key === "sources"
                  ? stats.sources?.total
                  : stats.updates?.matching;
            const isActive = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex-1 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blaze-red text-white shadow-[0_0_15px_rgba(217,58,26,0.4)]"
                    : "text-slate-300 hover:bg-slate-800/60"
                }`}
              >
                {tabLabel(key)}
                {typeof count === "number" && count > 0 ? (
                  <span
                    className={`ml-2 inline-flex min-w-[1.5rem] justify-center rounded-full px-1.5 text-xs ${
                      isActive ? "bg-white/20 text-white" : "bg-slate-700/60 text-slate-300"
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {tab === "archive" ? <ArchiveTab /> : null}
        {tab === "sources" ? <SourcesTab /> : null}
        {tab === "updates" ? <UpdatesTab /> : null}
      </div>
    </div>
  );
}
