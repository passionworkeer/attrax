// GET /api/regulations/sources
//
// Returns the watchdog source registry (37 entries) from
// `data/regulation_sources/official_sources.json`. Backs the "抓取源" tab
// on `/regulations`. Each row carries a `humanViewStatus` health field
// so the page can show whether a URL is reachable / protected by WAF /
// unreachable.
//
// Optional `market` and `health` query params filter; `search` matches
// against title, channel, source type, notes, and category lists.

import { type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { fail, ok } from "@/lib/api-response";
import { readSources, searchSources } from "@/lib/regulations/sources-data";
import type { SourcesMeta, SourceHealth } from "@/lib/regulations/types";

const CACHE_REVALIDATE_SECONDS = 300;
const SEARCH_KEY_MAX_LEN = 64;
const VALID_HEALTH: ReadonlySet<SourceHealth> = new Set([
  "ok",
  "anti_bot",
  "waf_challenge_temporary",
  "unreachable",
  "unknown",
]);

function normalizeSearchKey(search: string | null): string | null {
  if (!search) return null;
  const collapsed = search.trim().replace(/\s+/g, " ").toLowerCase();
  if (!collapsed) return null;
  return collapsed.slice(0, SEARCH_KEY_MAX_LEN);
}

function normalizeHealthFilter(health: string | null): SourceHealth | null {
  if (!health || health === "all") return null;
  return VALID_HEALTH.has(health as SourceHealth) ? (health as SourceHealth) : null;
}

const getFilteredSources = unstable_cache(
  async (market: string | null, health: SourceHealth | null, search: string | null, limit: number) => {
    const { entries } = await readSources();
    let filtered = entries;

    if (market && market !== "all") {
      filtered = filtered.filter((entry) => entry.market.toLowerCase() === market.toLowerCase());
    }
    if (health) {
      filtered = filtered.filter((entry) => entry.humanViewStatus === health);
    }
    if (search) {
      filtered = searchSources(filtered, search);
    }

    // Healthy first, then alphabetical — gives the page a stable "good news
    // first" presentation while still letting the user spot a problem.
    filtered.sort((a, b) => {
      const aOk = a.humanViewStatus === "ok" ? 0 : 1;
      const bOk = b.humanViewStatus === "ok" ? 0 : 1;
      if (aOk !== bOk) return aOk - bOk;
      return a.title.localeCompare(b.title);
    });

    const matching = filtered.length;
    const returned = filtered.slice(0, limit);
    const healthy = filtered.filter((e) => e.humanViewStatus === "ok").length;
    const protected_ = filtered.filter((e) => e.humanViewStatus !== "ok").length;
    const byHealth: Record<SourceHealth, number> = {
      ok: 0,
      anti_bot: 0,
      waf_challenge_temporary: 0,
      unreachable: 0,
      unknown: 0,
    };
    const byMarket: Record<string, number> = {};
    for (const entry of filtered) {
      byHealth[entry.humanViewStatus] += 1;
      byMarket[entry.market] = (byMarket[entry.market] ?? 0) + 1;
    }

    return {
      data: returned,
      matchingCount: matching,
      total: entries.length,
      markets: new Set(filtered.map((e) => e.market)).size,
      healthy,
      protected: protected_,
      byHealth,
      byMarket,
    };
  },
  ["regulations-sources-v1"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["regulations-sources"] },
);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get("market");
  const healthParam = searchParams.get("health");
  const search = searchParams.get("search");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 200);

  try {
    const cached = await getFilteredSources(
      market,
      normalizeHealthFilter(healthParam),
      normalizeSearchKey(search),
      limit,
    );
    const meta: SourcesMeta = {
      total: cached.total,
      matching: cached.matchingCount,
      returned: cached.data.length,
      markets: cached.markets,
      healthy: cached.healthy,
      protected: cached.protected,
      byHealth: cached.byHealth,
      byMarket: cached.byMarket,
    };
    return ok({ data: cached.data, meta });
  } catch (error) {
    console.error("Failed to fetch regulation sources:", error);
    return fail(
      { code: "SOURCES_FETCH_FAILED", message: "Failed to fetch regulation sources" },
      { status: 500 },
    );
  }
}
