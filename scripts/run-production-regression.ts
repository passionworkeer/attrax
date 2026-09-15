import { chromium, Page, Browser } from "playwright";
import * as path from "path";
import * as fs from "fs";

interface TestCase {
  name: string;
  category: string;
  categoryLabel: string;
  targetMarketName: string;
  targetMarketCode: string;
  dirPath: string;
  images: string[];
  doc?: string;
  answers: Array<{ question: string; answer: string }>;
  expectedLabels: string[];
  forbiddenLabels: string[];
}

/** Path layout (run from anywhere): the test package lives one level up from
 *  this script (repo root / 规航AI-三产品完整测试包-20260914/<case-dir>/). The
 *  package itself is third-party judge material and is gitignored — when it
 *  is missing the script reports a clear error rather than crashing mid-run.
 *  Override via ATTRAX_REGRESSION_PKG_DIR to relocate the package. */
const REPO_ROOT = path.resolve(__dirname, "..");
const TEST_PKG_DIR =
  process.env.ATTRAX_REGRESSION_PKG_DIR ||
  path.join(REPO_ROOT, "规航AI-三产品完整测试包-20260914");

const TEST_CASES: TestCase[] = [
  {
    name: "01-Anker-A2332-充电器-EU",
    category: "electronics",
    categoryLabel: "3C 电子",
    targetMarketName: "欧盟",
    targetMarketCode: "EU",
    dirPath: path.join(TEST_PKG_DIR, "01-Anker-A2332-充电器-EU"),
    images: [
      "01-正反面整体.jpg",
      "02-铭牌标签近照.jpg",
      "03-接口与插脚.jpg",
    ],
    answers: [
      { question: "是否内置电池", answer: "否" },
      { question: "是否含无线功能", answer: "否" },
      { question: "输入电压是多少", answer: "100-240V 宽压" },
      { question: "是否随附电源适配器", answer: "否" },
    ],
    expectedLabels: ["A2332", "100-240V", "65W Max", "CCC", "划叉垃圾桶", "双重绝缘", "室内使用", "环保使用期限10"],
    forbiddenLabels: ["CE", "FCC", "UKCA"],
  },
  {
    name: "02-Xiaomi-Smart-Kettle-2-Pro-EU",
    category: "appliance",
    categoryLabel: "家电",
    targetMarketName: "欧盟",
    targetMarketCode: "EU",
    dirPath: path.join(TEST_PKG_DIR, "02-Xiaomi-Smart-Kettle-2-Pro-EU"),
    images: [
      "01-整机整体照.jpg",
      "02-铭牌与合规标志近照.jpg",
      "03-包装与参数.jpg",
    ],
    answers: [
      { question: "市电", answer: "是" },
      { question: "加热或电机", answer: "是" },
      { question: "主要用途", answer: "家用" },
    ],
    expectedLabels: ["MJJYSH01-A", "220-240V", "1800W", "50/60Hz", "1.7L", "CE", "UKCA", "划叉垃圾桶"],
    forbiddenLabels: [],
  },
  {
    name: "03-LEGO-76429-玩具-US",
    category: "toy",
    categoryLabel: "玩具",
    targetMarketName: "美国",
    targetMarketCode: "US",
    dirPath: path.join(TEST_PKG_DIR, "03-LEGO-76429-玩具-US"),
    images: [
      "01-产品整体照.jpg",
      "02-包装与年龄警告.jpg",
      "03-附件与主体分开展示.jpg",
    ],
    answers: [
      { question: "目标适用年龄", answer: "14 岁以上" },
      { question: "是否含磁体", answer: "不确定" },
      { question: "是否含绳带", answer: "否" },
      { question: "是否含电池", answer: "是" },
    ],
    expectedLabels: ["18+", "76429", "561 pcs/pzs", "WARNING", "INGESTION HAZARD", "纽扣电池图标", "batteries included"],
    forbiddenLabels: ["CE", "CCC", "0-3禁用标识"],
  },
];

/** Target base URL. Defaults to production; override with ATTRAX_REGRESSION_BASE_URL
 *  to point at staging/localhost. */
const BASE_URL =
  process.env.ATTRAX_REGRESSION_BASE_URL || "https://wangjianjun.xyz";

