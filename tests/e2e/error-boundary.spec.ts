import { expect, test } from "@playwright/test";

/**
 * Error boundary E2E
 *
 * 选择器来源：app/error.tsx（根路由级 React error boundary）
 *   - 顶部小标 "Runtime error"
 *   - 主标题 "Something caught fire."
 *   - 副文案提到 "scan pipeline" / "previous session state"
 *   - 三个 CTA：Try again（reset）、Back to home（→ /）、Start new scan（→ /upload）
 *
 * 触发策略：
 *   app/error.tsx 只捕获渲染期抛出的错误，而项目源码没有可控的"按需抛错"入口
 *   （upload/page.tsx 里的 throw 在 async 提交 handler 里，不会冒泡到 error boundary）。
 *   为在不改 app 源码的前提下可靠触发，这里用 page.addInitScript 在客户端
 *   把 JSON.parse monkey-patch 成抛错——Next.js hydration 解析 __NEXT_DATA__ 时
 *   会调用它，导致 React 渲染期抛错，从而命中 error.tsx。
 *
 * 已知局限：这种基于 monkey-patch 的强制触发对 Next.js 版本/SSR 细节敏感。
 * 若未来 hydration 机制改动导致本测试 flake，应改为新建一个 app 内部专用
 * 抛错路由（当前任务禁止改 app/ 源码，故未采用）。
 */
test.describe("Error boundary 兜底", () => {
  test("渲染期抛错时落到品牌化 error boundary", async ({ page }) => {
    // 在任何脚本执行前注入：让 JSON.parse 在下一次调用抛错
    await page.addInitScript(() => {
      const original = JSON.parse;
      let throwOnce = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__forceRenderError = true;
      JSON.parse = function (...args: Parameters<typeof JSON.parse>) {
        if (throwOnce) {
          throwOnce = false;
          throw new SyntaxError("forced render error for e2e");
        }
        return original.apply(this, args);
      };
    });

    // 必须是页面级（非 layout 级）的崩溃：访问根路由让 hydration 解析阶段抛错
    await page.goto("/");

    // 品牌 error boundary 文案
    await expect(page.getByText("Runtime error")).toBeVisible({ timeout: 15_000 });
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
    await page.addInitScript(() => {
      const original = JSON.parse;
      let throwOnce = true;
      JSON.parse = function (...args: Parameters<typeof JSON.parse>) {
        if (throwOnce) {
          throwOnce = false;
          throw new SyntaxError("forced render error for e2e");
        }
        return original.apply(this, args);
      };
    });

    await page.goto("/");
    const homeLink = page.getByRole("link", { name: /Back to home/i });
    await expect(homeLink).toBeVisible({ timeout: 15_000 });
    // 验证 href 指向 /
    await expect(homeLink).toHaveAttribute("href", "/");
  });
});
