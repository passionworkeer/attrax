// Shared view-model types for the /regulations surface.
//
// The page exposes three coordinated views backed by three different
// upstream files:
//
//   1. 法规档案 (`/api/regulations/archive`)  ← `data/regulations/regulations_index.json`
//      Curated reference catalog of all 61 regulations anchored for the
//      scanner, with one entry per source. Read-only on the API surface.
//
//   2. 抓取源 (`/api/regulations/sources`)    ← `data/regulation_sources/official_sources.json`
//      Watchdog ingestion registry — the 37 official channels the
//      bot fetches every day. Each entry carries a `human_view_status`
//      health field so the page can show whether the URL is reachable.
//
//   3. 近期动态 (`/api/regulations/updates`)  ← `STATIC_DEMO` + watchdog live records
//      Editorial cards summarising a change. See `./types.ts` in the
//      updates route for `RegulationUpdate`.
//
// These three views are independent on disk; the API returns
// `lastUpdatedAt` so the page can label the dataset honestly (e.g.
// "抓取源 / 2026-09-17 / 37 条") and not conflate them.

export interface ArchiveEntry {
  id: string;
  region: string;
  officialCitation: string;
  shortName: string;
  sourceUrl: string | null;
  purchaseUrl: string | null;
  articleCount: number;
  license: string | null;
}

export type SourceHealth = "ok" | "anti_bot" | "waf_challenge_temporary" | "unreachable" | "unknown";

export interface SourceEntry {
  id: string;
  market: string;
  title: string;
  channel: string;
  sourceType: string;
  sourceUrl: string;
  humanViewUrl: string;
  humanViewStatus: SourceHealth;
  watchdogActualFetch: string;
  productCategories: string[];
  regulatoryTypes: string[];
  notes: string;
  authorityTier: string;
  regulationId: string | null;
  fetchStatus: string | null;
  ecfrTitle: number | null;
  ecfrPart: number | null;
  files: string[];
}

export interface ArchiveMeta {
  total: number;
  matching: number;
  returned: number;
  markets: number;
  withArticles: number;
  generatedAt: string | null;
}

export interface SourcesMeta {
  total: number;
  matching: number;
  returned: number;
  markets: number;
  healthy: number;
  protected: number;
  byHealth: Record<SourceHealth, number>;
  byMarket: Record<string, number>;
}
