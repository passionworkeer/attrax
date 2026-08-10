import { expect, test } from "@playwright/test";

/**
 * i18n 语言切换 E2E
 *
 * 真实 UI 与 provider 边界:
 *   - `/` 走 app/page.tsx → components/complipilot/homepage.tsx (CompliPilotHome)。
 *     内部用 BlazeLocaleProvider,文案为 `isZh ? "中文" : "英文"` 硬编码三元,
 *     `中/EN` 按钮只切 BlazeLocaleProvider 状态(也即 nav 高亮/动画等纯展示态),
 *     不影响文案本身。
 *   - `/zh` 与 `/en` 走 app/[locale]/page.tsx,服务端用 lib/i18n.tsx 的 `t(key, locale)`
 *     (TranslationProvider 体系的非-React 服务端分支)渲染 home.subtitle:
 *       zh: "想出海？先烧毁！"
 *       en: "Think Before You Expand"
 *
 * 本 spec 测的是 [locale] 路由的服务端翻译输出(TranslationProvider 的 SSR 分支),
 * 通过直接访问 /zh 与 /en 验证。
 *
 * 不验证 <html lang>:app/layout.tsx 硬编码 lang="zh-CN",BlazeLocaleProvider 仅在
 * 客户端 mount 后通过 useEffect 改写(且默认 locale=zh 时不会触发改写),SSR 阶段
 * 永远是 zh-CN。这是已知 i18n 不完整(影响 SEO/a11y),已在 git 记忆里作为
 * follow-up 跟踪(见 attrax-rag-memory-budget.md / 项目内其它 i18n issue)。本次
 * PR 不修布局 lang,只确保路由 + 文案 SSR 正确。
 *
 * 历史:旧 spec 用 getByRole("button", { name: /^(语言|Language)$/ }) 假设
 * LanguageSwitcher 在 `/`,但 `248bfe2` 把首页 pivot 到 CompliPilotHome 后该选择器
 * 已不可用;且 CompliPilotHome 文案硬编码,按钮点击不切文案。继续用按钮路径等于
 * 测"硬编码三元",无端到端意义。
 */

test.describe("i18n 语言切换", () => {
  test("/zh 渲染中文副标题", async ({ page }) => {
    await page.goto("/zh");
    await expect(page.getByText("想出海？先烧毁！")).toBeVisible();
  });

  test("/en 渲染英文副标题", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByText("Think Before You Expand")).toBeVisible();
  });

  test("/zh 与 /en 文案互斥(zh 页面不出现 en 副标题,en 页面不出现 zh 副标题)", async ({ page }) => {
    await page.goto("/zh");
    await expect(page.getByText("想出海？先烧毁！")).toBeVisible();
    await expect(page.getByText("Think Before You Expand")).toHaveCount(0);

    await page.goto("/en");
    await expect(page.getByText("Think Before You Expand")).toBeVisible();
    await expect(page.getByText("想出海？先烧毁！")).toHaveCount(0);
  });
});
