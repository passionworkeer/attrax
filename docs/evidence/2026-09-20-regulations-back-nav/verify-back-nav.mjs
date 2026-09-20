// 生产「返回上一页」验证：https://www.twinbuddy.xyz
// 引擎：chromium / firefox / webkit；每个引擎跑两种能力变体：
//   - 现代：浏览器自带 Navigation API
//   - 旧版：注入脚本移除 window.navigation，模拟旧 Firefox / 旧 Safari 的
//           sessionStorage 标记降级路径
// 场景：A 直接打开（必须留在站内，不得回退到浏览器新标签页）
//       B 站内先前页进入（必须 history.back() 回上一页）
//       C 从外部站点同标签进入（必须留在站内，不得回退到外部站点）
// 判别方式：注入脚本包一层 history.back，调用时置 window.name 标记，
// 区分「回退」与「跳列表」两条实现路径。
//
// 用法：node verify-back-nav.mjs（或 ATTRAX_BASE_URL=... 指向其他环境）
import { chromium, firefox, webkit } from "playwright";

const BASE = process.env.ATTRAX_BASE_URL ?? "https://www.twinbuddy.xyz";
const DOC = "/regulations/US-16-CFR-1263#guidance-product-requirements";
const EXTERNAL = process.env.ATTRAX_EXTERNAL_URL ?? "https://example.com/";
const ENGINES = { chromium, firefox, webkit };
const VARIANTS = [
  { name: "现代(Navigation API)", stripNavigationApi: false },
  { name: "旧版(无 Navigation API)", stripNavigationApi: true },
];

async function waitHydrated(page) {
  await page.waitForFunction(
    () => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.trim() === "返回上一页");
      return b && Object.keys(b).some((k) => k.startsWith("__reactProps$"));
    },
    { timeout: 60000 },
  );
}

async function clickBack(page) {
  const button = page.getByRole("button", { name: "返回上一页" });
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.click();
}

// 导航切换文档的瞬间 evaluate 会命中被销毁的执行上下文，重试至稳定
async function readVia(page) {
  for (let i = 0; i < 12; i += 1) {
    try {
      return await page.evaluate(() => window.name || "(assign)");
    } catch {
      await page.waitForTimeout(500);
    }
  }
  return "(unknown)";
}

const results = [];
for (const [engineName, engine] of Object.entries(ENGINES)) {
  for (const variant of VARIANTS) {
    const browser = await engine.launch();
    const context = await browser.newContext();
    await context.addInitScript((strip) => {
      if (strip) {
        Object.defineProperty(window, "navigation", { configurable: true, value: undefined });
      }
      const orig = window.history.back.bind(window.history);
      window.history.back = function (...args) {
        window.name = "used-history-back";
        return orig(...args);
      };
    }, variant.stripNavigationApi);

    const label = `${engineName} / ${variant.name}`;

    // A：直接打开
    try {
      const page = await context.newPage();
      await page.goto(BASE + DOC, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitHydrated(page);
      const hasNav = await page.evaluate(() => typeof window.navigation !== "undefined");
      await clickBack(page);
      await page.waitForURL(`${BASE}/regulations`, { timeout: 20000 }).catch(() => {});
      const via = await readVia(page);
      const path = new URL(page.url()).pathname;
      results.push({ case: `${label} · A 直接打开`, hasNavigationApi: hasNav, finalUrl: path, via, pass: path === "/regulations" && via !== "used-history-back" });
      await page.close();
    } catch (err) {
      results.push({ case: `${label} · A 直接打开`, pass: false, error: String(err).slice(0, 160) });
    }

    // B：站内先前页
    try {
      const page = await context.newPage();
      await page.goto(BASE + "/regulations", { waitUntil: "domcontentloaded", timeout: 60000 });
      // 等上一页水合并写下标记（真实用户点进详情前必然已发生）
      await page.waitForFunction(() => window.sessionStorage.getItem("attrax:in-site") === "1", { timeout: 60000 });
      await page.goto(BASE + DOC, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitHydrated(page);
      await clickBack(page);
      await page.waitForURL(`${BASE}/regulations`, { timeout: 20000 }).catch(() => {});
      const via = await readVia(page);
      const path = new URL(page.url()).pathname;
      results.push({ case: `${label} · B 站内先前页`, finalUrl: path, via, pass: path === "/regulations" && via === "used-history-back" });
      await page.close();
    } catch (err) {
      results.push({ case: `${label} · B 站内先前页`, pass: false, error: String(err).slice(0, 160) });
    }

    // C：外部站点进入
    try {
      const page = await context.newPage();
      await page.goto(EXTERNAL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.goto(BASE + DOC, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitHydrated(page);
      await clickBack(page);
      await page.waitForURL(`${BASE}/regulations`, { timeout: 20000 }).catch(() => {});
      const via = await readVia(page);
      const path = new URL(page.url()).pathname;
      results.push({ case: `${label} · C 外部站点进入`, finalUrl: path, via, pass: path === "/regulations" && via !== "used-history-back" });
      await page.close();
    } catch (err) {
      results.push({ case: `${label} · C 外部站点进入`, pass: false, error: String(err).slice(0, 160) });
    }

    await context.close();
    await browser.close();
  }
}

console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`FAILED: ${failed.length}/${results.length}`);
  process.exit(1);
}
console.log(`PASSED: ${results.length}/${results.length}`);
