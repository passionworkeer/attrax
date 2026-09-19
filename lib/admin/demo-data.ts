// 管理员看板「演示数据」：为 MVP 推广演示生成一套形态真实、数值克制的
// 假想运营数据。纯客户端模块，不读任何运行时文件；固定种子保证每次
// 刷新数字一致（演示时数字跳变会显得造假）。
//
// 口径设计（与真实统计对齐）：
// - 访客按「访客身份」模拟——老访客按概率回访、每天有新访客加入，窗口
//   去重数 = 窗口内出现过的身份数。近 30 天去重访客落在 40–49（推广期
//   增长加速的故事），7 天约十几人、90 天约六十人。
// - 扫描量近 30 天约 280 次、90 天约 680 次（几百次量级），失败率 3–8%。
// - 法规存量/市场/来源数量沿用生产真实规模（1052 条 / 25 市场 / 37 源），
//   演示时与公开页面可对得上。
import type { AdminCountry, AdminDay, AdminOverview } from "./types";

const WINDOW_MAX = 90;
const RNG_SEED = 20260919;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_MARKETS: [string, number][] = [
  ["US", 400], ["CN", 259], ["EU", 117], ["GLOBAL", 75], ["DE", 36], ["CA", 34],
  ["AU", 13], ["JP", 13], ["VN", 12], ["UK", 11], ["SG", 9], ["ID", 8], ["MY", 8],
  ["UN", 8], ["AE", 7], ["BR", 7], ["KR", 6], ["FR", 6], ["IT", 5], ["SA", 5],
  ["MX", 5], ["TH", 4], ["NZ", 2], ["IN", 1], ["GCC", 1],
];

const DEMO_SOURCES: [string, string, string][] = [
  ["eu-2023-988-general-product-safety", "Regulation (EU) 2023/988 on general product safety", "EU"],
  ["eu-2009-48-toy-safety", "Directive 2009/48/EC on the safety of toys", "EU"],
  ["eu-2011-65-rohs", "Directive 2011/65/EU on restriction of hazardous substances", "EU"],
  ["eu-2012-19-weee", "Directive 2012/19/EU on waste electrical and electronic equipment", "EU"],
  ["eu-2014-53-radio-equipment", "Directive 2014/53/EU on radio equipment", "EU"],
  ["eu-2014-30-emc", "Directive 2014/30/EU on electromagnetic compatibility", "EU"],
  ["eu-2014-35-low-voltage", "Directive 2014/35/EU on low voltage electrical equipment", "EU"],
  ["eu-2019-1020-market-surveillance", "Regulation (EU) 2019/1020 on market surveillance", "EU"],
  ["us-16-cfr-1307-phthalates", "16 CFR Part 1307, Prohibition of Specified Phthalates", "US"],
  ["us-16-cfr-1630-carpets-rugs", "16 CFR Part 1630, Surface Flammability of Carpets and Rugs", "US"],
  ["us-16-cfr-1631-small-carpets-rugs", "16 CFR Part 1631, Surface Flammability of Small Carpets Rugs", "US"],
  ["us-16-cfr-1633-mattresses-open-flame", "16 CFR Part 1633, Flammability (Open Flame) of Mattress Sets", "US"],
  ["us-16-cfr-1700-poison-prevention-packaging", "16 CFR Part 1700, Poison Prevention Packaging", "US"],
  ["us-cpsc-recalls-api", "CPSC Recalls (SaferProducts.gov REST API)", "US"],
  ["us-fda-device-recalls", "FDA device recall enforcement reports (OpenFDA)", "US"],
  ["us-fda-food-enforcement", "FDA food + food-contact enforcement reports (OpenFDA)", "US"],
  ["ca-consumer-chemicals-containers-2001", "Consumer Chemicals and Containers Regulations, 2001", "CA"],
  ["ca-surface-coating-materials", "Surface Coating Materials Regulations", "CA"],
  ["ca-phthalates-regulations", "Phthalates Regulations", "CA"],
  ["ca-childrens-sleepwear", "Children's Sleepwear Regulations", "CA"],
  ["ca-products-containing-lead", "Consumer Products Containing Lead Regulations", "CA"],
  ["ca-corded-window-coverings", "Corded Window Coverings Regulations", "CA"],
  ["uk-weee-regulations-guidance", "Regulations: waste electrical and electronic equipment", "UK"],
  ["uk-packaging-epr-who-is-affected", "Extended producer responsibility for packaging", "UK"],
  ["uk-reach-compliance-guidance", "How to comply with REACH chemical regulations", "UK"],
  ["uk-hse-svhc-overview", "Substances of very high concern overview", "UK"],
  ["nz-product-safety-toys-2005", "Children's toy standard", "NZ"],
  ["nz-product-safety-cots-2016", "Household cot standard", "NZ"],
  ["eu-safety-gate-alerts", "Safety Gate (RAPEX) weekly notifications", "EU"],
  ["cn-samr-product-recall", "国家市场监督管理总局 召回信息", "CN"],
  ["cn-cnca-ccc-updates", "国家认监委 CCC 公告", "CN"],
  ["jp-meti-pse-list", "METI 電気用品安全法 (PSE) 適用範囲", "JP"],
  ["kr-motie-kc-safety", "KC 안전확인 (Safety Confirmation) — MOTIE", "KR"],
  ["ae-moiat-ecas", "MoIAT ECAS 合格评定计划公告", "AE"],
  ["sa-saso-news", "SASO 标准与 SABER 公告", "SA"],
  ["br-inmetro-novidades", "INMETRO 强制认证目录与公告", "BR"],
  ["in-bis-crs", "BIS Compulsory Registration Scheme (CRS) 公告", "IN"],
];

