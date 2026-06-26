import { chromium } from "@playwright/test";

const targets = [
  { path: "/result/demo", name: "01-result-compliance.png" },
  { path: "/trace?sessionId=demo", name: "02-trace.png" },
  { path: "/roadmap?sessionId=demo", name: "03-roadmap.png" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

for (const t of targets) {
  try {
    await page.goto(`http://localhost:3001${t.path}`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `E:/desktop/火鹰合规/.screenshots/${t.name}`, fullPage: true });
    console.log(`OK ${t.path}`);
  } catch (e) {
    console.log(`FAIL ${t.path}: ${e.message.slice(0, 100)}`);
  }
}

await browser.close();
