import { expect, test } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const DOWNLOAD_DIR = path.join(process.cwd(), "test-results", "export-downloads");

/**
 * 当前结果页把完整报告和导出控件收在 `#reports` disclosure 中。
 * 这里覆盖用户真正可见的两条导出路径：客户端 PDF 与 DOCX。
 */
test.describe("Report export downloads", () => {
  test("demo result exposes and downloads the current report formats", async ({ page }) => {
    test.setTimeout(120_000);
    await mkdir(DOWNLOAD_DIR, { recursive: true });

    await page.goto("/result/demo");
    // demo 结果页主 heading 是产品名(报告标题 h1 也含该名,用 first 取其一)。
    await expect(page.getByRole("heading", { name: /便携式充电器|Charger/i }).first()).toBeVisible();

    await page.locator("#reports > summary").click();
    await expect(page.getByRole("heading", { name: /合规分析报告|Compliance Analysis Report/i })).toBeVisible();

    for (const name of ["合规 PDF ZH", "Word ZH", "合规 PDF EN", "Word EN"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }

    // 路径 1：客户端 PDF（jsPDF）。
    await saveDownload(
      page,
      page.getByRole("button", { name: "合规 PDF ZH", exact: true }),
      ".pdf",
    );
    // 路径 2：客户端 DOCX（docx）。
    await saveDownload(
      page,
      page.getByRole("button", { name: "Word EN", exact: true }),
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
