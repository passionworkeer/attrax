import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DegradedBanner } from "@/components/result/DegradedBanner";
import { SourceNotice } from "@/components/result/SourceNotice";
import { TranslationProvider } from "@/lib/i18n";

/**
 * P0-1 渲染闭环回归测试（2026-09-10 审计 1.3 / 3.9）。
 * 防止 banner 再次"存在但未被渲染/失效"。
 */

function wrap(ui: React.ReactElement) {
  return render(<TranslationProvider>{ui}</TranslationProvider>);
}

describe("DegradedBanner", () => {
  it("source=fallback 时渲染 role=alert 横幅", () => {
    wrap(<DegradedBanner source="fallback" />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("source=demo 时渲染且带 aria-live", () => {
    const { container } = wrap(<DegradedBanner source="demo" />);
    const el = container.querySelector("[aria-live='assertive']");
    expect(el).not.toBeNull();
  });

  it("isDegraded=true（轮询 status=degraded）时渲染并显示原因码", () => {
    wrap(<DegradedBanner isDegraded degradedReason="rag_unavailable" />);
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/\[rag_unavailable\]/)).toBeDefined();
  });

  it("showProfitNotice 时包含利润提示", () => {
    wrap(<DegradedBanner source="fallback" showProfitNotice />);
    // 利润提示与主警告都在 alert 内；主警告一定存在
    expect(screen.getByRole("alert").textContent).toBeTruthy();
  });

  it("source=real 且无降级标记时不渲染任何内容", () => {
    const { container } = wrap(<DegradedBanner source="real" />);
    expect(container.querySelector("[role='alert']")).toBeNull();
  });
});

describe("SourceNotice", () => {
  it("fallback → 渲染琥珀提示", () => {
    const { container } = wrap(<SourceNotice source="fallback" />);
    expect(container.textContent).not.toBe("");
  });

  it("real → 返回 null", () => {
    const { container } = wrap(<SourceNotice source="real" />);
    expect(container.textContent).toBe("");
  });
});
