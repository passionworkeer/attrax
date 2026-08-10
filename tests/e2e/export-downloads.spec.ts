import { expect, test } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const DOWNLOAD_DIR = path.join(process.cwd(), "test-results", "export-downloads");

/**
 * 结果页改版后**没有 tab 模型**:导出区是 3 个 report-type 卡片
 * (合规总报告 / 合规路线图 / 利润分析说明),每张卡片按格式给下载按钮;合规报告的
 * PDF/DOCX 真正下载在页内 `#compliance-report` 区的 `<DownloadButtons>`
 * (PDF ZH / Word ZH / PDF EN / Word EN,客户端 jspdf/docx 生成)。
 *
 * 旧用例假设 tab + tabpanel 切换报告类型 —— 该 UI 已不存在。这里按真实结构重写,
 * 覆盖 4 条下载代码路径,并断言 3 张导出卡片都渲染:
 *   - API 文本格式(compliance MD / roadmap CSV 锚点直下)
 *   - 客户端 PDF(roadmap 卡片的 PDF 按钮,jspdf)
 *   - 客户端 DOCX(合规 DownloadButtons 的 Word ZH,docx)
 */
test.describe("Report export downloads", () => {
  test("demo result renders all export cards and downloads across all paths", async ({ page }) => {
    test.setTimeout(120_000);
    await mkdir(DOWNLOAD_DIR, { recursive: true });

    await page.goto("/result/demo");
    // demo 结果页主 heading 是产品名(报告标题 h1 也含该名,用 first 取其一)。
    await expect(page.getByRole("heading", { name: /便携式充电器|Charger/i }).first()).toBeVisible();

    // 三张导出卡片都渲染(利润卡片经 toCompliPilotValue 转换后渲染为「成本分析说明」)。
    for (const label of [/合规总报告/, /合规路线图/, /成本分析说明/]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }

    // 路径 1:API 文本 —— 合规总报告 MD 锚点直下。
    await saveDownload(
      page,
      page.locator("article", { hasText: "合规总报告" }).getByRole("link", { name: "MD" }),
      ".md",
    );
    // 路径 1b:API 文本 —— 合规路线图 CSV 锚点直下。
    await saveDownload(
      page,
      page.locator("article", { hasText: "合规路线图" }).getByRole("link", { name: "CSV" }),
      ".csv",
    );
    // 路径 2:客户端 PDF —— 合规路线图卡片的 PDF 按钮(jspdf 生成)。
    await saveDownload(
      page,
      page.locator("article", { hasText: "合规路线图" }).getByRole("button", { name: "PDF" }),
      ".pdf",
    );
    // 路径 3:客户端 DOCX —— 合规区 DownloadButtons 的 Word ZH(docx 生成)。
    await saveDownload(
      page,
      page.getByRole("button", { name: "Word ZH" }),
      ".docx",
    );
  });
});

async function saveDownload(
  page: import("@playwright/test").Page,
  trigger: import("@playwright/test").Locator,
  ext: string,
): Promise<void> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    trigger.click(),
  ]);
  const filename = download.suggestedFilename();
  expect(filename.toLowerCase()).toContain(ext);
  const savedPath = path.join(DOWNLOAD_DIR, filename);
  await download.saveAs(savedPath);
  const info = await stat(savedPath);
  expect(info.size).toBeGreaterThan(ext === ".pdf" ? 1_000 : 200);
}
