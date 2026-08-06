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

    // 结果页没有任何 heading 渲染 sessionId(主 h1 是产品名)。demo 默认 electronics
    // 类目 → 产品名「ZGA 便携式充电器」,与 smoke/export-downloads 同 convention,
    // 用 .first() 因为报告标题 h1 也含该产品名。
    await expect(page.getByRole("heading", { name: /便携式充电器|Charger/i }).first()).toBeVisible();
    // 结果页改版后无 tab 模型;合规报告区是 h3「合规分析报告」,路线图是导出卡片文本。
    // (旧「AI 决策报告」tab 随改版移除,不再断言。)
    await expect(page.getByRole("heading", { name: /合规分析报告|Compliance Report/i })).toBeVisible();
    await expect(page.getByText(/合规路线图|Compliance Roadmap/i).first()).toBeVisible();
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
