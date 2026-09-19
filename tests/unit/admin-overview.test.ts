/**
 * lib/admin/overview.ts — 运营看板聚合管线的夹具测试。
 *
 * getAdminOverview 是 /admin 全部数字的唯一来源：扫描计数（按 sessionId
 * 去重的 scan_started）、终态（completed/failed 按结束日归档）、平均耗时、
 * 法规存量去重、watchdog 逐轮记录合并、流量库读取。这些口径写错一行，
 * 看板就"看起来正常但数字是错的"，所以用一份完整夹具把口径钉死。
 */
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const SCRATCH = path.resolve(__dirname, "..", "..", "tmp");
const beijingDay = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

let root: string;
let overview: typeof import("@/lib/admin/overview");

beforeAll(async () => {
  mkdirSync(SCRATCH, { recursive: true });
  root = mkdtempSync(path.join(SCRATCH, "admin-overview-"));
  const now = Date.now();
  const dayAt = (offsetDays: number) => new Date(now - offsetDays * 86400000);
  const iso = (offsetDays: number) => dayAt(offsetDays).toISOString();
  const dayKey = (offsetDays: number) => beijingDay(dayAt(offsetDays));

  // 法规索引：重复 id 必须去重（3 条唯一）。
  mkdirSync(path.join(root, "data/regulations"), { recursive: true });
  writeFileSync(path.join(root, "data/regulations/regulations_index.json"), JSON.stringify({
    regulations: [
      { id: "CN-CCC", region: "CN" },
      { id: "CN-CCC", region: "CN" },
      { id: "EU-LVD", region: "EU" },
      { id: "US-CPSC", region: "US" },
    ],
  }));

  mkdirSync(path.join(root, "data/regulation_sources"), { recursive: true });
  writeFileSync(path.join(root, "data/regulation_sources/official_sources.json"), JSON.stringify([
    { id: "src-a", title: "Source A", market: "CN" },
    { id: "src-b", title: "Source B", market: "EU" },
  ]));

  // watchdog 逐轮记录：created/updated 按 id 去重，records 携带 filename。
  mkdirSync(path.join(root, "data/regulation_supplements"), { recursive: true });
  const run = {
    schemaVersion: 1, runId: "run-1", startedAt: iso(1), finishedAt: iso(1),
    date: dayKey(1), timezone: "Asia/Shanghai", outputDate: dayKey(1), autoIngest: true,
    sourcesChecked: 2, sourcesFetched: 1, sourcesNotModified: 0, sourcesFailed: 0, sourcesSkipped: 0,
    created: ["CN-NEW"], updated: ["EU-CHG"], marked: [], evidenceOnly: [],
    records: [{ sourceId: "src-a", contentHash: "h1", filename: "raw.html" }],
    errors: [],
  };
  writeFileSync(path.join(root, "data/regulation_supplements/watchdog-runs.jsonl"), JSON.stringify(run) + "\n");

  // 扫描审计：runtime 目录走 ATTRAX_RUNTIME_DIR 覆盖。
  const runtime = path.join(root, "data/backend-rt");
  mkdirSync(runtime, { recursive: true });
  const audit = [
    { timestamp: iso(2), event: "scan_started", sessionId: "scan_aaa", jobId: "job_a", category: "electronics", fileCount: 1 },
    { timestamp: iso(2), event: "scan_completed", sessionId: "scan_aaa", jobId: "job_a", status: "ready", latencyMs: 30000 },
    { timestamp: iso(1), event: "scan_started", sessionId: "scan_bbb", jobId: "job_b", category: "toy", fileCount: 1 },
    // 同一 session 的重复 scan_started（幂等重试标记）不得重复计数。
    { timestamp: iso(1), event: "scan_started", sessionId: "scan_bbb", jobId: "job_b2", category: "toy", fileCount: 1 },
    { timestamp: iso(1), event: "scan_failed", sessionId: "scan_bbb", jobId: "job_b", status: "failed" },
    // 无时间戳的历史事件：保留但不进日期曲线，并出现在说明里。
    { event: "scan_started", sessionId: "scan_ccc", jobId: "job_c", category: "home" },
    // 非扫描事件不进入统计。
    { timestamp: iso(1), event: "session_created", sessionId: "scan_bbb" },
  ];
  writeFileSync(path.join(runtime, "audit.jsonl"), audit.map(row => JSON.stringify(row)).join("\n") + "\n");

  // 流量库：结构必须与 lib/admin/store.ts 的建表一致。
  mkdirSync(path.join(root, "data/admin"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "data/admin/analytics.sqlite"));
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS traffic (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, day TEXT NOT NULL, visitor TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL);`);
  const visitor = "hash-visitor-1";
  const insert = db.prepare("INSERT INTO traffic(timestamp, day, visitor, kind, path) VALUES (?, ?, ?, ?, ?)");
  insert.run(iso(1), dayKey(1), visitor, "page", "/");
  insert.run(iso(1), dayKey(1), visitor, "page", "/upload");
  insert.run(iso(1), dayKey(1), "hash-visitor-2", "page", "/");
  insert.run(iso(0), dayKey(0), "hash-visitor-3", "api", "/api/scan/:session");
  db.prepare("INSERT INTO meta(key, value) VALUES ('traffic_since', ?)").run(iso(6));
  db.close();

  vi.stubEnv("ATTRAX_PROJECT_ROOT", root);
  vi.stubEnv("ATTRAX_RUNTIME_DIR", runtime);
  // regulationsProjectRoot 在首次调用后缓存，必须先 stub 再加载模块。
  vi.resetModules();
  overview = await import("@/lib/admin/overview");
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("getAdminOverview 聚合口径", () => {
  it("按 sessionId 去重扫描、按结束日归档终态并计算平均耗时", async () => {
    const result = await overview.getAdminOverview(7);
    const scansByDay = result.series.map(day => day.scans ?? 0);
    expect(scansByDay.reduce((a, b) => a + b, 0)).toBe(2);
    expect(result.totals.scans).toBe(2);
    expect(result.totals.completed).toBe(1);
    expect(result.totals.failed).toBe(1);
    expect(result.totals.averageLatencyMs).toBe(30000);
    expect(result.recentScans.length).toBe(2);
    const failed = result.recentScans.find(scan => scan.id === "scan_bbb");
    expect(failed?.status).toBe("failed");
    const ready = result.recentScans.find(scan => scan.id === "scan_aaa");
    expect(ready?.status).toBe("ready");
    expect(ready?.category).toBe("electronics");
  });

  it("无时间戳的历史审计保留并进入覆盖说明", async () => {
    const result = await overview.getAdminOverview(7);
    expect(result.coverage.notes.some(note => note.includes("1 条历史审计没有时间"))).toBe(true);
  });

  it("法规存量去重、市场分布与来源状态来自逐轮记录", async () => {
    const result = await overview.getAdminOverview(7);
    expect(result.totals.regulations).toBe(3);
    expect(result.markets.map(row => row.name).sort()).toEqual(["CN", "EU", "US"]);
    expect(result.totals.sources).toBe(result.sources.length);
    const sourceA = result.sources.find(source => source.id === "src-a");
    expect(sourceA?.status).toBe("fetched");
    expect(sourceA?.lastFetchedAt).not.toBeNull();
    expect(result.sources.find(source => source.id === "src-b")?.status).toBe("unknown");
  });

  it("逐轮记录驱动每日新增/更新/抓取曲线", async () => {
    const result = await overview.getAdminOverview(7);
    const yesterday = result.series.find(day => day.newRegulations === 1);
    expect(yesterday).toBeDefined();
    expect(yesterday?.updatedRegulations).toBe(1);
    expect(yesterday?.fetched).toBe(1);
    expect(result.totals.newRegulations).toBe(1);
  });

  it("流量库汇总独立访客、页面访问与 API 调用", async () => {
    const result = await overview.getAdminOverview(7);
    expect(result.totals.visitors).toBe(2);
    expect(result.totals.pageViews).toBe(3);
    expect(result.totals.apiCalls).toBe(1);
    expect(result.coverage.trafficSince).not.toBeNull();
  });

  it("扫描品类分布来自所选期间的提交事件", async () => {
    const result = await overview.getAdminOverview(7);
    expect(result.categories).toEqual([{ name: "electronics", count: 1 }, { name: "toy", count: 1 }]);
  });

  it("只接受 7/30/90 天", async () => {
    await expect(overview.getAdminOverview(14)).rejects.toThrow("统计范围");
  });
});
