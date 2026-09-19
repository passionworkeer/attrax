// /regulations 页面（server component）。
//
// 历史版本是 use client，stats 数字通过 useEffect 在客户端 fetch /api/regulations/{archive,sources,updates} 后填入；
// 这种 client-side dynamic 在 build 时被 Next.js 当作 prerender shell 缓存
// （x-nextjs-prerender: 1 + Cache-Control: s-maxage=31536000），SSR HTML 里数字永远是
// fallback "—"。本次改为 server component：在 server 端直接调 readArchive() /
// readSources() / getLiveRegulationUpdates()，stats 嵌进 SSR HTML — 用户首次请求就看到
// 真实数字（1052 / 25 区域等等），后续 deploy 也会随 regulations_index.json / watchdog
// 实时更新。
//
// 客户端 tab 切换 + 重新刷新能力移交给 RegulationsClient（client component）。

import { readArchive } from "@/lib/regulations/archive-data";
import { readSources } from "@/lib/regulations/sources-data";
import { readRawStats } from "@/lib/regulations/raw-stats";
import RegulationsClient, { type TopStats } from "@/components/regulation/RegulationsClient";
import { getLiveRegulationUpdates } from "@/app/api/regulations/updates/watchdog-source";
import { STATIC_DEMO } from "@/app/api/regulations/updates/data";
import type { SourceEntry } from "@/lib/regulations/types";
import type { RegulationUpdate } from "@/app/api/regulations/updates/types";
import { daysUntil, riskRank } from "@/app/api/regulations/updates/utils";

export const dynamic = "force-dynamic";

const EMPTY_ARCHIVE = { entries: [], generatedAt: null } as {
  entries: Awaited<ReturnType<typeof readArchive>>["entries"];
  generatedAt: string | null;
};
const EMPTY_SOURCES = { entries: [] as SourceEntry[] };
const EMPTY_UPDATES: RegulationUpdate[] = [];
const EMPTY_RAW_STATS = { marketsCovered: 0, totalRawFiles: 0, marketsList: [] };

function countArchiveMarkets(entries: ReadonlyArray<{ region: string }>): number {
  return new Set(entries.map((e) => e.region)).size;
}

function countUpdatesMarkets(updates: ReadonlyArray<{ market: string }>): number {
  return new Set(updates.map((u) => u.market)).size;
}

export default async function RegulationsPage() {
  const [archiveResult, sourcesResult, liveUpdates, rawStats] = await Promise.all([
    readArchive().catch(() => EMPTY_ARCHIVE),
    readSources().catch(() => EMPTY_SOURCES),
    getLiveRegulationUpdates().catch(() => EMPTY_UPDATES),
    readRawStats().catch(() => EMPTY_RAW_STATS),
  ]);

  const archiveEntries = archiveResult.entries;
  const sourceEntries = sourcesResult.entries;
  const allUpdates: RegulationUpdate[] = [...liveUpdates, ...STATIC_DEMO];

  const withArticles = archiveEntries.filter((e) => e.articleCount > 0).length;
  const sortedByUrgent = [...allUpdates].sort((a, b) => {
    const aDays = daysUntil(a.effectiveDate);
    const bDays = daysUntil(b.effectiveDate);
    const aUrgent = aDays >= 0 && aDays <= 45;
    const bUrgent = bDays >= 0 && bDays <= 45;
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    if (riskRank[a.riskLevel] !== riskRank[b.riskLevel]) {
      return riskRank[a.riskLevel] - riskRank[b.riskLevel];
    }
    return new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime();
  });
  const effectiveSoon = sortedByUrgent.filter((r) => {
    const days = daysUntil(r.effectiveDate);
    return days >= 0 && days <= 45;
  }).length;
  const highRisk = sortedByUrgent.filter(
    (r) => r.riskLevel === "critical" || r.riskLevel === "high",
  ).length;

  const healthy = sourceEntries.filter((s) => s.humanViewStatus === "ok").length;
  const protectedCount = sourceEntries.filter(
    (s) => s.humanViewStatus !== "ok" && s.humanViewStatus !== "unknown",
  ).length;

  const initialStats: TopStats = {
    archive: {
      total: archiveEntries.length,
      markets: countArchiveMarkets(archiveEntries),
      withArticles,
      generatedAt: archiveResult.generatedAt,
    },
    sources: {
      total: sourceEntries.length,
      markets: new Set(sourceEntries.map((s) => s.market)).size,
      healthy,
      protected: protectedCount,
    },
    updates: {
      total: allUpdates.length,
      matching: allUpdates.length,
      returned: 50,
      markets: countUpdatesMarkets(allUpdates),
      highRisk,
      effectiveSoon,
      lastVerifiedAt: null,
      dataset: liveUpdates.length > 0 ? "static-demo+live" : "static-demo",
    },
    raw: {
      marketsCovered: rawStats.marketsCovered,
      totalRawFiles: rawStats.totalRawFiles,
    },
  };

  return <RegulationsClient initialStats={initialStats} />;
}