// 抓取不稳的少数来源：演示里标记 error，其余 fetched。
const DEMO_ERROR_SOURCES = new Set(["eu-safety-gate-alerts", "cn-samr-product-recall", "kr-motie-kc-safety"]);

const SCAN_CATEGORY_WEIGHTS: [string, number][] = [
  ["electronics", 0.34], ["toy", 0.16], ["battery", 0.12], ["textile", 0.10],
  ["cosmetic", 0.08], ["3c", 0.08], ["home", 0.06], ["food_contact", 0.04], ["appliance", 0.02],
];

// 演示用「访客国家」权重池 —— 中国 / 美国为主，海外目标市场次之，欧洲与
// 东南亚分摊。顺序与权重固定，相同种子下生成的国家分布完全可重现。
// 数字之和 ≈ 1.0；个别长尾国家 <1% 也保留，体现「在试水」。
const COUNTRY_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ["CN", 0.32], ["US", 0.18], ["GB", 0.07], ["DE", 0.06], ["FR", 0.04], ["JP", 0.05],
  ["KR", 0.04], ["SG", 0.04], ["AU", 0.03], ["CA", 0.03], ["VN", 0.03], ["IN", 0.02],
  ["BR", 0.02], ["AE", 0.02], ["MX", 0.02], ["ID", 0.01], ["TH", 0.01], ["MY", 0.01],
];
const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  CN: "中国", US: "美国", GB: "英国", DE: "德国", FR: "法国", JP: "日本", KR: "韩国",
  SG: "新加坡", AU: "澳大利亚", CA: "加拿大", VN: "越南", IN: "印度", BR: "巴西",
  AE: "阿联酋", MX: "墨西哥", ID: "印尼", TH: "泰国", MY: "马来西亚",
};

function pickWeighted(random: () => number, table: ReadonlyArray<readonly [string, number]>): string {
  let roll = random();
  for (const [name, weight] of table) {
    if (roll < weight) return name;
    roll -= weight;
  }
  return table[table.length - 1][0];
}

const beijingDay = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

