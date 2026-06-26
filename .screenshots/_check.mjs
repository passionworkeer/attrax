import { chromium } from "@playwright/test";

const targets = [
  { path: "/", name: "01-home.png" },
  { path: "/upload", name: "02-upload.png" },
  { path: "/burning/demo", name: "03-burning.png" },
  { path: "/regulations", name: "04-regulations.png" },
  { path: "/trace", name: "05-trace.png" },
  { path: "/roadmap", name: "06-roadmap.png" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

for (const t of targets) {
  try {
    await page.goto(`http://localhost:3001${t.path}`, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `E:/desktop/火鹰合规/.screenshots/${t.name}`, fullPage: false });
    console.log(`✓ ${t.path}`);
  } catch (e) {
    console.log(`✗ ${t.path}: ${e.message.slice(0, 80)}`);
  }
}

await browser.close();