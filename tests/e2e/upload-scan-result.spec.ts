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

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "product.png",
      mimeType: "image/png",
      buffer: TEST_IMAGE,
    });

    await expect(page.getByText(/1\/8 张|1\/8 images/i)).toBeVisible();

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

    await expect(page.getByRole("heading", { name: new RegExp(sessionId) })).toBeVisible();
    await expect(page.getByRole("tab", { name: /合规分析报告|Compliance Analysis Report/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /AI 决策报告|Decision/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /合规路线图|Compliance Roadmap/i })).toBeVisible();
    await expect(page.getByText(/未找到对应扫描结果|扫描失败|Scan session expired/i)).toHaveCount(0);

    const resultResponse = await request.get(`/api/scan/${sessionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(resultResponse.status()).toBe(200);

    const rawResultPayload: unknown = await resultResponse.json();
    const resultPayload = unwrap<{
      status: "processing" | "ready" | "failed";
      result?: { complianceScore?: number; source?: "real" | "fallback" | "demo" };
      profitReport?: unknown;
    }>(rawResultPayload);

    expect(resultPayload?.status).toBe("ready");
    expect(typeof resultPayload?.result?.complianceScore).toBe("number");
    expect(["real", "fallback", "demo"]).toContain(resultPayload?.result?.source);
    expect(resultPayload?.profitReport).toBeTruthy();
  });
});