function simulate(days: number): { series: AdminDay[]; identities: { active: boolean[]; country: string }[] } {
  const random = mulberry32(RNG_SEED);
  const today = new Date();
  const dates = Array.from({ length: WINDOW_MAX }, (_, index) => {
    const date = new Date(today.getTime() - (WINDOW_MAX - 1 - index) * 86400000);
    return { index, date, key: beijingDay(date), weekday: date.getUTCDay() };
  });
  const weekend = (weekday: number) => weekday === 0 || weekday === 6 ? 0.6 : 1;

  // 访客身份模拟：前 60 天每天约 0.3 个新访客，后 30 天加速到每天约 1.1 个
  // （推广期）。约 1/5 成为常访用户（每日回访概率 0.55–0.8），其余偶尔
  // 回访（0.05–0.18）。加入当天必然出现；窗口去重 = 窗口内出现过的身份数。
  // 每个身份还绑定一个国家 + 角色，用于国家/角色分布。
  // 国家级角色分配的随机数走独立 RNG（不与活动性/扫描/法规等共享），否则
  // 新增一次 pickWeighted 调用就会改掉整棵树的随机序列，把国家级数据全
  // 改成种子序列靠后的低权重国家（实测 30 天窗口出现「41 个访客全是 MY」
  // 的退化）。挑了若干候选种子比对，最终用 seed+41 的中国占多数分布。
  type Identity = { active: boolean[]; country: string };
  const identityRng = mulberry32(RNG_SEED + 41);
  for (let i = 0; i < 5; i++) identityRng();
  const identities: Identity[] = [];
  for (const day of dates) {
    const newcomerRate = day.index < 60 ? 0.3 : 1.2;
    let newcomers = Math.floor(newcomerRate);
    if (random() < newcomerRate % 1) newcomers += 1;
    for (let n = 0; n < newcomers; n++) {
      // 约 1/5 成为常访用户（每日回访 0.55–0.8）；其余大多数是一次性访客
      //（只在加入当天出现），仅约 3 成会以低频回访（0.08–0.2）。
      const loyal = random() < 0.2;
      const returning = loyal || random() < 0.3;
      const activity = loyal ? 0.55 + random() * 0.25 : 0.08 + random() * 0.12;
      identities.push({
        active: dates.map(other => other.index === day.index || (returning && other.index > day.index && random() < activity * weekend(other.weekday))),
        country: pickWeighted(identityRng, COUNTRY_WEIGHTS),
      });
    }
  }

  const series: AdminDay[] = dates.map(day => {
    const growth = day.index / (WINDOW_MAX - 1);
    const visitors = identities.filter(identity => identity.active[day.index]).length;
    const pageViews = Math.round(visitors * (1.7 + random() * 1.1));
    const scans = Math.max(1, Math.round((2 + 11 * growth) * weekend(day.weekday) + random() * 3));
    const failed = random() < 0.05 ? 1 : 0;
    const completed = scans - failed;
    const apiCalls = Math.round(scans * (24 + random() * 12) + visitors * (7 + random() * 6));
    const fetched = random() < 0.2 ? 6 + Math.floor(random() * 7) : 18 + Math.floor(random() * 22);
    const newRegulations = random() < 0.25 ? 1 + Math.floor(random() * 3) : 0;
    const updatedRegulations = Math.floor(random() * 5);
    return {
      date: day.key, visitors, pageViews, apiCalls, scans, completed, failed,
      fetched, newRegulations, updatedRegulations,
    };
  });
  return { series, identities };
}

function scanId(random: () => number): string {
  const hex = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 24; i++) id += hex[Math.floor(random() * 16)];
  return `scan_${id}`;
}

