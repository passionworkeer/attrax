import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;
const BASE_URL = process.env.ATTRAX_VERIFY_BASE_URL || "http://localhost:3000";

const targets = [
  { path: "/", name: "01-home.png" },
  { path: "/upload", name: "02-upload.png" },
  { path: "/burning/demo", name: "03-burning.png" },
  { path: "/regulations", name: "04-regulations.png" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

for (const t of targets) {
  try {
    await page.goto(`${BASE_URL}${t.path}`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT_DIR, t.name), fullPage: false });
    console.log(`✓ ${t.path}`);
  } catch (e) {
    console.log(`✗ ${t.path}: ${e.message.slice(0, 80)}`);
  }
}

await browser.close();