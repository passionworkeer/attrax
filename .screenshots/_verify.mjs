import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;
const BASE_URL = process.env.ATTRAX_VERIFY_BASE_URL || "http://localhost:3000";

const targets = [
  { path: "/result/demo", name: "01-result-compliance.png" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

for (const t of targets) {
  try {
    await page.goto(`${BASE_URL}${t.path}`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT_DIR, t.name), fullPage: true });
    console.log(`OK ${t.path}`);
  } catch (e) {
    console.log(`FAIL ${t.path}: ${e.message.slice(0, 100)}`);
  }
}

await browser.close();