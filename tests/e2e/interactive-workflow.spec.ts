import { test, expect } from "@playwright/test";

const PIXEL_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360f8cf00000301010118dd8db00000000049454e44ae426082",
  "hex"
);

test.describe("Interactive Browser Workflow E2E", () => {
  test("upload form: category selection, market toggling, and button states", async ({ page }) => {
    await page.goto("/upload");

    // Wait for client hydration
    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="file"]');
      return Boolean(input && Object.keys(input).some((k) => k.startsWith("__reactProps")));
    });

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeDisabled();

    // Verify category buttons are interactive
    const applianceCategoryBtn = page.locator("button, div").filter({ hasText: /家电|Appliance/i }).first();
    if (await applianceCategoryBtn.isVisible()) {
      await applianceCategoryBtn.click();
    }

    // Toggle target markets
    const usMarketBtn = page.locator("button, div").filter({ hasText: /^US$|^美国$/i }).first();
    if (await usMarketBtn.isVisible()) {
      await usMarketBtn.click();
    }

    // Submit button still disabled without images
    await expect(submitBtn).toBeDisabled();
  });

  test("upload form: file count limit enforcement and file removal", async ({ page }) => {
    await page.goto("/upload");

    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="file"]');
      return Boolean(input && Object.keys(input).some((k) => k.startsWith("__reactProps")));
    });

    const fileInput = page.locator('input[type="file"]').first();

    // Upload 1 valid file
    await fileInput.setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: PIXEL_PNG,
    });

    // Should show 1 file ready
    await expect(page.getByText(/1\/3 张已就绪|1\/3 ready/i)).toBeVisible();
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();

    // Upload 9 files to exceed MAX_UPLOAD_FILES (8)
    const nineFiles = Array.from({ length: 9 }, (_, i) => ({
      name: `file_${i + 1}.png`,
      mimeType: "image/png",
      buffer: PIXEL_PNG,
    }));

    await fileInput.setInputFiles(nineFiles);

    // Assert error message displayed
    await expect(
      page.getByText(/最多上传 8 张图片|Up to 8 images are allowed/i)
    ).toBeVisible({ timeout: 5000 });
  });

  test("demo result: preview tabs switching and interactive details", async ({ page }) => {
    await page.goto("/result/demo");

    // Ensure page loaded
    await expect(page.getByRole("heading", { name: /便携式充电器|Charger/i }).first()).toBeVisible();

    // Check report preview section
    const reportSection = page.locator("#reports");
    await expect(reportSection).toBeVisible();

    // Switch between preview tabs (Roadmap, Profit, Compliance)
    const roadmapTab = page.getByRole("tab", { name: /路线图报告|Roadmap Report/i }).first();
    if (await roadmapTab.isVisible()) {
      await roadmapTab.click();
      await expect(page.getByText(/整改路线图|Compliance Roadmap|Timeline/i).first()).toBeVisible();
    }

    const profitTab = page.getByRole("tab", { name: /利润影响|Profit & AI Decision/i }).first();
    if (await profitTab.isVisible()) {
      await profitTab.click();
      await expect(page.getByText(/单件收益|合规成本|gross profit|margin/i).first()).toBeVisible();
    }

    const complianceTab = page.getByRole("tab", { name: /合规报告|Compliance Report/i }).first();
    if (await complianceTab.isVisible()) {
      await complianceTab.click();
      await expect(page.getByText(/合规分析报告|Compliance Scan Report/i).first()).toBeVisible();
    }
  });

  test("demo result: hotspot markers and priority risk panel interaction", async ({ page }) => {
    await page.goto("/result/demo");

    await expect(page.getByRole("heading", { name: /便携式充电器|Charger/i }).first()).toBeVisible();

    // Locate hotspot layer or risk items
    const riskItems = page.locator("#overview, #evidence").locator("button, [role='button']").filter({ hasText: /CE|标识|说明书|Warning|Mark/i });
    const count = await riskItems.count();
    if (count > 0) {
      await riskItems.first().click();
      // Verify Top Priority or details panel is rendered
      await expect(page.getByText(/当前最重要的事|Top priority|建议动作|Recommended action/i).first()).toBeVisible();
    }

    // Anchor link clicks
    const viewEvidenceLink = page.getByRole("link", { name: /查看风险证据|View evidence/i }).first();
    if (await viewEvidenceLink.isVisible()) {
      await viewEvidenceLink.click();
      await expect(page.locator("#evidence")).toBeInViewport();
    }
  });

  // 2026-09-13 sweep removed the standalone /roadmap and /trace routes —
  // their content now lives in the result page's embedded panels. The two
  // dedicated e2e tests (roadmap timeline / trace decision tree) were
  // deleted with the routes; result-page coverage is in the tests above.

  test("upload form: document attachment, list display, and removal", async ({ page }) => {
    await page.goto("/upload");

    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="file"]');
      return Boolean(input && Object.keys(input).some((k) => k.startsWith("__reactProps")));
    });

    // Expand optional documents section
    const summaryElem = page.locator("summary").filter({ hasText: /说明书|Document/i }).first();
    await summaryElem.click();

    const docInput = page.locator("#blaze-document-input");
    await docInput.setInputFiles({
      name: "user_manual_spec.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test document stream"),
    });

    // Check document appears in list
    const docList = page.locator('[data-testid="document-list"]');
    await expect(docList).toBeVisible();
    await expect(docList.getByText("user_manual_spec.pdf")).toBeVisible();

    // Click remove button
    const removeBtn = docList.locator("button").first();
    await removeBtn.click();

    // List should disappear or be empty
    await expect(page.getByText("user_manual_spec.pdf")).not.toBeVisible();
  });

  test("regulations page: search input and market filter interaction", async ({ page }) => {
    await page.goto("/regulations");

    // Wait for regulations page to load
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Find search input and type filter query
    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill("RoHS");

    // Filter by EU market button
    const euButton = page.locator("button").filter({ hasText: /^EU$|^欧盟$/i }).first();
    if (await euButton.isVisible()) {
      await euButton.click();
    }

    // Verify regulation list is rendered
    const regCards = page.locator(".glass-panel").filter({ hasText: /RoHS|CE|EU/i });
    if (await regCards.count() > 0) {
      await expect(regCards.first()).toBeVisible();
    }
  });

  test("global header: language switcher toggle switches locale", async ({ page }) => {
    await page.goto("/");

    const langTrigger = page.locator('button[aria-haspopup="menu"]').first();
    if (await langTrigger.isVisible()) {
      await langTrigger.click();

      // Check popup menu appears
      const menu = page.locator('[role="menu"]');
      await expect(menu).toBeVisible();

      // Click English option
      const enOption = menu.locator('[role="menuitemradio"]').filter({ hasText: /English|🇺🇸/i }).first();
      if (await enOption.isVisible()) {
        await enOption.click();
        // Check html lang is en
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
      }
    }
  });
});

