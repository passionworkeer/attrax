#!/usr/bin/env node
/**
 * scripts/check-rag-openapi-drift.mjs
 *
 * Keeps `lib/rag-client/openapi.snapshot.json` honest.
 *
 * Why this exists: the snapshot used to be captured from a *running* service
 * by scripts/capture-openapi.mjs, and CI's only contract gate was
 * `codegen:rag-types && git diff --exit-code types.gen.ts` — which only proves
 * types.gen.ts matches the snapshot. Nothing ever compared the snapshot
 * against the real FastAPI app, so it silently fell behind: the frontend has
 * been calling POST /api/v1/scans/{id}/evidence and /revisions, and reading
 * /api/v1/regulations/{doc_id}, while none of the three were in the snapshot.
 *
 * This script derives the document straight from the FastAPI app object, so it
 * needs no server, no port and no network. Import is side-effect free: Settings
 * has defaults for every field and the secret policy runs in the lifespan hook,
 * not at import time, so no RAG_INTERNAL_SECRET / DEMO_MODE is required.
 *
 * Gates on the *route inventory* (path -> sorted methods) rather than the whole
 * document, because field-level FastAPI/pydantic detail churns for reasons that
 * are not contract changes. Schema internals are covered by the separate
 * `npm run check:rag-contract` step, which diffs generated types.gen.ts.
 *
 * Usage:
 *   node scripts/check-rag-openapi-drift.mjs --check   # CI gate; exit 1 on drift
 *   node scripts/check-rag-openapi-drift.mjs --write   # refresh the snapshot
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const SNAPSHOT = join(ROOT, "lib", "rag-client", "openapi.snapshot.json");

const args = process.argv.slice(2);
const mode = args.includes("--write") ? "write" : "check";

/** Prefer a local venv that actually has the RAG deps, then fall back to PATH. */
function findPython() {
  const windows = process.platform === "win32";
  const candidates = [
    windows ? join(ROOT, ".runvenv", "Scripts", "python.exe") : join(ROOT, ".runvenv", "bin", "python"),
    windows ? join(ROOT, ".venv", "Scripts", "python.exe") : join(ROOT, ".venv", "bin", "python"),
    windows
      ? join(ROOT, "rag_service", ".venv", "Scripts", "python.exe")
      : join(ROOT, "rag_service", ".venv", "bin", "python"),
    "python3",
    "python",
  ];

  for (const candidate of candidates) {
    if ((candidate.includes("/") || candidate.includes("\\")) && !existsSync(candidate)) continue;
    try {
      execFileSync(candidate, ["-c", "import fastapi, rag_service.main"], {
        cwd: ROOT,
        stdio: "ignore",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      });
      return candidate;
    } catch {
      // Not this one — keep looking.
    }
  }
  return null;
}

const python = findPython();
if (!python) {
  console.error(
    "[openapi-drift] No Python interpreter with the RAG dependencies found.\n" +
      "  Install them first:  pip install -r rag_service/requirements-prod.txt\n" +
      "  Tried local .runvenv / .venv / rag_service/.venv, then python3 / python.",
  );
  process.exit(1);
}

let doc;
try {
  const raw = execFileSync(
    python,
    ["-B", "-c", "import json, rag_service.main as m; print(json.dumps(m.app.openapi(), ensure_ascii=False))"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  doc = JSON.parse(raw);
} catch (error) {
  console.error(`[openapi-drift] failed to derive the OpenAPI document from the FastAPI app:\n${error.message}`);
  process.exit(1);
}

/** path -> sorted method list, e.g. { "/api/v1/scans": ["post"] } */
function routeInventory(openapi) {
  const out = {};
  for (const [path, item] of Object.entries(openapi.paths || {})) {
    const methods = Object.keys(item)
      .filter((key) => ["get", "put", "post", "delete", "patch", "options", "head", "trace"].includes(key))
      .sort();
    out[path] = methods;
  }
  return out;
}

function schemaNames(openapi) {
  return Object.keys(openapi.components?.schemas || {}).sort();
}

const formatRoutes = (routes) =>
  Object.entries(routes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, methods]) => `    ${methods.map((m) => m.toUpperCase().padEnd(6)).join(" ")} ${path}`)
    .join("\n");

if (mode === "write") {
  writeFileSync(SNAPSHOT, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`[openapi-drift] wrote ${SNAPSHOT.replace(`${ROOT}/`, "")}`);
  console.log(formatRoutes(routeInventory(doc)));
  process.exit(0);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
const live = routeInventory(doc);
const pinned = routeInventory(snapshot);

const missing = Object.keys(live).filter((path) => {
  if (!(path in pinned)) return true;
  return live[path].join(",") !== pinned[path].join(",");
});
const extra = Object.keys(pinned).filter((path) => !(path in live));

// Informational only — schema internals are gated by `check:rag-contract`.
const liveSchemas = schemaNames(doc);
const pinnedSchemas = schemaNames(snapshot);
const addedSchemas = liveSchemas.filter((name) => !pinnedSchemas.includes(name));
const removedSchemas = pinnedSchemas.filter((name) => !liveSchemas.includes(name));

const problems = [];
if (missing.length) {
  problems.push(
    `routes present in rag_service but missing/stale in the snapshot:\n${formatRoutes(
      Object.fromEntries(missing.map((path) => [path, live[path]])),
    )}`,
  );
}
if (extra.length) {
  problems.push(
    `routes in the snapshot that no longer exist in rag_service:\n${formatRoutes(
      Object.fromEntries(extra.map((path) => [path, pinned[path]])),
    )}`,
  );
}

if (problems.length) {
  console.error(`[openapi-drift] FAIL — lib/rag-client/openapi.snapshot.json has drifted from the RAG service.\n`);
  for (const problem of problems) console.error(`${problem}\n`);
  if (addedSchemas.length) console.error(`  (also: schema(s) only in the app: ${addedSchemas.join(", ")})`);
  if (removedSchemas.length) console.error(`  (also: schema(s) only in the snapshot: ${removedSchemas.join(", ")})`);
  console.error(
    `\nFix: node scripts/check-rag-openapi-drift.mjs --write && npm run codegen:rag-types\n` +
      `     then commit the updated snapshot + types.gen.ts.`,
  );
  process.exit(1);
}

const routeCount = Object.keys(live).length;
const suffix =
  addedSchemas.length || removedSchemas.length
    ? ` (schema names differ but routes match: +${addedSchemas.length}/-${removedSchemas.length}; run --write to refresh)`
    : "";
console.log(`[openapi-drift] OK — snapshot matches the RAG service (${routeCount} routes)${suffix}`);
