// AUTO-GENERATED from ports.env by scripts/sync-ports.js — do not hand-edit.
// Run `node scripts/sync-ports.js` after changing ports.env.

"use strict";

const fs = require("fs");
const path = require("path");

function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) {
    throw new Error(`ports.env missing: ${file}`);
  }
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    out[key] = val;
  }
  return out;
}

const env = loadEnvFile(path.join(__dirname, "ports.env"));

function requiredInt(name) {
  const v = env[name];
  if (!v || !/^\d+$/.test(v)) {
    throw new Error(`ports.env: ${name} missing or not integer (got "${v}")`);
  }
  const n = parseInt(v, 10);
  if (n < 1 || n > 65535) {
    throw new Error(`ports.env: ${name}=${n} out of range`);
  }
  return n;
}

module.exports = {
  NEXTJS_PORT: requiredInt("NEXTJS_PORT"),
  RAG_PORT: requiredInt("RAG_PORT"),
  PORTFOLIO_PORT: requiredInt("PORTFOLIO_PORT"),
  raw: env,
};
