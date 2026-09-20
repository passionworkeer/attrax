import { test, expect } from '@playwright/test'

test.describe('Upload Page E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/upload')
  })

  test('upload page loads successfully', async ({ page }) => {
    await expect(page).toHaveTitle(/规航AI|CompliPilot/)
  })

  test('displays product images section', async ({ page }) => {
    const imagesSection = page.getByText(/产品图片|Product Images/)
    await expect(imagesSection).toBeVisible()
  })

  test('has target market selector', async ({ page }) => {
    // 标题副标题里也含「目标市场」(getByText 默认子串匹配会命中 2 节点 → strict mode),
    // 用 exact 只匹配独立的 <p>「目标市场」标签。
    const marketSelector = page.getByText('目标市场', { exact: true })
    await expect(marketSelector).toBeVisible()
  })

  test('has product category selector', async ({ page }) => {
    // 实际文案 zh「产品品类」(非「分类」)、en 小写「Product category」;
    // 走 <label htmlFor="blaze-category"> → <select id="blaze-category"> 关联更稳。
    const categorySelector = page.getByLabel(/产品品类|Product category/i)
    await expect(categorySelector).toBeVisible()
  })

  test('submit button is initially disabled without images', async ({ page }) => {
    // 初始无图时按钮文案是动态的(「上传 1 张图片后开始检测」),且 disabled。
    // 页面头部也有一个关联同一表单的 submit 按钮；用表单主按钮 ID 避免 strict mode 冲突。
    const submitButton = page.locator('#scan-submit')
    await expect(submitButton).toBeDisabled()
  })
})

test.describe('Result Page E2E', () => {
  test('demo result page loads', async ({ page }) => {
    await page.goto('/result/demo')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })

  test('demo result shows scan data', async ({ page }) => {
    await page.goto('/result/demo')
    await expect(page.getByRole('region', { name: /AI 合规评估|AI compliance assessment/i })).toBeVisible()
  })

  test('result page shows the assessment meter state', async ({ page }) => {
    await page.goto('/result/demo')
    // Demo/legacy fixtures may have no applicable checks, in which case the UI
    // honestly renders a pending meter instead of inventing a numeric score.
    const meter = page.getByRole('meter')
    await expect(meter).toBeVisible()
    await expect(meter).toHaveAccessibleName(/\d+ \/ 100|尚无适用检查可评分|No applicable checks to score/i)
  })
})

test.describe('Regulations Page E2E', () => {
  test('regulations page loads', async ({ page }) => {
    await page.goto('/regulations')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })

  test('displays regulation intelligence title', async ({ page }) => {
    await page.goto('/regulations')
    // The page is now branded as the regulation intelligence center. Keep the
    // previous labels as fallbacks for older locale bundles during rollout.
    const title = page.getByText(
      /法规情报中心|Regulation Intelligence Center|法规动态示例|Regulation Update Demos/,
    )
    await expect(title).toBeVisible()
  })
})

// 2026-09-13 sweep removed the standalone /trace and /roadmap routes. The
// former "page loads" tests here only asserted `body` visibility — they kept
// passing against the branded 404 and provided zero signal, so they were
// deleted along with the routes instead of being retargeted.
