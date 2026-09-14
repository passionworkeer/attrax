import { expect, test } from "@playwright/test";

const TEST_IMAGE = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360f8cf00000301010118dd8db00000000049454e44ae426082",
  "hex"
);

function unwrap<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as { success?: unknown; data?: unknown };
  if (response.success === true) return response.data as T;
  return payload as T;
}

test.describe("upload scan result flow", () => {
  test("uploads an image, polls scan progress, and renders the result page", async ({ page, request }) => {
    test.setTimeout(180_000);

    await page.goto("/upload");
    await page.waitForFunction(() => {
      const input = document.querySelector('input[type="file"]');
      return Boolean(input && Object.keys(input).some((key) => key.startsWith("__reactProps")));
    });

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "product.png",
      mimeType: "image/png",
      buffer: TEST_IMAGE,
    });

    await expect(page.getByText(/1\/3 张已就绪|1\/3 ready/i)).toBeVisible();

    const submit = page.locator('button[type="submit"]');
    await expect(submit).toBeEnabled();

    const scanResponsePromise = page.waitForResponse((response) => {
      return response.url().endsWith("/api/scan") && response.request().method() === "POST";
    });

    await submit.click();

    const scanResponse = await scanResponsePromise;
    expect(scanResponse.status()).toBe(202);

    const rawStartPayload: unknown = await scanResponse.json();
    const startPayload = unwrap<{
      sessionId: string;
      accessToken: string;
      status: "processing";
      pollUrl: string;
    }>(rawStartPayload);

    expect(startPayload?.sessionId).toMatch(/^scan_/);
    expect(startPayload?.accessToken).toBeTruthy();

    const { sessionId, accessToken } = startPayload!;
    await expect(page).toHaveURL(new RegExp(`/burning/${sessionId}$`));
    await expect(page.locator("body")).toContainText(/分析|检索|生成|完成|retrieving|generating|report generation complete/i, { timeout: 20_000 });

    await page.waitForURL(new RegExp(`/result/${sessionId}$`), { timeout: 150_000 });

    const resultResponse = await request.get(`/api/scan/${sessionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(resultResponse.status()).toBe(200);

    const rawResultPayload: unknown = await resultResponse.json();
    const resultPayload = unwrap<{
      status: "processing" | "ready" | "degraded" | "failed";
      result?: { complianceScore?: number; source?: "real" | "fallback" | "demo" };
      profitReport?: unknown;
    }>(rawResultPayload);

    // The 1×1 test pixel carries no product features. The real LLM pipeline
    // is non-deterministic on such input: it may recognize a charger-like
    // product (full result page) or fail to build a report package at all —
    // in which case the scan degrades (MISSING_REPORT_PACKAGE) and the result
    // page renders the honest incomplete panel (fail-closed, NOT a crash).
    // Both outcomes are acceptable; a blank/500/dead page is not.
    if (resultPayload?.status === "ready") {
      await expect(
        page.getByRole("heading", { name: /便携式充电器|Charger|型号待确认|model TBD/i }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /合规分析报告|Compliance Report/i }),
      ).toBeVisible();
      expect(typeof resultPayload?.result?.complianceScore).toBe("number");
      expect(["real", "fallback", "demo"]).toContain(resultPayload?.result?.source);
    } else {
      // Degraded path: the page must still render the incomplete panel with
      // an explanation — never a raw error/blank screen.
      expect(["degraded", "failed"]).toContain(resultPayload?.status);
      await expect(page.locator("body")).toContainText(/未返回|风险证据|扫描失败|unavailable|failed|evidence/i);
    }
    // Either way the browser survived the full upload → poll → result journey.
    await expect(page.getByText(/Not Found|Application error|Lost in the smoke/i)).toHaveCount(0);
  });
});
