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
    // 用 type=submit 定位避开动态文案,并补上原漏掉的 disabled 断言。
    const submitButton = page.locator('button[type="submit"]')
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
    await expect(page.getByText(/综合评分|Overall Score/).first()).toBeVisible()
  })

  test('result page shows compliance score', async ({ page }) => {
    await page.goto('/result/demo')
    // demo 固定输入(electronics + 3 图 + EU/UK)计算得合规分 52/D;旧 mock 是 45。
    await expect(page.getByText('52', { exact: true }).first()).toBeVisible()
  })
})

test.describe('Regulations Page E2E', () => {
  test('regulations page loads', async ({ page }) => {
    await page.goto('/regulations')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })

  test('displays regulation updates title', async ({ page }) => {
    await page.goto('/regulations')
    // J18: entry renamed 法规更新 → 法规动态示例 to mark the page as a
    // static demo instead of implying a live feed.
    const title = page.getByText(/法规动态示例|Regulation Update Demos/)
    await expect(title).toBeVisible()
  })
})

// 2026-09-13 sweep removed the standalone /trace and /roadmap routes. The
// former "page loads" tests here only asserted `body` visibility — they kept
// passing against the branded 404 and provided zero signal, so they were
// deleted along with the routes instead of being retargeted.
