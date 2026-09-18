#!/usr/bin/env node
// sync-ports.js — 把 ports.env 镜像成 ports.env.cjs（CommonJS 模块）。
//
// 为什么需要：ecosystem.config.cjs 是 Node CJS，要 require() 一个端口常量；
// 同时人编辑的源是 POSIX shell 友好的 ports.env。两份必须严格一致，否则
// nginx 和 ecosystem 会"一致地错"（同源漂移）。
//
// 行为：
//   读 ports.env 解析 KEY=VALUE → 生成 ports.env.cjs，里面只有数值导出
//   （NEXTJS_PORT / RAG_PORT / PORTFOLIO_PORT）+ raw 对象。
//   数值字段在 ports.env 里必须是整数；不通过则非零退出。
//
// 触发：
//   - 改 ports.env 后 `node scripts/sync-ports.js`
//   - preflight-deploy.mjs 自动调用
//   - package.json 的 prebuild hook 调用（防运行时才发现 ports.env.cjs 过期）
//
// 不引入依赖；Node 内置 fs 即可。

"use strict";

const fs = require("fs");
const path = require("path");

const here = __dirname;
const src = path.join(here, "ports.env");
const dst = path.join(here, "ports.env.cjs");

if (!fs.existsSync(src)) {
  console.error(`[sync-ports] ports.env not found: ${src}`);
  process.exit(1);
}

const out = {};
for (const raw of fs.readFileSync(src, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  const val = line.slice(eq + 1).trim();
  out[key] = val;
}

const intKeys = ["NEXTJS_PORT", "RAG_PORT", "PORTFOLIO_PORT"];
for (const k of intKeys) {
  if (!out[k] || !/^\d+$/.test(out[k])) {
    console.error(`[sync-ports] ports.env: ${k} missing or not integer (got "${out[k]}")`);
    process.exit(2);
  }
  const n = parseInt(out[k], 10);
  if (n < 1 || n > 65535) {
    console.error(`[sync-ports] ports.env: ${k}=${n} out of range`);
    process.exit(2);
  }
}

const rawJson = JSON.stringify(out, null, 2)
  .split("\n")
  .map((l) => "  " + l)
  .join("\n");

const body = `// AUTO-GENERATED from ports.env by scripts/sync-ports.js — do not hand-edit.
// Run \`node scripts/sync-ports.js\` after changing ports.env.

"use strict";

const fs = require("fs");
const path = require("path");

function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) {
    throw new Error(\`ports.env missing: \${file}\`);
  }
  for (const raw of fs.readFileSync(file, "utf8").split(/\\r?\\n/)) {
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
  if (!v || !/^\\d+$/.test(v)) {
    throw new Error(\`ports.env: \${name} missing or not integer (got "\${v}")\`);
  }
  const n = parseInt(v, 10);
  if (n < 1 || n > 65535) {
    throw new Error(\`ports.env: \${name}=\${n} out of range\`);
  }
  return n;
}

module.exports = {
  NEXTJS_PORT: requiredInt("NEXTJS_PORT"),
  RAG_PORT: requiredInt("RAG_PORT"),
  PORTFOLIO_PORT: requiredInt("PORTFOLIO_PORT"),
  raw: env,
};
`;

fs.writeFileSync(dst, body);
console.log(`[sync-ports] wrote ${dst}`);