/** Regression output directory. Defaults to .screenshots/regression-YYYYMMDD
 *  next to this script (gitignored). Override with ATTRAX_REGRESSION_OUT_DIR. */
const DEFAULT_OUT_DIR = path.join(
  REPO_ROOT,
  ".screenshots",
  `regression-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
);
const REPO_SCREENSHOT_DIR =
  process.env.ATTRAX_REGRESSION_OUT_DIR || DEFAULT_OUT_DIR;

/** Optional secondary mirror for tool-specific storage (e.g. gemini antigravity
 *  brain). Set ATTRAX_REGRESSION_ARTIFACT_DIR=/path/to/mirror to mirror every
 *  screenshot there in addition to REPO_SCREENSHOT_DIR. Unset by default —
 *  most CI runs do not need this and the old hard-coded
 *  /Users/wangjianjun/.gemini/... was a per-machine path that never worked
 *  outside the original author's laptop. */
const ARTIFACT_DIR = process.env.ATTRAX_REGRESSION_ARTIFACT_DIR || null;

async function saveScreenshot(page: Page, filename: string, locator?: ReturnType<Page["locator"]>) {
  if (!fs.existsSync(REPO_SCREENSHOT_DIR)) {
    fs.mkdirSync(REPO_SCREENSHOT_DIR, { recursive: true });
  }
  if (ARTIFACT_DIR && !fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }
  const repoPath = path.join(REPO_SCREENSHOT_DIR, filename);
  if (locator) {
    await locator.screenshot({ path: repoPath });
    if (ARTIFACT_DIR) {
      await locator.screenshot({ path: path.join(ARTIFACT_DIR, filename) });
    }
  } else {
    await page.screenshot({ path: repoPath, fullPage: true });
    if (ARTIFACT_DIR) {
      await page.screenshot({ path: path.join(ARTIFACT_DIR, filename), fullPage: true });
    }
  }
  console.log(`  📸 Screenshot saved: ${filename}`);
}

async function selectMarketOnly(page: Page, targetMarketName: string) {
  console.log(`  Configuring target market: ${targetMarketName}...`);
  const marketButtons = page.locator("button").filter({ hasText: /^(欧盟|美国|英国|中国)$/ });
  const count = await marketButtons.count();
  for (let i = 0; i < count; i++) {
    const btn = marketButtons.nth(i);
    const text = (await btn.innerText()).trim();
    const className = (await btn.getAttribute("class")) || "";
    const isActive = className.includes("bg-white/40");
    if (text === targetMarketName) {
      if (!isActive) {
        await btn.click();
        console.log(`    Activated market: ${text}`);
      }
    } else {
      if (isActive) {
        await btn.click();
        console.log(`    Deactivated market: ${text}`);
      }
    }
  }
}

async function selectConditionalAnswer(page: Page, questionTextPartial: string, optionText: string) {
  const container = page.locator("div").filter({
    has: page.locator("p", { hasText: questionTextPartial }),
  });
  const button = container.locator("button", { hasText: optionText }).first();
  if (await button.isVisible()) {
    const isPressed = await button.getAttribute("aria-pressed");
    if (isPressed !== "true") {
      await button.click();
      console.log(`    Selected declaration "${optionText}" for question "${questionTextPartial}"`);
    }
  } else {
    console.warn(`    ⚠️ Button not found for "${optionText}" under "${questionTextPartial}"`);
  }
}

interface CaseResult {
  testCase: string;
  success: boolean;
  sessionId?: string;
  elapsedSeconds?: string;
  status?: string;
  productName?: string;
  productCategory?: string;
  riskPointsCount?: number;
  complianceScore?: number;
  source?: string;
  reportPackageStatus?: string;
  rawScanData?: unknown;
  error?: string;
}

async function runSingleCase(browser: Browser, testCase: TestCase, caseIndex: number): Promise<CaseResult> {
  console.log(`\n======================================================`);
  console.log(`[Case ${caseIndex + 1}/${TEST_CASES.length}] Starting: ${testCase.name}`);
  console.log(`======================================================`);

  // Fail loud if the test package (gitignored third-party data) is missing —
  // the old hard-coded /Users/wangjianjun/... path crashed silently on
  // every other machine.
  if (!fs.existsSync(testCase.dirPath)) {
    const message = `Test package directory not found: ${testCase.dirPath}. ` +
      `Set ATTRAX_REGRESSION_PKG_DIR to point at the extracted 规航AI-三产品完整测试包-20260914/ directory.`;
    console.error(`❌ ${message}`);
    return { testCase: testCase.name, success: false, error: message };
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("Step 1: Navigating to upload page...");
    await page.goto(`${BASE_URL}/upload`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    console.log(`Step 2: Selecting category "${testCase.category}"...`);
    await page.selectOption("#blaze-category", testCase.category);
    await page.waitForTimeout(500);

    console.log(`Step 3: Setting target market to "${testCase.targetMarketName}"...`);
    await selectMarketOnly(page, testCase.targetMarketName);
    await page.waitForTimeout(500);

    console.log("Step 4: Uploading 3 photos...");
    for (let i = 0; i < testCase.images.length; i++) {
      const imgPath = path.join(testCase.dirPath, testCase.images[i]);
      if (!fs.existsSync(imgPath)) {
        throw new Error(`Image file not found: ${imgPath}`);
      }
      console.log(`  Uploading slot ${i}: ${testCase.images[i]}`);
      await page.locator(`#blaze-upload-slot-${i}`).setInputFiles(imgPath);
      await page.waitForTimeout(300);
    }

    console.log("Step 5: Setting conditional declarations...");
    for (const ans of testCase.answers) {
      await selectConditionalAnswer(page, ans.question, ans.answer);
    }
    await page.waitForTimeout(500);

    const prefix = `case_${caseIndex + 1}_${testCase.category}_v5`;
    await saveScreenshot(page, `${prefix}_01_upload_ready.png`);

    console.log("Step 6: Submitting scan...");
    const submitBtn = page.locator('button[type="submit"]');
    const isEnabled = await submitBtn.isEnabled();
    console.log(`  Submit button enabled: ${isEnabled}, text: "${await submitBtn.innerText()}"`);

    const scanPromise = page.waitForResponse(
      (resp) => resp.url().includes("/api/scan") && resp.request().method() === "POST",
      { timeout: 30000 }
    );
    await submitBtn.click();

    const scanResp = await scanPromise;
    console.log(`  Scan API response status: ${scanResp.status()}`);
    const scanJson = await scanResp.json();
    const sessionId = scanJson?.data?.sessionId || scanJson?.sessionId;
    console.log(`  Assigned Session ID: ${sessionId}`);

    console.log("Step 7: Waiting for /burning progress page...");
    await page.waitForURL(new RegExp(`/burning/${sessionId}`), { timeout: 30000 });
    await page.waitForTimeout(2000);
    await saveScreenshot(page, `${prefix}_02_burning_progress.png`);

    console.log("Step 8: Waiting for /result page (polling AI pipeline, max 240s)...");
    const startTime = Date.now();
    await page.waitForURL(new RegExp(`/result/${sessionId}`), { timeout: 240000 });
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✅ Reached result page in ${elapsedSeconds}s! URL: ${page.url()}`);

    // Wait for animations, hydration, and content to settle
    try {
      await page.locator("#overview").waitFor({ state: "visible", timeout: 35000 });
    } catch {
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(1000);

    console.log("Step 9: Capturing result page screenshots...");
    await saveScreenshot(page, `${prefix}_03_result_full.png`);

    const overviewLocator = page.locator("#overview");
    if (await overviewLocator.count() > 0) {
      await saveScreenshot(page, `${prefix}_04_result_overview.png`, overviewLocator);
    }

    // Scroll down to visual inspection section if available
    const inspectionLocator = page.locator("section").filter({ hasText: /STEP 02|视觉复核|视觉检查|Visual Inspection|图片标记/ }).first();
    if (await inspectionLocator.count() > 0) {
      await inspectionLocator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      await saveScreenshot(page, `${prefix}_05_result_visual_inspection.png`, inspectionLocator);
    }

    // Capture checklist / findings panel
    const checklistLocator = page.locator("section").filter({ hasText: /STEP 03|合规项清单|Checklist|待办项/ }).first();
    if (await checklistLocator.count() > 0) {
      await checklistLocator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      await saveScreenshot(page, `${prefix}_06_result_checklist.png`, checklistLocator);
    }

    // Step 10: Fetch raw scan API payload to inspect data
    console.log("Step 10: Fetching raw scan payload from API...");
    const apiUrl = `${BASE_URL}/api/scan/${sessionId}`;
    const fetchResp = await page.evaluate(async (url: string) => {
      const res = await fetch(url);
      return { status: res.status, body: await res.json() };
    }, apiUrl);

    console.log(`  API status: ${fetchResp.status}`);
    const scanData = fetchResp.body?.data || fetchResp.body;

    const dataDumpPath = path.join(REPO_SCREENSHOT_DIR, `${prefix}_data.json`);
    fs.writeFileSync(dataDumpPath, JSON.stringify(scanData, null, 2), "utf8");
    console.log(`  Saved scan data JSON to ${dataDumpPath}`);

    // Step 11: Visit profit page if available
    console.log("Step 11: Visiting profit page...");
    await page.goto(`${BASE_URL}/profit/${sessionId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    await saveScreenshot(page, `${prefix}_07_profit_page.png`);

    return {
      testCase: testCase.name,
      success: true,
      sessionId,
      elapsedSeconds,
      status: scanData?.status,
      productName: scanData?.result?.productName || scanData?.productName,
      productCategory: scanData?.result?.productCategory || scanData?.productCategory,
      riskPointsCount: scanData?.result?.riskPoints?.length ?? 0,
      complianceScore: scanData?.result?.complianceScore,
      source: scanData?.result?.source || scanData?.source,
      reportPackageStatus: scanData?.result?.reportPackage?.auditMetadata?.validationStatus,
      rawScanData: scanData,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Error in test case ${testCase.name}:`, message);
    const prefix = `case_${caseIndex + 1}_${testCase.category}_v5`;
    try {
      await saveScreenshot(page, `${prefix}_error.png`);
    } catch {
      // best-effort error screenshot; ignore secondary failures
    }
    return {
      testCase: testCase.name,
      success: false,
      error: message,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  console.log("Starting Complete Online Regression Suite...");
  console.log("Timestamp:", new Date().toISOString());
  console.log(`Target Server: ${BASE_URL}`);
  console.log(`Test package: ${TEST_PKG_DIR}`);
  console.log(`Output dir: ${REPO_SCREENSHOT_DIR}`);
  if (ARTIFACT_DIR) console.log(`Artifact mirror: ${ARTIFACT_DIR}`);

  if (!fs.existsSync(TEST_PKG_DIR)) {
    console.error(
      `❌ Test package directory missing: ${TEST_PKG_DIR}\n` +
      `   Set ATTRAX_REGRESSION_PKG_DIR to the extracted directory, or download + extract 规航AI-三产品完整测试包-20260914.zip next to this script.`,
    );
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const results: CaseResult[] = [];

  const filterArg = process.argv[2];
  const casesToRun = filterArg !== undefined
    ? TEST_CASES.map((tc, idx) => ({ tc, idx })).filter(
        ({ tc, idx }) =>
          idx === parseInt(filterArg, 10) ||
          tc.category === filterArg ||
          tc.name.includes(filterArg),
      )
    : TEST_CASES.map((tc, idx) => ({ tc, idx }));

  for (const { tc, idx } of casesToRun) {
    const res = await runSingleCase(browser, tc, idx);
    results.push(res);
  }

  await browser.close();

  console.log("\n======================================================");
  console.log("Regression Run Summary:");
  console.log("======================================================");
  for (const r of results) {
    console.log(`Case: ${r.testCase}`);
    console.log(`  Success: ${r.success}`);
    if (r.success) {
      console.log(`  Session ID: ${r.sessionId} (${r.elapsedSeconds}s)`);
      console.log(`  Status: ${r.status}`);
      console.log(`  Product: ${r.productName} [${r.productCategory}]`);
      console.log(`  Score: ${r.complianceScore}`);
      console.log(`  Source: ${r.source}`);
      console.log(`  Risk Points: ${r.riskPointsCount}`);
    } else {
      console.log(`  Error: ${r.error}`);
    }
  }

  const summaryPath = path.join(REPO_SCREENSHOT_DIR, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Summary saved to ${summaryPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});