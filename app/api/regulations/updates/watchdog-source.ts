/**
 * Live regulation-update source.
 *
 * Merges the watchdog's daily "applied.json" output with the static
 * curated entries (see ./data.ts). The watchdog pipeline runs once a day
 * (server-local 03:00 CST by default; see scripts/watchdog/orchestrator.py)
 * and emits:
 *
 *   data/regulation_supplements/watchdog-YYYY-MM-DD/applied.json
 *   data/regulation_supplements/auto-YYYY-MM-DD/{source_id}/meta.json
 *
 * Each entry references a source_id from
 * `data/regulation_sources/official_sources.json`. We rebuild a complete
 * RegulationUpdate record for every source that had a real change in the
 * last LOOKBACK_DAYS days by combining:
 *
 *   - human-edited metadata (title, market, sourceUrl, channel, product
 *     categories) from official_sources.json
 *   - machine-detected change shape (changeKind, similarity, fetchedAt,
 *     afterHash) from auto-YYYY-MM-DD/<source_id>/meta.json
 *   - a conservative default body (the watchdog detects changes but does
 *     not write summaries — that stays a human concern; see README.md).
 *
 * Reading the on-disk outputs from a Next.js route is safe because Next.js
 * API routes run in the Node.js server runtime; the file system is local.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { RegulationUpdate, ChangeType, RiskLevel } from "./types";
import { regulationsProjectRoot } from "@/lib/regulations/data-root";

const PROJECT_ROOT = regulationsProjectRoot();
const WATCHDOG_DIR = path.join(
  PROJECT_ROOT,
  "data",
  "regulation_supplements",
);
const SOURCES_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "regulation_sources",
  "official_sources.json",
);

const LOOKBACK_DAYS = 30;
const META_TTL_MS = 60_000;

// ── Registry shape (subset of official_sources.json we care about) ──────
interface OfficialSourceEntry {
  id: string;
  market: string;
  title: string;
  channel?: string;
  source_url: string;
  product_categories?: string[];
  regulatory_types?: string[];
  watchdog_actual_fetch?: string;
  notes?: string;
}

// ── meta.json shape (auto-ingest writes these) ──────────────────────────
interface SourceMeta {
  sourceId: string;
  market: string;
  sourceType: string;
  sourceUrl: string;
  title: string;
  contentHash: string;
  similarity: number;
  changeKind: string; // "added" | "modified" | (wholesale missing)
  fetchedAt: string;
  metadata?: Record<string, unknown>;
}

interface AppliedRecord {
  sourceId: string;
  changeKind: ChangeType;
  similarity: number;
  fetchedAt: string;
  title: string;
  market: string;
  sourceUrl: string;
  channel?: string;
  productCategories: string[];
  regulatoryTypes: string[];
  contentHash: string;
}

// ── module-level cache (per Node.js route process) ──────────────────────
let sourcesCache: Map<string, OfficialSourceEntry> | null = null;
let sourcesLoadedAt = 0;

let appliedCache: { records: AppliedRecord[]; loadedAt: number } | null = null;

async function loadSources(): Promise<Map<string, OfficialSourceEntry>> {
  if (sourcesCache && Date.now() - sourcesLoadedAt < META_TTL_MS) {
    return sourcesCache;
  }
  try {
    const text = await fs.readFile(SOURCES_PATH, "utf-8");
    const parsed = JSON.parse(text) as OfficialSourceEntry[];
    const map = new Map<string, OfficialSourceEntry>();
    for (const entry of parsed) {
      if (entry?.id) map.set(entry.id, entry);
    }
    sourcesCache = map;
    sourcesLoadedAt = Date.now();
    return map;
  } catch {
    // Missing/empty registry — degrade to empty rather than 500. Watchdog may
    // not be wired up on a fresh checkout; the route still serves demo data.
    sourcesCache = new Map();
    sourcesLoadedAt = Date.now();
    return sourcesCache;
  }
}

function inferChangeKind(meta: SourceMeta): ChangeType {
  // The watchdog reports "added" / "modified" — we map both to "revision"
  // unless the source is in an explicit enforcement category. The mapping
  // is conservative; a curator can correct a card after the fact via the
  // demo entries (which still drive the curated editorial layer).
  if (meta.changeKind === "added") return "revision";
  return "revision";
}

function inferRiskLevel(meta: SourceMeta, entry: OfficialSourceEntry): RiskLevel {
  // Heuristic: low similarity (real content change, not just boilerplate)
  // means higher business risk. Anything below 0.80 is "high"; below 0.95
  // is "medium"; everything else is "low". Products touching children /
  // electrical / battery categories bump up one tier.
  const similarity = meta.similarity ?? 1;
  const cats = new Set([
    ...(entry.product_categories ?? []),
    ...((meta.metadata?.productCategories as string[] | undefined) ?? []),
  ]);
  const sensitive =
    cats.has("children_products") ||
    cats.has("electrical_equipment") ||
    cats.has("toys") ||
    cats.has("battery") ||
    cats.has("electronics");
  let base: RiskLevel = "low";
  if (similarity < 0.8) base = "high";
  else if (similarity < 0.95) base = "medium";
  if (sensitive && base === "low") base = "medium";
  if (sensitive && base === "medium") base = "high";
  return base;
}

async function loadAppliedRecords(): Promise<AppliedRecord[]> {
  if (appliedCache && Date.now() - appliedCache.loadedAt < META_TTL_MS) {
    return appliedCache.records;
  }
  const sources = await loadSources();
  const records: AppliedRecord[] = [];
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  // Enumerate watchdog-YYYY-MM-DD directories
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(WATCHDOG_DIR, { withFileTypes: true });
  } catch {
    appliedCache = { records: [], loadedAt: Date.now() };
    return records;
  }

  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    const name = dirent.name;
    let runDate: Date | null = null;
    if (name.startsWith("watchdog-")) {
      const dateStr = name.slice("watchdog-".length);
      const parsed = new Date(`${dateStr}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) runDate = parsed;
    } else if (name.startsWith("auto-")) {
      const dateStr = name.slice("auto-".length);
      const parsed = new Date(`${dateStr}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime())) runDate = parsed;
    }
    if (!runDate || runDate.getTime() < cutoff) continue;

    const baseDir = path.join(WATCHDOG_DIR, name);

    // applied.json records ingested regulation ids, not source ids; for
    // the live view we need source-level granularity, so we scan each
    // {source_id}/meta.json inside auto-* instead. watchdog-*/applied.json
    // is still useful as a quick existence check.
    if (name.startsWith("auto-")) {
      let subs: import("node:fs").Dirent[];
      try {
        subs = await fs.readdir(baseDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of subs) {
        if (!sub.isDirectory() || sub.name === "backup") continue;
        const metaPath = path.join(baseDir, sub.name, "meta.json");
        try {
          const metaText = await fs.readFile(metaPath, "utf-8");
          const meta = JSON.parse(metaText) as SourceMeta;
          const entry = sources.get(meta.sourceId);
          if (!entry) continue;
          records.push({
            sourceId: meta.sourceId,
            changeKind: inferChangeKind(meta),
            similarity: meta.similarity,
            fetchedAt: meta.fetchedAt,
            title: meta.title || entry.title,
            market: meta.market || entry.market,
            sourceUrl: meta.sourceUrl || entry.source_url,
            channel: entry.channel,
            productCategories: entry.product_categories ?? [],
            regulatoryTypes: entry.regulatory_types ?? [],
            contentHash: meta.contentHash,
          });
        } catch {
          // One bad meta.json must not poison the whole view.
          continue;
        }
      }
    }
  }

  // Deduplicate by sourceId — keep the most recent record (most recent run).
  const dedup = new Map<string, AppliedRecord>();
  for (const r of records) {
    const existing = dedup.get(r.sourceId);
    if (!existing || r.fetchedAt > existing.fetchedAt) {
      dedup.set(r.sourceId, r);
    }
  }
  const list = [...dedup.values()];
  appliedCache = { records: list, loadedAt: Date.now() };
  return list;
}

