// GET /api/regulations/archive
//
// Returns the regulation catalog (968 entries as of 2026-09-19 dedup) from
// `data/regulations/regulations_index.json`. Backs the "法规档案" tab
// on `/regulations`. Optional `market` and `search` query params narrow
// the result set; the route applies the filter on top of the in-memory
// archive so client-side filtering is just a `useDeferredValue` away.

import { type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { fail, ok } from "@/lib/api-response";
import { readArchive, searchArchive } from "@/lib/regulations/archive-data";
import type { ArchiveMeta } from "@/lib/regulations/types";

const CACHE_REVALIDATE_SECONDS = 300;
const SEARCH_KEY_MAX_LEN = 64;

function normalizeSearchKey(search: string | null): string | null {
  if (!search) return null;
  const collapsed = search.trim().replace(/\s+/g, " ").toLowerCase();
  if (!collapsed) return null;
  return collapsed.slice(0, SEARCH_KEY_MAX_LEN);
}

const getFilteredArchive = unstable_cache(
  async (market: string | null, search: string | null, limit: number) => {
    const { entries, generatedAt } = await readArchive();
    let filtered = entries;

    if (market && market !== "all") {
      filtered = filtered.filter((entry) => entry.region.toLowerCase() === market.toLowerCase());
    }
    if (search) {
      filtered = searchArchive(filtered, search);
    }

    // Most articles first, then alphabetical — predictable ordering when
    // nothing else narrows the slice.
    filtered.sort((a, b) => {
      if (a.articleCount !== b.articleCount) return b.articleCount - a.articleCount;
      return a.shortName.localeCompare(b.shortName);
    });

    const matching = filtered.length;
    const returned = filtered.slice(0, limit);
    const withArticles = filtered.filter((e) => e.articleCount > 0).length;
    const markets = new Set(filtered.map((e) => e.region)).size;

    return {
      data: returned,
      matchingCount: matching,
      total: entries.length,
      withArticles,
      markets,
      generatedAt,
    };
  },
  ["regulations-archive-v1"],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["regulations-archive"] },
);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get("market");
  const search = searchParams.get("search");
  const limit = Math.min(parseInt(searchParams.get("limit") || "100", 10), 200);

  try {
    const cached = await getFilteredArchive(market, normalizeSearchKey(search), limit);
    const meta: ArchiveMeta = {
      total: cached.total,
      matching: cached.matchingCount,
      returned: cached.data.length,
      markets: cached.markets,
      withArticles: cached.withArticles,
      generatedAt: cached.generatedAt,
    };
    return ok({ data: cached.data, meta });
  } catch (error) {
    console.error("Failed to fetch regulation archive:", error);
    return fail(
      { code: "ARCHIVE_FETCH_FAILED", message: "Failed to fetch regulation archive" },
      { status: 500 },
    );
  }
}
