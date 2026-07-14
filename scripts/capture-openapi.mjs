#!/usr/bin/env node
/**
 * scripts/capture-openapi.mjs
 *
 * Pull /openapi.json from the running RAG service and pin it to
 * `lib/rag-client/openapi.snapshot.json`. This snapshot is what the
 * frontend uses to generate types and what CI diffs against.
 *
 * Usage:
 *   RAG_SERVICE_URL=http://localhost:8001 node scripts/capture-openapi.mjs
 *
 * Exits 1 if the RAG service is unreachable or returns non-JSON.
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || "http://localhost:8001";
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "lib", "rag-client", "openapi.snapshot.json");

const url = `${RAG_SERVICE_URL.replace(/\/$/, "")}/openapi.json`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`[capture-openapi] ${url} -> HTTP ${res.status}`);
  process.exit(1);
}

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch (e) {
  console.error(`[capture-openapi] non-JSON response from ${url}`);
  process.exit(1);
}

writeFileSync(target, JSON.stringify(json, null, 2) + "\n", "utf8");
const paths = Object.keys(json.paths || {}).sort().join(", ");
console.log(`[capture-openapi] wrote ${target} (${paths})`);
