// Resolve the canonical project root for the live deployment.
//
// The Next.js standalone build runs with `cwd = /opt/attrax/.next/standalone`
// (per scripts/ecosystem.config.cjs), so a naive `path.resolve(process.cwd())`
// resolves INSIDE the standalone tree, where the data dir holds a build-time
// snapshot. That snapshot is correct for static files (regulations_index.json,
// official_sources.json — they are committed and copied by the build), but it
// is STALE for the watchdog's live outputs (auto-YYYY-MM-DD/{source}/meta.json)
// because the watchdog orchestrator writes to /opt/attrax/data, not the
// standalone dir.
//
// The fix: prefer the env override `ATTRAX_PROJECT_ROOT`; otherwise probe
// the cwd-based path, then a sibling-of-standalone layout (the typical
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

function cwdIsRepoRoot(cwd: string): boolean {
  // Local dev: cwd is the project root, with `data/`, `app/`, etc. sitting
  // next to each other. Standalone: cwd is the standalone tree, with `data/`
  // as a build snapshot.
  return existsAndIsReadable(path.join(cwd, "app"));
}

function siblingOfStandalone(cwd: string): string | null {
  // Standalone layout: /opt/attrax/.next/standalone/{server.js, data/}
  // Project root:    /opt/attrax
  if (path.basename(cwd) !== "standalone") return null;
  return path.dirname(path.dirname(cwd));
}

let resolvedRoot: string | null = null;

export function regulationsProjectRoot(): string {
  if (resolvedRoot) return resolvedRoot;

  // 1. Explicit override (preferred for production).
  const override = process.env.ATTRAX_PROJECT_ROOT;
  if (override && existsAndIsReadable(override)) {
    resolvedRoot = override;
    return resolvedRoot;
  }

  const cwd = path.resolve(process.cwd());

  // 2. Cwd is the project root (local dev: `npm run dev` from the repo root).
  if (cwdIsRepoRoot(cwd)) {
    resolvedRoot = cwd;
    return resolvedRoot;
  }

  // 3. Standalone layout — the project root is two levels up.
  const sibling = siblingOfStandalone(cwd);
  if (sibling && cwdIsRepoRoot(sibling)) {
    resolvedRoot = sibling;
    return resolvedRoot;
  }

  // 4. Last resort: stick with the cwd-based path so file-not-found errors
  // surface in the same way they would without this helper.
  resolvedRoot = cwd;
  return resolvedRoot;
}
