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
    await expect(page.getByRole("button", { name: /开始扫描|扫描|submit/i })).toBeVisible();
  });

  test("demo result page renders correctly", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/result/demo");

    await expect(page.getByRole("heading", { name: /结果|result/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /合规分析报告|Compliance Analysis Report/i })).toBeVisible();
    await expect(page.getByText(/综合评分|Overall Score/).first()).toBeVisible();
    expect(errors.filter((e) => !e.includes("Warning"))).toHaveLength(0);
  });

  test("upload page has image upload section", async ({ page }) => {
    await page.goto("/upload");

    // Image upload section
    await expect(page.getByText("产品图片")).toBeVisible();
    // File input should be present
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
    // Submit button
    await expect(page.getByRole("button", { name: /开始扫描/i })).toBeVisible();
  });
});
