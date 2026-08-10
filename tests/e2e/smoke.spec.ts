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
    // 提交按钮文案随状态动态变化(初始「上传 1 张图片后开始检测」),用 type=submit 定位。
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("demo result page renders correctly", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/result/demo");

    // demo 结果页主 heading 是产品名「ZGA 便携式充电器」(报告标题 h1 也含该名,用 first 取其一)。
    await expect(page.getByRole("heading", { name: /便携式充电器|Charger/i }).first()).toBeVisible();
    // 结果页改版后没有 tab;合规报告区是 ComplianceReportView 里的 h3「合规分析报告」。
    await expect(page.getByRole("heading", { name: /合规分析报告|Compliance Report/i })).toBeVisible();
    await expect(page.getByText(/综合评分|Overall Score/).first()).toBeVisible();
    expect(errors.filter((e) => !e.includes("Warning"))).toHaveLength(0);
  });

  test("upload page has image upload section", async ({ page }) => {
    await page.goto("/upload");

    // Image upload section
    await expect(page.getByText("产品图片")).toBeVisible();
    // File input should be present
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
    // Submit button(文案动态,用 type=submit 定位)
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
