// 线上「返回上一页」回归验证脚本 —— 对 https://www.twinbuddy.xyz 真实浏览器操作。
//
// 场景 A：无历史直接打开（history.length === 1）→ 应跳到 /regulations
// 场景 B：站内先前页进入（history.length > 1）→ 应回到上一页
//
// 注意：必须在 React 水合、onClick 挂载（__reactProps$）之后再点击，
// 否则点击落在 SSR 静态按钮上，得到"点了没反应"的假象（本脚本第一版
// 即因此误判，见同目录 README 验证记录）。
//
// 用法：ATTRAX_BASE_URL=https://www.twinbuddy.xyz node verify-back-nav.mjs
import { chromium } from "playwright";

const BASE = process.env.ATTRAX_BASE_URL ?? "https://www.twinbuddy.xyz";
const DOC = "/regulations/US-16-CFR-1263#guidance-product-requirements";

const browser = await chromium.launch();
const results = [];

async function waitHydrated(page) {
  await page.waitForFunction(
    () => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.trim() === "返回上一页");
      return b && Object.keys(b).some((k) => k.startsWith("__reactProps$"));
    },
    { timeout: 20000 },
  );
}

async function clickBackButton(page) {
  const button = page.getByRole("button", { name: "返回上一页" });
  await button.waitFor({ state: "visible", timeout: 15000 });
  await button.click();
}

// ---- 场景 A：无历史（location.replace 从空白页进入，历史长度 = 1） ----
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.evaluate((u) => window.location.replace(u), BASE + DOC);
  await page.waitForLoadState("domcontentloaded");
  await waitHydrated(page);
  const historyBefore = await page.evaluate(() => window.history.length);
  await clickBackButton(page);
  await page.waitForURL(`${BASE}/regulations`, { timeout: 15000 }).catch(() => {});
  results.push({
    scenario: "A: 无历史直接打开（length=1）",
    historyLength: historyBefore,
    finalUrl: page.url(),
    pass: new URL(page.url()).pathname === "/regulations",
  });
  await context.close();
}

// ---- 场景 B：站内先前页进入（history.length > 1） ----
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE + "/regulations", { waitUntil: "domcontentloaded" });
  await page.goto(BASE + DOC, { waitUntil: "domcontentloaded" });
  await waitHydrated(page);
  const historyBefore = await page.evaluate(() => window.history.length);
  await clickBackButton(page);
  await page.waitForURL(`${BASE}/regulations`, { timeout: 15000 }).catch(() => {});
  results.push({
    scenario: "B: 站内先前页进入（length>1）",
    historyLength: historyBefore,
    finalUrl: page.url(),
    pass: new URL(page.url()).pathname === "/regulations",
  });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`FAILED: ${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`PASSED: ${results.length}/${results.length}`);
