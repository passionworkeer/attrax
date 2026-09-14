import { expect, test } from "@playwright/test";

/**
 * 404 品牌页 E2E
 *
 * 选择器来源：app/not-found.tsx
 *   - 顶部小标 "404 · Not found"（class label-caps）
 *   - 主标题 "页面未找到"（J18：中文主导，与中文品牌/工作流一致；
 *     原 "Lost in the smoke." 已下线）
 *   - 英文辅助行含 "Page not found"
 *   - 两个 CTA：返回首页（→ /）、法规动态示例（→ /regulations）
 *
 * 关键差异点：Next.js 默认 404 是白底黑字 "This page could not be found."。
 * 我们断言品牌文案存在且默认文案不存在，证明确实命中了 app/not-found.tsx。
 */
test.describe("404 品牌页", () => {
  test("访问不存在路由落到品牌化 404", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-anywhere-complipilot");

    // 品牌关键元素
    await expect(page.getByText("404 · Not found")).toBeVisible();
    await expect(page.getByRole("heading", { name: "页面未找到" })).toBeVisible();
    await expect(page.getByText(/Page not found/i)).toBeVisible();

    // CTA 链接存在（J18：CTA 已中文化）
    await expect(page.getByRole("link", { name: /返回首页/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /法规动态示例/ })).toBeVisible();

    // 反向断言：Next.js 默认 404 文案不应出现
    await expect(page.getByText("This page could not be found.")).toHaveCount(0);
  });

  test("404 页「返回首页」跳转首页", async ({ page }) => {
    await page.goto("/nope-complipilot-404-test");
    const homeLink = page.getByRole("link", { name: /返回首页/ });
    await expect(homeLink).toBeVisible();
    await homeLink.click();
    await expect(page).toHaveURL("/");
  });

  test("404 页「法规动态示例」跳转法规示例页", async ({ page }) => {
    await page.goto("/nope-complipilot-404-test");
    const regLink = page.getByRole("link", { name: /法规动态示例/ });
    await expect(regLink).toBeVisible();
    await regLink.click();
    await expect(page).toHaveURL(/\/regulations$/);
  });
});
