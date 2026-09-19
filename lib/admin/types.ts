export interface AdminDay {
  date: string;
  visitors: number | null;
  pageViews: number | null;
  apiCalls: number | null;
  scans: number | null;
  completed: number | null;
  failed: number | null;
  fetched: number | null;
  newRegulations: number | null;
  updatedRegulations: number | null;
}

export interface AdminOverview {
  generatedAt: string;
  timezone: string;
  days: number;
  coverage: { trafficSince: string | null; scansSince: string | null; notes: string[] };
  totals: { visitors: number; pageViews: number; apiCalls: number; scans: number; completed: number; failed: number; averageLatencyMs: number | null; regulations: number; markets: number; sources: number; fetched: number; newRegulations: number };
  series: AdminDay[];
  markets: { name: string; count: number }[];
  categories: { name: string; count: number }[];
  recentScans: { id: string; timestamp: string; category: string; status: string; latencyMs: number | null }[];
  sources: { id: string; title: string; market: string; status: string; lastFetchedAt: string | null }[];
}
