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
// (`npm run dev` from the repo root) working as before.
//
// Cache the resolved root in a module-level `let`. The cache is intentionally
// isolated in a function whose ONLY side effect is the assignment, to keep
// the optimizer from folding the dead store away (Turbopack proved eager
// to inline `regulationsProjectRoot()` and treat the cache write as
// redundant with the return value).

import { statSync } from "node:fs";
import path from "node:path";

function existsAndIsReadable(candidate: string): boolean {
  try {
    statSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function cwdIsStandaloneBuild(cwd: string): boolean {
  // Next.js standalone build ships `server.js` at the cwd root. Local dev
  // (`next dev` from the repo root) does not. Reliable enough — no other
  // file in the repo root is named `server.js`.
  return existsAndIsReadable(path.join(cwd, "server.js"));
}

function resolveOnce(): string {
  // 1. Explicit override (preferred for production).
  const override = process.env.ATTRAX_PROJECT_ROOT;
  if (override && existsAndIsReadable(override)) {
    return override;
  }

  const cwd = path.resolve(process.cwd());

  // 2. Standalone build — the project root is two levels up.
  if (cwdIsStandaloneBuild(cwd)) {
    const sibling = path.dirname(path.dirname(cwd));
    if (sibling && existsAndIsReadable(sibling)) {
      return sibling;
    }
  }

  // 3. Cwd is the project root (local dev: `npm run dev` from the repo root).
  return cwd;
}

let cachedRoot: string | null = null;

export function regulationsProjectRoot(): string {
  if (cachedRoot !== null) {
    return cachedRoot;
  }
  const resolved = resolveOnce();
  cachedRoot = resolved;
  return resolved;
}