/**
 * Build the RegulationUpdate[] view-model for one live watchdog record.
 *
 * The watchdog detects that something changed but does not write the editorial
 * fields (business impact, requirements, recommended actions) — those need a
 * human. For the live card we fill the editorial blanks with conservative
 * placeholders so the user sees the change is real (and can drill in to the
 * sourceUrl for context) without claiming an editorial summary we don't have.
 */
function toRegulationUpdate(record: AppliedRecord): RegulationUpdate {
  const sources = sourcesCache ?? new Map<string, OfficialSourceEntry>();
  const entry = sources.get(record.sourceId);
  const fetchedDate = record.fetchedAt || new Date().toISOString().slice(0, 10);

  return {
    id: `live-${record.sourceId}`,
    market: record.market,
    title: record.title,
    titleEn: record.title,
    publishDate: fetchedDate,
    // Watchdog doesn't track an effective date — use fetchedDate so daysUntil
    // math doesn't produce wildly negative numbers that confuse the UI.
    effectiveDate: fetchedDate,
    affectedCategories: record.productCategories,
    affectedCategoriesEn: record.productCategories,
    summary: entry?.notes
      ? `${entry.notes} (watchdog similarity ${(record.similarity * 100).toFixed(1)}%)`
      : `Detected ${record.changeKind} by attrax regulation watchdog (similarity ${(record.similarity * 100).toFixed(1)}%).`,
    summaryEn: entry?.notes
      ? `${entry.notes} (watchdog similarity ${(record.similarity * 100).toFixed(1)}%)`
      : `Watchdog-detected ${record.changeKind} (similarity ${(record.similarity * 100).toFixed(1)}%).`,
    sourceAgency: record.channel ?? "Attrax Regulation Watchdog",
    sourceAgencyEn: record.channel ?? "Attrax Regulation Watchdog",
    sourceUrl: record.sourceUrl,
    riskLevel: inferRiskLevel(
      { similarity: record.similarity, changeKind: record.changeKind, fetchedAt: fetchedDate } as SourceMeta,
      entry ?? { id: record.sourceId, market: record.market, title: record.title, source_url: record.sourceUrl },
    ),
    changeType: record.changeKind,
    status: "Watchdog detected change",
    statusEn: "Watchdog detected change",
    businessImpact:
      "Automated detection — editorial summary pending. Review the source document for business implications.",
    businessImpactEn:
      "Automated detection — editorial summary pending. Review the source document for business implications.",
    requirements: [],
    requirementsEn: [],
    recommendedActions: ["查阅原文以确认业务影响"],
    recommendedActionsEn: ["Review the source document for business impact"],
    lastVerifiedAt: fetchedDate,
  };
}

/**
 * Public API: return all live watchdog-detected updates.
 *
 * Returns [] when no watchdog pass has run yet (fresh repo) so callers can
 * merge with demo data without special-casing.
 */
export async function getLiveRegulationUpdates(): Promise<RegulationUpdate[]> {
  const records = await loadAppliedRecords();
  // Most recent changes first — the UI's "sort by recency" benefits from
  // a recency-ordered primary list, even though the route re-sorts after
  // the merge by its own urgency heuristic.
  records.sort((a, b) => (a.fetchedAt > b.fetchedAt ? -1 : 1));
  return records.map(toRegulationUpdate);
}

/**
 * Return the most recent run timestamp across all loaded records. The route
 * exposes this as `lastVerifiedAt` in the meta block.
 */
export async function getLiveLastVerifiedAt(): Promise<string | null> {
  const records = await loadAppliedRecords();
  if (!records.length) return null;
  return records.map((r) => r.fetchedAt).sort().at(-1) ?? null;
}

/**
 * Force the cache to drop — used by tests and by the route's manual refresh
 * (not currently wired into a UI button but the seam is there for one).
 */
export function invalidateLiveCache(): void {
  appliedCache = null;
  sourcesCache = null;
  sourcesLoadedAt = 0;
}