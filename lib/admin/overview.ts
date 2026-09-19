import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { createGunzip } from "node:zlib";
import { z } from "zod";
import { regulationsProjectRoot } from "@/lib/regulations/data-root";
import type { AdminDay, AdminOverview } from "./types";
import { adminDb } from "./store";

const object = z.record(z.string(), z.unknown());
type Row = z.infer<typeof object>;
const timezone = "Asia/Shanghai";
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
const text = (value: unknown): string => typeof value === "string" ? value : "";
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const dateKey = (timestamp: string): string => {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) throw new Error("统计记录包含无效时间");
  return dayFormatter.format(parsed);
};
const rows = (value: unknown): Row[] => z.array(object).parse(value);
const strings = (value: unknown): string[] => z.array(z.string()).parse(value ?? []);

async function optionalJson(file: string): Promise<unknown | null> {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`无法读取统计文件 ${path.basename(file)}`, { cause: error });
  }
}

async function directories(root: string): Promise<string[] | null> {
  try { return (await fs.readdir(root, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function distribution(values: Iterable<string>) {
  const counts = new Map<string, number>();
  for (const name of values) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

async function auditEvents(root: string, notes: string[]): Promise<Row[]> {
  let names: string[];
  try { names = await fs.readdir(root); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    notes.push("扫描运行目录不存在，扫描历史尚不可用。");
    return [];
  }
  const files = names.filter(name => /^audit\.jsonl(?:\.\d+)?(?:\.gz)?$/.test(name));
  if (!files.length) notes.push("没有找到扫描审计日志，扫描历史尚不可用。");
  const events: Row[] = [];
  for (const name of files) {
    const input = createReadStream(path.join(root, name));
    const stream = name.endsWith(".gz") ? input.pipe(createGunzip()) : input;
    // 压缩文件的源读取错误也必须传递到逐行读取器。
    if (stream !== input) input.on("error", error => stream.destroy(error));
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of reader) {
        lineNumber++;
        if (!line.trim()) continue;
        const row = object.parse(JSON.parse(line));
        if (text(row.timestamp)) dateKey(text(row.timestamp));
        if (text(row.event).startsWith("scan_") || text(row.event).startsWith("revision")) events.push(row);
      }
    } catch (error) {
      throw new Error(`扫描日志 ${name} 第 ${lineNumber} 行读取失败`, { cause: error });
    } finally { reader.close(); stream.destroy(); input.destroy(); }
  }
  return events.sort((a, b) => Date.parse(text(a.timestamp)) - Date.parse(text(b.timestamp)));
}

function retainAudit(events: Row[]): Row[] {
  const db = adminDb();
  db.exec("CREATE TABLE IF NOT EXISTS scan_audit (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, payload TEXT NOT NULL)");
  const insert = db.prepare("INSERT OR IGNORE INTO scan_audit (id, timestamp, payload) VALUES (?, ?, ?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const event of events) {
      // 仅保留统计字段，不将上传内容、访问令牌或用户提交事实复制到 BI。
      const retained = Object.fromEntries(["timestamp", "event", "sessionId", "jobId", "category", "status", "latencyMs"].filter(key => event[key] !== undefined).map(key => [key, event[key]]));
      const payload = JSON.stringify(retained);
      insert.run(createHash("sha256").update(payload).digest("hex"), text(event.timestamp), payload);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return db.prepare("SELECT payload FROM scan_audit ORDER BY timestamp").all().map(row => object.parse(JSON.parse(text(row.payload))));
}

async function watchdogRuns(root: string): Promise<Row[]> {
  const filename = path.join(root, "watchdog-runs.jsonl");
  try { await fs.access(filename); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const stream = createReadStream(filename);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const runs = new Map<string, Row>();
  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const run = object.parse(JSON.parse(line));
      if (!text(run.runId) || !text(run.finishedAt)) throw new Error("法规巡检记录缺少运行标识或完成时间");
      dateKey(text(run.finishedAt));
      runs.set(text(run.runId), run);
    }
  } catch (error) { throw new Error("法规逐轮审计读取失败", { cause: error }); }
  finally { reader.close(); stream.destroy(); }
  return [...runs.values()].sort((a, b) => Date.parse(text(a.finishedAt)) - Date.parse(text(b.finishedAt)));
}

function readTraffic(root: string, series: AdminDay[], notes: string[]) {
  const database = new DatabaseSync(path.join(root, "data/admin/analytics.sqlite"), { readOnly: true });
  try {
    const sinceRow = database.prepare("SELECT value FROM meta WHERE key = 'traffic_since'").get();
    const trafficSince = text(sinceRow?.value) || null;
    if (!trafficSince) {
      notes.push("流量采集尚未建立覆盖起点，访客和请求历史不可用。");
      return { trafficSince, visitors: 0, pageViews: 0, apiCalls: 0 };
    }
    const sinceDay = dateKey(trafficSince);
    const daily = database.prepare("SELECT day, COUNT(DISTINCT CASE WHEN kind = 'page' AND visitor <> '' THEN visitor END) visitors, SUM(kind = 'page') pageViews, SUM(kind = 'api') apiCalls FROM traffic WHERE day >= ? AND day <= ? GROUP BY day").all(series[0].date, series.at(-1)!.date);
    for (const day of series) {
      if (day.date < sinceDay) continue;
      const row = daily.find(item => item.day === day.date);
      day.visitors = Number(row?.visitors ?? 0);
      day.pageViews = Number(row?.pageViews ?? 0);
      day.apiCalls = Number(row?.apiCalls ?? 0);
    }
    const totals = database.prepare("SELECT COUNT(DISTINCT CASE WHEN kind = 'page' AND visitor <> '' THEN visitor END) visitors, SUM(kind = 'page') pageViews, SUM(kind = 'api') apiCalls FROM traffic WHERE day >= ? AND day <= ?").get(series[0].date, series.at(-1)!.date);
    notes.push("独立访客按页面访问的匿名浏览器标识去重；清除 Cookie 或更换浏览器会重新计数，历史账户人数不可回填。API 次数包含轮询和错误请求尝试，排除管理员、健康检查和静态资源。采集首日和今日为部分日期。");
    return { trafficSince, visitors: Number(totals?.visitors ?? 0), pageViews: Number(totals?.pageViews ?? 0), apiCalls: Number(totals?.apiCalls ?? 0) };
  } finally { database.close(); }
}

const overviewCache = new Map<number, { expires: number; value: AdminOverview }>();
let snapshot: { expires: number; events: Row[]; notes: string[] } | null = null;

export async function getAdminOverview(days: number): Promise<AdminOverview> {
  if (![7, 30, 90].includes(days)) throw new Error("统计范围仅支持 7、30、90 天");
  const cached = overviewCache.get(days);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = await buildOverview(days);
  overviewCache.set(days, { expires: Date.now() + 30_000, value });
  return value;
}

async function buildOverview(days: number): Promise<AdminOverview> {
  if (![7, 30, 90].includes(days)) throw new Error("统计范围仅支持 7、30、90 天");
  const root = regulationsProjectRoot();
  const now = new Date();
  const today = dateKey(now.toISOString());
  const notes: string[] = [];
  const series: AdminDay[] = Array.from({ length: days }, (_, index) => ({
    date: new Date(Date.parse(`${today}T00:00:00Z`) - (days - index - 1) * 86400000).toISOString().slice(0, 10),
    visitors: null, pageViews: null, apiCalls: null, scans: 0, completed: 0, failed: 0, fetched: null, newRegulations: null, updatedRegulations: null,
  }));
  const byDay = new Map(series.map(day => [day.date, day]));
  const runtime = process.env.ATTRAX_RUNTIME_DIR || path.join(root, "data/backend");
  if (!snapshot || snapshot.expires <= Date.now()) {
    const auditNotes: string[] = [];
    const retained = retainAudit(await auditEvents(runtime, auditNotes));
    snapshot = { expires: Date.now() + 30_000, events: retained, notes: auditNotes };
  }
  const retainedEvents = snapshot.events;
  notes.push(...snapshot.notes);
  const events = retainedEvents.filter(event => text(event.timestamp));
  const undated = retainedEvents.length - events.length;
  if (undated) notes.push(`${undated} 条历史审计没有时间，已持久保留，但无法归入日期曲线和所选期间汇总。`);
  const starts = new Map<string, Row>();
  const terminals = new Map<string, Row>();
  const sessionTerminals = new Map<string, Row>();
  for (const event of events) {
    const id = text(event.sessionId);
    if (!id) continue;
    if (event.event === "scan_started" && !starts.has(id)) starts.set(id, event);
    if (event.event === "scan_completed" || event.event === "scan_failed") {
      terminals.set(text(event.jobId) || id, event);
      sessionTerminals.set(id, event);
    }
  }
  const selectedStarts = [...starts.values()].filter(event => byDay.has(dateKey(text(event.timestamp))));
  for (const event of selectedStarts) {
    const day = byDay.get(dateKey(text(event.timestamp)))!;
    day.scans = (day.scans ?? 0) + 1;
  }
  const latencies: number[] = [];
  for (const event of terminals.values()) {
    const day = byDay.get(dateKey(text(event.timestamp)));
    if (!day) continue;
    if (event.event === "scan_completed") {
      day.completed = (day.completed ?? 0) + 1;
      const latency = finite(event.latencyMs);
      if (latency !== null) latencies.push(latency);
    } else day.failed = (day.failed ?? 0) + 1;
  }
  const scansSince = events.length ? text(events[0].timestamp) : null;
  for (const day of series) {
    if (!scansSince || day.date < dateKey(scansSince)) day.scans = day.completed = day.failed = null;
  }
  notes.push("扫描数按首次提交的会话去重；完成与失败按任务终态去重并归入结束日期，包含重新审查任务。完成数包含降级结果；缺少终态的会话显示未知。可读取的历史审计已导入持久统计库，日志轮转后继续保留；首次导入前已丢失的日志无法回填。审计日志不等于所有 API 调用。");
  const index = await optionalJson(path.join(root, "data/regulations/regulations_index.json"));
  const regulations = index === null ? [] : rows(object.parse(index).regulations);
  if (index === null) notes.push("法规索引缺失，法规存量尚不可用。");
  const uniqueRegulations = [...new Map(regulations.map(row => [text(row.id), row])).values()];
  const registry = await optionalJson(path.join(root, "data/regulation_sources/official_sources.json"));
  const sources: AdminOverview["sources"] = (registry === null ? [] : rows(registry)).map(row => ({ id: text(row.id), title: text(row.title), market: text(row.market), status: "unknown", lastFetchedAt: null }));
  if (registry === null) notes.push("官方来源目录缺失，来源覆盖尚不可用。");
  const supplementRoot = path.join(root, "data/regulation_supplements");
  const folders = await directories(supplementRoot);
  if (!folders) notes.push("法规采集历史目录不存在。");
  const runs = await watchdogRuns(supplementRoot);
  const evidence = new Map<string, { date: string; sourceId: string }>();
  const sourceObservations = new Map<string, { date: string; status: string }>();
  const observedDays = new Set<string>();
  const created = new Map<string, Set<string>>();
  const updated = new Map<string, Set<string>>();
  const rememberSource = (id: string, date: string, status: string) => {
    const previous = sourceObservations.get(id);
    if (!previous || date > previous.date || (date === previous.date && status === "error")) sourceObservations.set(id, { date, status });
  };
  for (const folder of folders ?? []) {
    if (!/^(?:auto|watchdog)-\d{4}-\d{2}-\d{2}$/.test(folder)) continue;
    const date = folder.slice(folder.indexOf("-") + 1);
    const directory = path.join(supplementRoot, folder);
    if (folder.startsWith("auto-")) {
      for (const source of await directories(directory) ?? []) {
        if (source === "backup") continue;
        const payload = await optionalJson(path.join(directory, source, "meta.json"));
        if (payload === null) continue;
        const meta = object.parse(payload);
        const sourceId = text(meta.sourceId);
        const hash = text(meta.contentHash);
        if (!sourceId || !hash) throw new Error(`法规采集证据 ${folder}/${source} 缺少来源或内容摘要`);
        observedDays.add(date);
        const key = `${sourceId}:${hash}`;
        if (!evidence.has(key) || date < evidence.get(key)!.date) evidence.set(key, { date, sourceId });
        rememberSource(sourceId, date, "fetched");
        const item = sources.find(item => item.id === sourceId);
        if (item && (!item.lastFetchedAt || date > item.lastFetchedAt)) item.lastFetchedAt = date;
      }
      continue;
    }
    const applied = await optionalJson(path.join(directory, "applied.json"));
    const diff = await optionalJson(path.join(directory, "diff.json"));
    const errors = await optionalJson(path.join(directory, "errors.json"));
    const noChange = await optionalJson(path.join(directory, "no_change.json"));
    if ([applied, diff, errors, noChange].some(value => value !== null)) observedDays.add(date);
    if (applied !== null) {
      const report = object.parse(applied);
      created.set(date, new Set(strings(report.created)));
      updated.set(date, new Set(strings(report.updated)));
      for (const record of rows(report.records ?? [])) {
        const id = text(record.sourceId);
        if (id) {
          rememberSource(id, date, "fetched");
          const hash = text(record.contentHash);
          const key = `${id}:${hash}`;
          if (hash && (!evidence.has(key) || date < evidence.get(key)!.date)) evidence.set(key, { date, sourceId: id });
          const item = sources.find(item => item.id === id);
          if (item && (!item.lastFetchedAt || date > item.lastFetchedAt)) item.lastFetchedAt = date;
        }
      }
    }
    if (diff !== null) for (const change of rows(object.parse(diff).changes)) {
      if (text(change.sourceId)) {
        rememberSource(text(change.sourceId), date, "fetched");
        const item = sources.find(item => item.id === change.sourceId);
        if (item && (!item.lastFetchedAt || date > item.lastFetchedAt)) item.lastFetchedAt = date;
      }
    }
    if (errors !== null) for (const error of rows(errors)) {
      if (text(error.sourceId)) rememberSource(text(error.sourceId), date, "error");
    }
  }
  for (const date of observedDays) {
    const day = byDay.get(date);
    if (!day) continue;
    day.fetched = [...evidence.values()].filter(value => value.date === date).length;
    day.newRegulations = created.get(date)?.size ?? null;
    day.updatedRegulations = updated.get(date)?.size ?? null;
  }
  for (const source of sources) {
    const observation = sourceObservations.get(source.id);
    if (observation) source.status = observation.status;
  }
  const runEvidence = new Set<string>();
  const runCreated = new Map<string, Set<string>>();
  const runUpdated = new Map<string, Set<string>>();
  const runDays = new Set<string>();
  for (const run of runs) {
    const date = text(run.date) || dateKey(text(run.startedAt));
    const day = byDay.get(date);
    if (day && !runDays.has(date)) {
      day.fetched ??= 0;
      day.newRegulations ??= 0;
      day.updatedRegulations ??= 0;
    }
    runDays.add(date);
    const createdToday = runCreated.get(date) ?? new Set<string>(created.get(date));
    const updatedToday = runUpdated.get(date) ?? new Set<string>(updated.get(date));
    for (const id of strings(run.created)) createdToday.add(id);
    for (const id of strings(run.updated)) updatedToday.add(id);
    runCreated.set(date, createdToday);
    runUpdated.set(date, updatedToday);
    if (day) {
      day.newRegulations = createdToday.size;
      day.updatedRegulations = updatedToday.size;
    }
    for (const record of rows(run.records ?? [])) {
      const id = text(record.sourceId);
      const hash = text(record.contentHash);
      const filename = text(record.filename);
      if (!id || !hash || !filename) throw new Error("法规巡检证据记录缺少来源、内容摘要或文件名");
      const key = `${id}:${hash}:${filename}`;
      const legacyKey = `${id}:${hash}`;
      if (!runEvidence.has(key) && !evidence.has(legacyKey) && day) day.fetched = (day.fetched ?? 0) + 1;
      runEvidence.add(key);
      const source = sources.find(source => source.id === id);
      if (source) { source.status = "fetched"; source.lastFetchedAt = text(run.finishedAt); }
    }
    for (const error of rows(run.errors ?? [])) {
      const source = sources.find(source => source.id === text(error.sourceId));
      if (source) source.status = "error";
    }
  }
  notes.push("逐轮法规审计按北京时间统计，与历史快照合并去重。旧记录使用保留的 UTC 日期快照。抓取文件按来源、内容摘要和文件名跨日去重，表示留存的新版本证据；新增法规按每日入库法规 ID 去重。旧快照可能被重复运行覆盖，缺失日期显示空值，其计数为留存记录下限。来源状态是最近留存证据，不表示实时可用。");
  let traffic = { trafficSince: null as string | null, visitors: 0, pageViews: 0, apiCalls: 0 };
  try { await fs.access(path.join(root, "data/admin/analytics.sqlite")); traffic = readTraffic(root, series, notes); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("流量统计数据库读取失败", { cause: error });
    notes.push("流量统计数据库尚未建立，访客和请求历史不可用。");
  }
  const markets = distribution(uniqueRegulations.map(row => text(row.region) || "未知"));
  const sum = (key: keyof AdminDay) => series.reduce((total, day) => total + Number(day[key] ?? 0), 0);
  return {
    generatedAt: now.toISOString(), timezone, days,
    coverage: { trafficSince: traffic.trafficSince, scansSince, notes },
    totals: { visitors: traffic.visitors, pageViews: traffic.pageViews, apiCalls: traffic.apiCalls, scans: sum("scans"), completed: sum("completed"), failed: sum("failed"), averageLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null, regulations: uniqueRegulations.length, markets: markets.length, sources: sources.length, fetched: sum("fetched"), newRegulations: sum("newRegulations") },
    series, markets, categories: distribution(selectedStarts.map(row => text(row.category) || "未知")),
    // 国家维度待接入流量解析；上线「真实数据」视图时再实现。
    countries: [],
    recentScans: selectedStarts.slice(-12).reverse().map(row => {
      const terminal = sessionTerminals.get(text(row.sessionId));
      return { id: text(row.sessionId), timestamp: text(row.timestamp), category: text(row.category) || "未知", status: terminal ? terminal.event === "scan_failed" ? "failed" : text(terminal.status) || "unknown" : "unknown", latencyMs: finite(terminal?.latencyMs) };
    }), sources,
  };
}