export function buildDemoOverview(days: 7 | 30 | 90): AdminOverview {
  if (![7, 30, 90].includes(days)) throw new Error("演示数据仅支持 7、30、90 天");
  const now = new Date();
  const { series: fullSeries, identities } = simulate(days);
  const windowStart = WINDOW_MAX - days;
  const series = fullSeries.slice(windowStart);
  // 窗口去重：身份只要在窗口内某一天出现过就算一次（与真实采集行为一致）
  const inWindow = identities.filter(identity => identity.active.some((active, index) => active && index >= windowStart));
  const distinctVisitors = inWindow.length;
  const sum = (key: keyof AdminDay) => series.reduce((total, day) => total + Number(day[key] ?? 0), 0);
  const random = mulberry32(RNG_SEED + 7);
  const averageLatencyMs = 43000 + Math.floor(random() * 14000);
  // 时间戳取整到小时：同一小时内刷新，演示数据逐字节一致。
  const hourBase = Math.floor(now.getTime() / 3600000) * 3600000;
  const regulations = DEMO_MARKETS.reduce((total, [, count]) => total + count, 0);
  const recentScans = Array.from({ length: 12 }, (_, index) => {
    const offsetDays = Math.floor(index / 2.2);
    const timestamp = new Date(hourBase - offsetDays * 86400000 - Math.floor(random() * 10) * 3600000).toISOString();
    const failed = index === 4;
    const degraded = index === 9;
    return {
      id: scanId(random),
      timestamp,
      category: pickWeighted(random, SCAN_CATEGORY_WEIGHTS),
      status: failed ? "failed" : degraded ? "degraded" : "ready",
      latencyMs: 32000 + Math.floor(random() * 56000),
    };
  });
  const categoryCounts = new Map<string, number>();
  for (const [name] of SCAN_CATEGORY_WEIGHTS) categoryCounts.set(name, 0);
  for (const scan of recentScans) categoryCounts.set(scan.category, (categoryCounts.get(scan.category) ?? 0) + 1);
  for (const [name, weight] of SCAN_CATEGORY_WEIGHTS) {
    categoryCounts.set(name, (categoryCounts.get(name) ?? 0) + Math.round(sum("scans") * weight * 0.85));
  }
  // 国家：按窗口内身份聚合去重（一个身份算一个用户，不管活跃几天）。
  const countryCounts = new Map<string, number>();
  for (const identity of inWindow) {
    countryCounts.set(identity.country, (countryCounts.get(identity.country) ?? 0) + 1);
  }
  const countries: AdminCountry[] = [...countryCounts]
    .map(([code, visitors]) => ({
      code,
      name: COUNTRY_NAMES[code] ?? code,
      visitors,
    }))
    .sort((a, b) => b.visitors - a.visitors || a.code.localeCompare(b.code));
  return {
    generatedAt: now.toISOString(),
    timezone: "Asia/Shanghai",
    days,
    coverage: {
      trafficSince: new Date(now.getTime() - (WINDOW_MAX + 21) * 86400000).toISOString(),
      scansSince: new Date(now.getTime() - (WINDOW_MAX + 10) * 86400000).toISOString(),
      notes: [],
    },
    totals: {
      visitors: distinctVisitors,
      pageViews: sum("pageViews"),
      apiCalls: sum("apiCalls"),
      scans: sum("scans"),
      completed: sum("completed"),
      failed: sum("failed"),
      averageLatencyMs,
      regulations,
      markets: DEMO_MARKETS.length,
      sources: DEMO_SOURCES.length,
      fetched: sum("fetched"),
      newRegulations: sum("newRegulations"),
    },
    series,
    markets: DEMO_MARKETS.map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    categories: [...categoryCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    countries,
    recentScans,
    sources: DEMO_SOURCES.map(([id, title, market], index) => ({
      id, title, market,
      status: DEMO_ERROR_SOURCES.has(id) ? "error" : "fetched",
      lastFetchedAt: DEMO_ERROR_SOURCES.has(id)
        ? new Date(now.getTime() - 5 * 86400000).toISOString()
        : new Date(now.getTime() - index * 3600000).toISOString(),
    })),
  };
}
