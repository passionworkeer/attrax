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

export interface AdminCountry {
  /** ISO 3166-1 alpha-2 国家代码，例如 CN / US */
  code: string;
  /** 中文国家名 */
  name: string;
  /** 该国访客的去重数（窗口内） */
  visitors: number;
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
  /** 用户国家分布：演示数据按身份 mock 注入；真实数据来自流量解析（待实现） */
  countries: AdminCountry[];
  recentScans: { id: string; timestamp: string; category: string; status: string; latencyMs: number | null }[];
  sources: { id: string; title: string; market: string; status: string; lastFetchedAt: string | null }[];
}
