import { expect, test } from "@playwright/test";

/**
 * Error boundary E2E
 *
 * 选择器来源:app/error.tsx(根路由级 React error boundary)
 *   - 顶部小标 "Runtime error"
 *   - 主标题 "Something caught fire."
 *   - 副文案提到 "scan pipeline" / "previous session state"
 *   - 三个 CTA:Try again(reset)、Back to home(→ /)、Start new scan(→ /upload)
 *
 * 注:Next 16 dev overlay 在渲染期错误时也会注入 <span class="nextjs__container_errors_label">
 *   "Runtime Error"(大小写与 brand `<p>Runtime error</p>` 不同)。strict mode 下
 *   `getByText("Runtime error")` 会同时命中 → 用 `{ exact: true }` 锁定 brand 文案。
 *
 * 触发策略:访问 app/force-error/page.tsx —— 一个仅在 NODE_ENV !== "production"
 * 时渲染期抛错的专用路由。e2e 跑在 `next dev`(development)下,该路由会让 React
 * 渲染期抛错,稳定命中 app/error.tsx。
 * (旧实现用 addInitScript monkey-patch JSON.parse,在 Next 16 App Router 的 RSC
 * flight 数据下不再可靠产生渲染期错误,故弃用。app/error.tsx 文案已与断言匹配,无需改。)
 */
test.describe("Error boundary 兜底", () => {
  test("渲染期抛错时落到品牌化 error boundary", async ({ page }) => {
    await page.goto("/force-error");

    // 品牌 error boundary 文案(exact 区分 brand "Runtime error" vs Next overlay "Runtime Error")
    await expect(page.getByText("Runtime error", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Something caught fire." })
    ).toBeVisible();
    await expect(page.getByText(/scan pipeline/i)).toBeVisible();

    // CTA 按钮/链接齐全
    await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Back to home/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Start new scan/i })).toBeVisible();
  });

  test("error boundary 的 Back to home 链接指向首页", async ({ page }) => {
    await page.goto("/force-error");
    const homeLink = page.getByRole("link", { name: /Back to home/i });
    await expect(homeLink).toBeVisible({ timeout: 15_000 });
    // 验证 href 指向 /
    await expect(homeLink).toHaveAttribute("href", "/");
  });
});
