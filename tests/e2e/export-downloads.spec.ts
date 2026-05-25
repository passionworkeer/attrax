import { expect, test } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const DOWNLOAD_DIR = path.join(process.cwd(), "test-results", "export-downloads");

type ExportScenario = {
  tab: RegExp;
  downloads: Array<{ button: RegExp; ext: ".pdf" | ".docx" }>;
};

const scenarios: ExportScenario[] = [
  {
    tab: /合规分析报告|Compliance Analysis Report/i,
    downloads: [
      { button: /合规.*PDF ZH|Compliance.*PDF ZH/i, ext: ".pdf" },
      { button: /^Word ZH$/i, ext: ".docx" },
      { button: /合规.*PDF EN|Compliance.*PDF EN/i, ext: ".pdf" },
      { button: /^Word EN$/i, ext: ".docx" },
    ],
  },
  {
    tab: /成本利润报告|Cost & Profit Report/i,
    downloads: [
      { button: /^PDF ZH$/i, ext: ".pdf" },
      { button: /^Word ZH$/i, ext: ".docx" },
      { button: /^PDF EN$/i, ext: ".pdf" },
      { button: /^Word EN$/i, ext: ".docx" },
    ],
  },
  {
    tab: /AI 决策报告|AI Decision Report/i,
    downloads: [
      { button: /决策.*PDF ZH|Decision.*PDF ZH/i, ext: ".pdf" },
      { button: /^Word ZH$/i, ext: ".docx" },
      { button: /决策.*PDF EN|Decision.*PDF EN/i, ext: ".pdf" },
      { button: /^Word EN$/i, ext: ".docx" },
    ],
  },
  {
    tab: /合规路线图|Compliance Roadmap/i,
    downloads: [
      { button: /路线图.*PDF ZH|Roadmap.*PDF ZH/i, ext: ".pdf" },
      { button: /^Word ZH$/i, ext: ".docx" },
      { button: /路线图.*PDF EN|Roadmap.*PDF EN/i, ext: ".pdf" },
      { button: /^Word EN$/i, ext: ".docx" },
    ],
  },
];

test.describe("Report export downloads", () => {
  test("demo result exports PDF and Word files for all report scenarios and languages", async ({ page }) => {
    test.setTimeout(120_000);
    await mkdir(DOWNLOAD_DIR, { recursive: true });

    await page.goto("/result/demo");
    await expect(page.getByRole("heading", { name: /Demo Scan Result|演示扫描结果/i })).toBeVisible();

    for (const scenario of scenarios) {
      await page.getByRole("tab", { name: scenario.tab }).click();
      const panel = page.getByRole("tabpanel").filter({ has: page.getByRole("button", { name: scenario.downloads[0].button }) });
      await expect(panel).toBeVisible();

      for (const item of scenario.downloads) {
        const button = panel.getByRole("button", { name: item.button });
        await expect(button).toBeVisible();

        const [download] = await Promise.all([
          page.waitForEvent("download"),
          button.click(),
        ]);
        const filename = download.suggestedFilename();
        expect(filename.toLowerCase()).toContain(item.ext);

        const savedPath = path.join(DOWNLOAD_DIR, filename);
        await download.saveAs(savedPath);
        const info = await stat(savedPath);
        expect(info.size).toBeGreaterThan(item.ext === ".pdf" ? 1_000 : 2_000);
      }
    }
  });
});
