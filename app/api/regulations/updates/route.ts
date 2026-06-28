import { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { fail, ok } from "@/lib/api-response";
import { regulationUpdates } from "./data";
import { enrichRegulation, daysUntil, riskRank, searchableText } from "./utils";

// Cache the filtered/sorted slice. The full payload (data + meta) is cached
// because the static-demo dataset only changes on rebuild — there is no
// upstream to invalidate from. 5-minute TTL keeps `daysUntilEffective` from
// drifting more than a few minutes, which is well inside the 45-day urgency
// threshold used by the sort.
const CACHE_REVALIDATE_SECONDS = 300;

// Upper bound for the search cache key. The slice that lands in the cache is
// static-demo data, so any non-empty query only narrows results — long or
// junk queries never increase the result set. Capping at 64 chars (after
// whitespace collapse + lowercase) keeps attackers from inflating the cache
// with millions of near-duplicate random strings (cache-poisoning DoS).
const SEARCH_KEY_MAX_LEN = 64;

/**
 * Normalize a raw search string into a stable cache-key component.
 *
 * - trim + collapse internal whitespace so "foo  bar" and "foo bar" share a slot
 * - lowercase so "Foo" and "foo" share a slot (the search itself is case-insensitive)
 * - cap length so an attacker cannot fan out the cache by appending noise
 *
 * Returns null for empty/whitespace-only input — the cache then keys on the
 * absence of search, not on its (irrelevant) value.
 */
function normalizeSearchKey(search: string | null): string | null {
  if (!search) return null;
  const collapsed = search.trim().replace(/\s+/g, " ").toLowerCase();
  if (!collapsed) return null;
  return collapsed.slice(0, SEARCH_KEY_MAX_LEN);
}

const getFilteredRegulations = unstable_cache(
  async (market: string | null, search: string | null, limit: number) => {
    let filtered = [...regulationUpdates];

    if (market && market !== "all") {
      filtered = filtered.filter(
        (regulation) => regulation.market.toLowerCase() === market.toLowerCase()
      );
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((regulation) =>
        searchableText(regulation).includes(searchLower)
      );
    }

    filtered.sort((a, b) => {
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

    const matchingCount = filtered.length;
    const returned = filtered.slice(0, limit).map(enrichRegulation);
    const lastVerifiedAt = regulationUpdates
      .map((r) => r.lastVerifiedAt)
      .sort()
      .at(-1);
    const effectiveSoon = filtered.filter((r) => {
      const days = daysUntil(r.effectiveDate);
      return days >= 0 && days <= 45;
    }).length;
    const highRisk = filtered.filter(
      (r) => r.riskLevel === "critical" || r.riskLevel === "high"
    ).length;

    return {
      data: returned,
      matchingCount,
      lastVerifiedAt,
      highRisk,
      effectiveSoon,
    };
  },
  ["regulations-updates-v1"],
  {
    revalidate: CACHE_REVALIDATE_SECONDS,
    tags: ["regulations-updates"],
  },
);

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get("market");
  const search = searchParams.get("search");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

  try {
    // Pass the NORMALIZED search as the cache-key component so junk queries
    // (random long strings, casing variants, extra whitespace) cannot fan out
    // the cache into millions of entries. The filtering inside the cached
    // closure still uses the normalized value — semantics are unchanged
    // because the filter is `searchableText(...).includes(normalizedLower)`.
    const cached = await getFilteredRegulations(market, normalizeSearchKey(search), limit);
    return ok({
      data: cached.data,
      meta: {
        total: regulationUpdates.length,
        matching: cached.matchingCount,
        returned: cached.data.length,
        markets: new Set(regulationUpdates.map((r) => r.market)).size,
        highRisk: cached.highRisk,
        effectiveSoon: cached.effectiveSoon,
        lastVerifiedAt: cached.lastVerifiedAt,
        timestamp: new Date().toISOString(),
        dataset: "static-demo",
      },
    });
  } catch (error) {
    console.error("Failed to fetch regulations:", error);
    return fail(
      { code: "REGULATIONS_FETCH_FAILED", message: "Failed to fetch regulations" },
      { status: 500 },
    );
  }
}
