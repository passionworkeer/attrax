/**
 * J18 —— 能力边界诚实标注：定价页与 404 页行为回归。
 *
 * 定价页：
 *   - 不再出现 `.example` 邮箱（mailto）
 *   - 未实现服务（专属客服/认证绿色通道/私有化部署）标注「规划中」，
 *     不再列成已包含权益
 *   - 不再出现旧 FAISS 文案
 *   - 返回链接统一回主导航（/），不再跳 /profit/demo
 * 404 页（J18）：
 *   - 中文「页面未找到」+ 说明 + 返回首页/法规示例链接
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean; priority?: boolean }) => {
    const { fill, unoptimized, priority, ...imageProps } = props;
    void fill;
    void unoptimized;
    void priority;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} alt={imageProps.alt ?? ""} />;
  },
}));

vi.mock("@/components/blaze-hawks/locale", () => ({
  useBlazeLocale: () => ({ locale: "zh", setLocale: vi.fn() }),
}));

import PricingPage from "@/app/pricing/page";
import NotFound from "@/app/not-found";

describe("J18: 定价页 — 未实现服务与联系方式诚实标注", () => {
  it("不出现 .example 邮箱 / mailto 链接，改为「联系邮箱待配置（规划中）」", () => {
    const { container } = render(<PricingPage />);

    const mailtoLinks = container.querySelectorAll('a[href^="mailto:"]');
    expect(mailtoLinks).toHaveLength(0);

    expect(screen.getByText(/联系邮箱待配置（规划中）/)).toBeInTheDocument();
    expect(screen.getByText(/未接入客服通道/)).toBeInTheDocument();
  });

  it("专属客服 / 认证绿色通道 / 私有化部署标注「规划中」，不在方案权益里列成已包含", () => {
    render(<PricingPage />);

    // 方案权益区（三张价格卡）不应再把未实现服务列为已包含
    const planCards = screen
      .getAllByText(/每月 10 个 SKU 完整报告/)
      .map((node) => node.closest("article"));
    expect(planCards.length).toBeGreaterThan(0);
    const planSectionText = planCards.map((card) => card?.textContent ?? "").join("\n");
    expect(planSectionText).not.toContain("认证绿色通道");
    expect(planSectionText).not.toContain("专属客服支持");

    // 规划中区块明确列出这些服务并打上「规划中」标签
    expect(screen.getByText(/尚未交付的服务（路线图）/)).toBeInTheDocument();
    expect(screen.getByText(/以下服务当前不在任何方案的已包含权益内/)).toBeInTheDocument();
    expect(screen.getByText("专属客服支持")).toBeInTheDocument();
    expect(screen.getByText(/认证绿色通道（对接实验室 \/ 认证机构）/)).toBeInTheDocument();
    expect(screen.getByText(/私有化部署（法规库与产品数据留在内网）/)).toBeInTheDocument();
  });

  it("不再出现 FAISS 旧文案（J18：定价页私有部署旧描述引用 FAISS 索引）", () => {
    const { container } = render(<PricingPage />);
    expect(container.textContent).not.toContain("FAISS");
  });

  it("返回链接统一回主导航 /，不再跳 /profit/demo（缺上下文的返回）", () => {
    const { container } = render(<PricingPage />);
    const profitLinks = container.querySelectorAll('a[href="/profit/demo"]');
    expect(profitLinks).toHaveLength(0);

    // 页眉返回 + 底部返回均指向首页
    const homeLinks = container.querySelectorAll('a[href="/"]');
    expect(homeLinks.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/返回成本结果页/)).toBeNull();
    expect(screen.queryByText(/返回利润页/)).toBeNull();
  });
});

describe("J18: 404 页中文化", () => {
  it("主标题为中文「页面未找到」，不再是英文 \"Lost in the smoke.\"", () => {
    const { container } = render(<NotFound />);

    expect(screen.getByRole("heading", { name: "页面未找到" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("Lost in the smoke");
    // 保留英文辅助行
    expect(screen.getByText(/Page not found/i)).toBeInTheDocument();
  });

  it("提供返回首页与法规动态示例链接", () => {
    render(<NotFound />);
    const home = screen.getByRole("link", { name: /返回首页/ });
    expect(home).toHaveAttribute("href", "/");
    const regulations = screen.getByRole("link", { name: /法规动态示例/ });
    expect(regulations).toHaveAttribute("href", "/regulations");
  });
});
