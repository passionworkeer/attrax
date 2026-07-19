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

  test('displays product documents section', async ({ page }) => {
    const docsSection = page.locator('label').filter({ hasText: /产品文档|Product Documents/ })
    await expect(docsSection).toBeVisible()
  })

  test('has target market selector', async ({ page }) => {
    const marketSelector = page.getByText(/目标市场|Target Market/)
    await expect(marketSelector).toBeVisible()
  })

  test('has product category selector', async ({ page }) => {
    const categorySelector = page.getByText(/产品分类|Product Category/)
    await expect(categorySelector).toBeVisible()
  })

  test('submit button is initially disabled without images', async ({ page }) => {
    const submitButton = page.getByRole('button', { name: /提交并开始扫描|Submit.*Scan/i })
    await expect(submitButton).toBeVisible()
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
    await expect(page.getByText('45', { exact: true }).first()).toBeVisible()
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
    const title = page.getByText(/法规更新|Regulation Updates/)
    await expect(title).toBeVisible()
  })
})

test.describe('Trace Page E2E', () => {
  test('trace page loads', async ({ page }) => {
    await page.goto('/trace')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })
})

test.describe('Roadmap Page E2E', () => {
  test('roadmap page loads', async ({ page }) => {
    await page.goto('/roadmap')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('body')).toBeVisible()
  })
})
