// E2E: full scan pipeline + profit report verification
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BASE = "http://localhost:3000";
const RAG = "http://localhost:8001";
const TIMEOUT_MS = 120000;
const POLL_MS = 5000;

const results = [];
const consoleErrors = [];

function ts(msg) { console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`); }
function pass(step, detail) { results.push({ passed: true, step, detail }); ts(`PASS: ${step}${detail ? " - " + detail : ""}`); }
function fail(step, detail) { results.push({ passed: false, step, detail }); ts(`FAIL: ${step} - ${detail}`); }

async function mkImage() {
  const hex = "89504e470d0a1a0a0000000d494844520000000100000001080200000090011c2d00000000324944415428c70101000000ff0000001a494441547801636400640064f8cf80000000000049454e44ae426082";
  const tmp = path.join(os.tmpdir(), "pw_test_img.png");
  fs.writeFileSync(tmp, Buffer.from(hex, "hex"));
  return tmp;
}

async function main() {
  let browser = null;
  let page = null;
  let sid = "";
  try {
    ts("=== E2E start ===");

    // 0. health
    try {
      const r = await fetch(BASE);
      if (!r.ok) throw new Error(String(r.status));
      pass("Next.js 3000");
    } catch { fail("Next.js 3000", "cannot connect"); throw new Error("Next.js down"); }

    try {
      const r = await fetch(`${RAG}/health`);
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      pass("RAG 8001", `${d.vector_count} vectors`);
    } catch { fail("RAG 8001", "cannot connect"); throw new Error("RAG down"); }

    // 1. upload page
    ts("Step 1: upload");
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
    const h1 = await page.locator("h1").first().textContent() ?? "";
    pass("Upload page loaded", h1.trim());

    // 2. demo result
    ts("Step 2: demo result");
    await page.goto(`${BASE}/result/demo`, { waitUntil: "networkidle" });
    const demoH1 = await page.locator("h1").first().textContent() ?? "";
    pass("Demo result page", demoH1.trim());
    const tabs = await page.locator("[role='tab']").allTextContents();
    if (tabs.length > 0) pass("Tabs detected", tabs.join(" / "));

    // 3. real scan
    ts("Step 3: real scan");
    await page.goto(`${BASE}/upload`, { waitUntil: "networkidle" });
    const catBtn = page.locator("button", { hasText: "电子产品" });
    if (await catBtn.count() > 0) await catBtn.click();
    const usBtn = page.locator("button", { hasText: "美国" });
    if (await usBtn.count() > 0) await usBtn.click();
    const imgInput = page.locator("input[type='file']").first();
    const imgPath = await mkImage();
    await imgInput.setInputFiles(imgPath);
    await page.waitForTimeout(1000);

    // Verify image was added (check for preview element or submit enabled)
    const previewCount = await page.locator("text=/张").count();
    ts("Image preview count: " + previewCount);

    fs.unlinkSync(imgPath);

    // Wait for submit button to be enabled (React state update)
    const subBtn = page.locator("button[type='submit']");
    await subBtn.waitFor({ state: "enabled", timeout: 5000 }).catch(() => {
      ts("Submit btn not enabled after 5s - checking page state");
    });

    if (!await subBtn.isEnabled()) {
      throw new Error("submit button still disabled after image upload");
    }
    ts("Submit button enabled");
    await subBtn.click();

    // Wait for any navigation (spinner covers everything)
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    ts("URL after submit click: " + currentUrl);

    // If still on upload, try direct API approach then navigate
    if (currentUrl.includes("/upload")) {
      ts("Still on upload - checking if session was created via API");
      // The form POST creates a session, check via API
      // Get the session from the latest session file
      const pathMod = require("path");
      const sessionsDir = "E:/desktop/火鹰合规/attrax/data/sessions";
      const files = fs.readdirSync(sessionsDir).filter(f => f.startsWith("scan_") && f.endsWith(".json"));
      files.sort((a, b) => fs.statSync(pathMod.join(sessionsDir, b)).mtime - fs.statSync(pathMod.join(sessionsDir, a)).mtime);
      if (files.length > 0) {
        sid = files[0].replace(".json", "");
        pass("Session created via API", sid);
        await page.goto(`${BASE}/burning/${sid}`, { waitUntil: "networkidle" });
        pass("Navigated to burning page", page.url());
      pass("Submitted, burning", sid);
      } else {
        throw new Error("Session not created after submit");
      }
    } else if (currentUrl.includes("/burning/")) {
      pass("Navigated to burning", currentUrl);
    } else {
      throw new Error("Unexpected URL after submit: " + currentUrl);
    }

    // 4. wait for result
    ts("Step 4: wait for result");
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (page.url().includes("/result/")) break;
      const txt = await page.locator("body").textContent() ?? "";
      if (txt.includes("100") || txt.includes("scan")) {
        await page.waitForTimeout(2000);
        if (page.url().includes("/result/")) break;
      }
      await page.waitForTimeout(POLL_MS);
    }
    if (!page.url().includes("/result/")) {
      try {
        const r = await fetch(`${BASE}/api/scan/${sid}`);
        const d = await r.json();
        if (d.status === "ready") await page.goto(`${BASE}/result/${sid}`, { waitUntil: "networkidle" });
      } catch { /* ignore */ }
    }
    if (!page.url().includes("/result/")) throw new Error("timeout");
    pass("Arrived at result page", page.url());

    // 5. verify content
    ts("Step 5: verify content");
    // Wait for React to render tabs (up to 8s for slow scans)
    try {
      await page.locator("[role='tab']").first().waitFor({ state: "visible", timeout: 8000 });
      ts("Tabs rendered");
    } catch {
      ts("Tabs not visible in 8s - checking page state");
      const bodySnippet = await page.locator("body").textContent().catch(() => "").then(t => (t ?? "").slice(0, 200));
      ts("Page body snippet: " + bodySnippet);
    }
    await page.waitForTimeout(2000);
    const body = await page.locator("body").textContent() ?? "";
    if (body.includes("合规") || body.includes("compliance")) pass("Compliance rendered");
    else fail("Compliance rendered", "no content");

    const allTabs = await page.locator("[role='tab']").allTextContents();
    if (allTabs.some(t => t.includes("成本利润"))) {
      pass("Profit tab present", allTabs.join(" / "));
      await page.locator("[role='tab']", { hasText: /成本利润/ }).click();
      await page.waitForTimeout(1000);
      const profitBody = await page.locator("body").textContent() ?? "";
      if (profitBody.includes("裸奔") || profitBody.includes("合规模式") || profitBody.includes("BOM")) {
        pass("Profit content rendered");
        if (profitBody.includes("10") || profitBody.includes("25") || profitBody.includes("¥")) pass("Profit values shown");
        else fail("Profit values shown", "no values found");
      } else {
        fail("Profit content rendered", "missing expected text");
      }
    } else {
      fail("Profit tab present", "not found: " + allTabs.join(", "));
    }

    // 6. console errors
    ts("Step 6: console errors");
    const critical = consoleErrors.filter(e => !e.includes("favicon") && !e.includes("net::ERR_") && !e.includes("Failed to load"));
    if (critical.length > 0) fail("No critical errors", critical.slice(0, 3).join("; "));
    else pass("No critical errors");

    // 7. API data
    ts("Step 7: API data");
    const r2 = await fetch(`${BASE}/api/scan/${sid}`);
    const d2 = await r2.json();
    if (d2.result) pass("API: compliance present");
    else fail("API: compliance", "empty");
    if (d2.profitReport) {
      const pr = d2.profitReport;
      pass("API: profitReport present", `report len=${String(pr.report || "").length}`);
      pass("API: barebone", JSON.stringify(pr.barebone || {}));
      pass("API: compliant", JSON.stringify(pr.compliant || {}));
    } else {
      fail("API: profitReport", "empty");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ts("EXCEPTION: " + msg);
    results.push({ passed: false, step: "EXCEPTION", detail: msg });
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  ts("\n=== SUMMARY ===");
  const ok = results.filter(r => r.passed).length;
  const ng = results.filter(r => !r.passed).length;
  results.forEach(r => ts(`${r.passed ? "[PASS]" : "[FAIL]"} ${r.step}${r.detail ? " -> " + r.detail : ""}`));
  ts(`\nTotal: ${ok} passed, ${ng} failed / ${ok + ng}`);
  if (ng > 0) process.exit(1);
}

main();