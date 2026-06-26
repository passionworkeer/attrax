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
    const cached = await getFilteredRegulations(market, search, limit);
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
