import { expect, test } from "@playwright/test";

/**
 * i18n 语言切换 E2E
 *
 * 选择器来源：
 *   - components/ui/LanguageSwitcher.tsx — 下拉按钮 aria-label = t("common.language")
 *     （zh: "语言" / en: "Language"），下拉项文案 = t("language.zh"|"language.en")
 *     （zh: "中文" / en: "English"）。
 *   - components/SiteHeader.tsx — 全站 header 渲染 <LanguageSwitcher />。
 *   - lib/i18n/translations.ts — 切换成功后首页副标题
 *     zh: "想出海？先烧毁！" / en: "Think Before You Expand"。
 *
 * 注意：lib/i18n.tsx 的 detectInitialLocale() 默认在客户端按浏览器语言判定，
 * 首次渲染后异步切换。这里显式点击切换按钮以驱动状态变化，避免依赖初始 locale。
 */

test.describe("i18n 语言切换", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // 等 SiteHeader 渲染完成（语言按钮存在）
    await expect(
      page.getByRole("button", { name: /^(语言|Language)$/ })
    ).toBeVisible();
  });

  test("从中文切换到英文后，关键文案变为英文", async ({ page }) => {
    // 先确认中文副标题在
    await expect(page.getByText("想出海？先烧毁！")).toBeVisible();

    // 打开下拉
    await page.getByRole("button", { name: /^(语言|Language)$/ }).click();

    // 点 English 选项
    await page.getByRole("button", { name: "English" }).click();

    // 副标题切到英文
    await expect(page.getByText("Think Before You Expand")).toBeVisible();
    // 中文副标题应消失
    await expect(page.getByText("想出海？先烧毁！")).toHaveCount(0);
  });

  test("从英文切换回中文后，关键文案恢复中文", async ({ page }) => {
    // 先切到英文
    await page.getByRole("button", { name: /^(语言|Language)$/ }).click();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByText("Think Before You Expand")).toBeVisible();

    // 再打开下拉切回中文
    await page.getByRole("button", { name: /^(语言|Language)$/ }).click();
    await page.getByRole("button", { name: "中文" }).click();

    await expect(page.getByText("想出海？先烧毁！")).toBeVisible();
  });

  test("切换后 <html lang> 属性随 locale 变化", async ({ page }) => {
    // 切英文
    await page.getByRole("button", { name: /^(语言|Language)$/ }).click();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByText("Think Before You Expand")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // 切回中文
    await page.getByRole("button", { name: /^(语言|Language)$/ }).click();
    await page.getByRole("button", { name: "中文" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  });
});
