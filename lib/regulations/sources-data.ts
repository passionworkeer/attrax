// Read the watchdog source registry.
//
// Source of truth: `data/regulation_sources/official_sources.json`. The
// watchdog orchestrator (see `scripts/watchdog/orchestrator.py`) fetches
// every entry on a daily cadence and writes change metadata to
// `data/regulation_supplements/auto-YYYY-MM-DD/{source_id}/meta.json`.
// The page surface reads this registry to show "what we track" and
// "how we get it" — the live `lastVerifiedAt` comes from the per-source
// meta.json files, but that requires a watchdog pass on this checkout
// (the public site doesn't have one yet). We keep the registry as the
// source of truth for the page and let the per-source health be
// derived from `human_view_status` + `fetch_status` until the first
// orchestrator pass lands.

import fs from "node:fs/promises";
import path from "node:path";
import type { SourceEntry, SourceHealth } from "./types";
import { regulationsProjectRoot } from "./data-root";

// `healthLabel` lives in `./health-label.ts` so client components can import
// it without pulling in the `node:fs` reader. Re-export it for server
// callers (the API route) to keep the public surface stable.
export { healthLabel } from "./health-label";

const PROJECT_ROOT = regulationsProjectRoot();
const SOURCES_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "regulation_sources",
  "official_sources.json",
);

interface RawSourceRow {
  id: string;
  authority_tier?: string;
  regulation_id?: string | null;
  market: string;
  title: string;
  channel?: string;
  source_type?: string;
  source_url: string;
  celex?: string;
  human_view_url?: string;
  human_view_status?: string;
  watchdog_actual_fetch?: string;
  notes?: string;
  files?: string[];
  product_categories?: string[];
  regulatory_types?: string[];
  why_added?: string;
  fetch_status?: string;
  ecfr_title?: number;
  ecfr_part?: number;
  sort?: number;
}

function classifyHealth(row: RawSourceRow): SourceHealth {
  const human = (row.human_view_status ?? "").toLowerCase();
  const fetch = (row.fetch_status ?? "").toLowerCase();
  if (human === "ok" && fetch !== "unreachable" && fetch !== "shell_only") return "ok";
  if (human === "anti_bot" || fetch === "anti_bot") return "anti_bot";
  if (human === "waf_challenge_temporary" || fetch === "waf_challenge_temporary") return "waf_challenge_temporary";
  if (fetch === "unreachable" || fetch === "shell_only") return "unreachable";
  if (human && human !== "ok") return "unknown";
  return "unknown";
}

function normaliseRow(raw: RawSourceRow): SourceEntry {
  return {
    id: raw.id,
    market: raw.market,
    title: raw.title,
    channel: raw.channel ?? "—",
    sourceType: raw.source_type ?? "unknown",
    sourceUrl: raw.source_url,
    humanViewUrl: raw.human_view_url ?? raw.source_url,
    humanViewStatus: classifyHealth(raw),
    watchdogActualFetch: raw.watchdog_actual_fetch ?? "—",
    productCategories: raw.product_categories ?? [],
    regulatoryTypes: raw.regulatory_types ?? [],
    notes: raw.notes ?? "",
    authorityTier: raw.authority_tier ?? "primary",
    regulationId: raw.regulation_id ?? null,
    fetchStatus: raw.fetch_status ?? null,
    ecfrTitle: typeof raw.ecfr_title === "number" ? raw.ecfr_title : null,
    ecfrPart: typeof raw.ecfr_part === "number" ? raw.ecfr_part : null,
    files: raw.files ?? [],
  };
}

let memo: { entries: SourceEntry[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function readSources(): Promise<{ entries: SourceEntry[] }> {
  if (memo && Date.now() - memo.loadedAt < CACHE_TTL_MS) {
    return { entries: memo.entries };
  }
  try {
    const text = await fs.readFile(SOURCES_PATH, "utf-8");
    const parsed = JSON.parse(text) as RawSourceRow[];
    const entries = parsed.map(normaliseRow);
    memo = { entries, loadedAt: Date.now() };
    return { entries };
  } catch {
    // Fresh checkout — degrade to empty.
    memo = { entries: [], loadedAt: Date.now() };
    return { entries: [] };
  }
}

export function searchSources(entries: SourceEntry[], needle: string): SourceEntry[] {
  if (!needle) return entries;
  const lower = needle.toLowerCase();
  return entries.filter(
    (entry) =>
      entry.id.toLowerCase().includes(lower) ||
      entry.market.toLowerCase().includes(lower) ||
      entry.title.toLowerCase().includes(lower) ||
      entry.channel.toLowerCase().includes(lower) ||
      entry.sourceType.toLowerCase().includes(lower) ||
      entry.notes.toLowerCase().includes(lower) ||
      entry.productCategories.some((c) => c.toLowerCase().includes(lower)) ||
      entry.regulatoryTypes.some((r) => r.toLowerCase().includes(lower)),
  );
}
