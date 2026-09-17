import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("homepage loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    await expect(page.getByRole("heading")).toBeVisible();
    expect(errors.filter((e) => !e.includes("Warning"))).toHaveLength(0);
  });

  test("upload page has required form elements", async ({ page }) => {
    await page.goto("/upload");

    await expect(page.getByRole("heading", { name: /上传|upload/i })).toBeVisible();
    // 页面头部和表单内都有 submit；主表单按钮有稳定 ID。
    await expect(page.locator("#scan-submit")).toBeVisible();
  });

  test("demo result page renders correctly", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/result/demo");

    // demo 结果页主 heading 是产品名「ZGA 便携式充电器」(报告标题 h1 也含该名,用 first 取其一)。
    await expect(page.getByRole("heading", { name: /便携式充电器|Charger/i }).first()).toBeVisible();
    // 完整报告按需展开，展开后应呈现实际报告标题和下载控件。
    await page.locator("#reports > summary").click();
    await expect(page.getByRole("heading", { name: /合规分析报告|Compliance Report/i })).toBeVisible();
    await expect(page.getByRole("region", { name: /AI 合规评估|AI compliance assessment/i })).toBeVisible();
    expect(errors.filter((e) => !e.includes("Warning"))).toHaveLength(0);
  });

  test("upload page has image upload section", async ({ page }) => {
    await page.goto("/upload");

    // Image upload section
    await expect(page.getByText("产品图片")).toBeVisible();
    // File input should be present
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
    // Submit button (文案动态，使用稳定 ID)
    await expect(page.locator("#scan-submit")).toBeVisible();
  });
});
