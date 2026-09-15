import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;
const BASE_URL = process.env.ATTRAX_VERIFY_BASE_URL || "http://localhost:3000";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(`${BASE_URL}/result/demo`, { waitUntil: "networkidle", timeout: 20000 });
await page.waitForTimeout(800);

// Click profit tab
await page.getByRole("tab", { name: /成本利润/ }).click().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT_DIR, "04-result-profit.png"), fullPage: true });
console.log("OK profit");

// Click decision tab
await page.getByRole("tab", { name: /AI 决策/ }).click().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT_DIR, "05-result-decision.png"), fullPage: true });
console.log("OK decision");

// Click roadmap tab
await page.getByRole("tab", { name: /合规路线/ }).click().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT_DIR, "06-result-roadmap.png"), fullPage: true });
console.log("OK roadmap");

await browser.close();