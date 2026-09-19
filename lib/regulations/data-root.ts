// Resolve the canonical data root for the live deployment.
//
// The Next.js standalone build runs with `cwd = /opt/attrax/.next/standalone`
// (per scripts/ecosystem.config.cjs), so a naive `path.join(process.cwd(),
// "data", ...)` resolves to a build-time snapshot inside the standalone tree.
// That snapshot is correct for static files (regulations_index.json,
// official_sources.json — they are committed and copied by the build), but it
// is STALE for the watchdog's live outputs (auto-YYYY-MM-DD/{source}/meta.json)
// because the watchdog orchestrator writes to /opt/attrax/data, not the
// standalone dir.
//
// The fix: prefer the env override `ATTRAX_REGULATIONS_DATA_ROOT`; otherwise
// probe the cwd-based path, then a sibling-of-standalone layout (the typical
// server layout is `/opt/attrax/.next/standalone` with the live data at
// `/opt/attrax/data`). Falling back to the cwd-based path keeps local dev
// (`pnpm dev` from the repo root) working as before.
//
// Cache the resolved root for the lifetime of the process; the value does
// not change at runtime.

import fs from "node:fs";
import path from "node:path";

function existsAndIsReadable(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function candidateFromCwd(): string {
  return path.resolve(process.cwd(), "data");
}

function candidateFromStandaloneSibling(): string | null {
  // Standalone layout: /opt/attrax/.next/standalone/{server.js, data/}
  // Live data:    /opt/attrax/data
  // Walk up two levels only if the cwd name is exactly "standalone".
  const cwd = path.resolve(process.cwd());
  const parent = path.dirname(cwd);
  const grandParent = path.dirname(parent);
  if (path.basename(cwd) !== "standalone") return null;
  const liveData = path.join(grandParent, "data");
  return liveData;
}

let resolvedRoot: string | null = null;

export function regulationsDataRoot(): string {
  if (resolvedRoot) return resolvedRoot;

  // 1. Explicit override (preferred for production).
  const override = process.env.ATTRAX_REGULATIONS_DATA_ROOT;
  if (override && existsAndIsReadable(override)) {
    resolvedRoot = override;
    return resolvedRoot;
  }

  // 2. Cwd-based path (local dev + the build-time snapshot on production).
  const cwdCandidate = candidateFromCwd();
  if (existsAndIsReadable(cwdCandidate)) {
    resolvedRoot = cwdCandidate;
    return resolvedRoot;
  }

  // 3. Live data sitting next to the standalone directory.
  const siblingCandidate = candidateFromStandaloneSibling();
  if (siblingCandidate && existsAndIsReadable(siblingCandidate)) {
    resolvedRoot = siblingCandidate;
    return resolvedRoot;
  }

  // 4. Last resort: stick with the cwd-based path so file-not-found errors
  // surface in the same way they would without this helper.
  resolvedRoot = cwdCandidate;
  return resolvedRoot;
}
