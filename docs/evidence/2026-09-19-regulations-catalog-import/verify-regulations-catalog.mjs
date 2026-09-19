// 2026-09-19 attrax-docs 法规目录导入 — /regulations 页面的实测脚本。
//
// 先起服务（npm run dev -- -p 3001），再跑：
//   node docs/evidence/2026-09-19-regulations-catalog-import/verify-regulations-catalog.mjs
//
// 做的事：
//   1. 直接打三个 BFF 接口，断言条目数与区域数（档案 ≥124 / 21 区域、抓取源 37、动态 ≥42）
//   2. 从档案接口统计区域与领域分布，写 api-summary.json
//   3. 用 Playwright 打开 /regulations，逐个 tab 截图，并断言页面上的数字与接口一致
//
// BASE_URL 可用环境变量覆盖。

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const failures = [];
function check(label, condition, detail) {
  const status = condition ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

async function getJson(route) {
  const response = await fetch(`${BASE_URL}${route}`);
  if (!response.ok) throw new Error(`${route} -> HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.success) throw new Error(`${route} -> success=false`);
  return payload;
}

const archive = await getJson("/api/regulations/archive?limit=200");
const sources = await getJson("/api/regulations/sources?limit=200");
const updates = await getJson("/api/regulations/updates?limit=100");

check("档案条目数 >= 124", archive.meta.total >= 124, `total=${archive.meta.total}`);
check("档案覆盖区域数 >= 21", archive.meta.markets >= 21, `markets=${archive.meta.markets}`);
check("抓取源 37", sources.meta.total === 37, `total=${sources.meta.total}`);
check("近期动态 >= 42", updates.meta.matching >= 42, `matching=${updates.meta.matching}`);

const newRegions = ["VN", "ID", "MY", "TH", "SG", "GCC", "GLOBAL"];
for (const region of newRegions) {
  const count = archive.data.filter((entry) => entry.region === region).length;
  check(`新区域 ${region} 有条目`, count > 0, `${count} 条`);
}

const byRegion = {};
const byDomain = {};
for (const entry of archive.data) {
  byRegion[entry.region] = (byRegion[entry.region] ?? 0) + 1;
  if (entry.domain) byDomain[entry.domain] = (byDomain[entry.domain] ?? 0) + 1;
}
const updatesByMarket = {};
for (const entry of updates.data) {
  updatesByMarket[entry.market] = (updatesByMarket[entry.market] ?? 0) + 1;
}

const summary = {
  capturedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  archive: { total: archive.meta.total, markets: archive.meta.markets, withArticles: archive.meta.withArticles, byRegion, byDomain },
  sources: sources.meta,
  updates: { total: updates.meta.total, matching: updates.meta.matching, dataset: updates.meta.dataset, byMarket: updatesByMarket },
};
await fs.writeFile(path.join(HERE, "api-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf-8");
console.log(`写出 api-summary.json`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${BASE_URL}/regulations`, { waitUntil: "networkidle" });

const tabBadges = await page.locator("button", { hasText: "法规档案" }).first().innerText();
// 词边界匹配：includes("124") 会被 1240 这类数字蒙混过关。
check("页面档案 tab 徽标含 124", /\b124\b/.test(tabBadges), tabBadges.replace(/\n/g, " "));

await page.waitForSelector("article", { timeout: 15000 });
const cardCount = await page.locator("article").count();
check("档案列表渲染 >= 100 张卡片", cardCount >= 100, `${cardCount} 张`);
await page.screenshot({ path: path.join(HERE, "screenshot-archive.png"), fullPage: false });

await page.getByRole("button", { name: /^越南/ }).click();
await page.waitForTimeout(1200);
const vnCards = await page.locator("article").count();
const vnChips = await page.locator("article").first().innerText();
check("越南筛选出条目", vnCards > 0, `${vnCards} 张`);
check("卡片带领域标签", /数据保护|产品认证|反垄断|电商平台/.test(vnChips), vnChips.split("\n").slice(0, 5).join(" / "));

await page.getByRole("button", { name: /^近期动态/ }).click();
await page.waitForTimeout(1500);
const updateCards = await page.locator("article").count();
check("近期动态渲染 >= 42 张卡片", updateCards >= 42, `${updateCards} 张`);
// 断言卡片正文里出现越南，而不是断言"页面上有个叫越南的按钮"——后者连筛选按钮
// 一起数进去，卡片一条不渲染也会通过。
const vnUpdateCards = await page.locator("article", { hasText: "越南" }).count();
check("近期动态卡片含越南条目", vnUpdateCards > 0, `${vnUpdateCards} 张`);
await page.screenshot({ path: path.join(HERE, "screenshot-updates.png"), fullPage: false });

await page.getByRole("button", { name: /^抓取源/ }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(HERE, "screenshot-sources.png"), fullPage: false });

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} 项未通过：${failures.join("; ")}`);
  process.exit(1);
}
console.log("\n全部通过");
