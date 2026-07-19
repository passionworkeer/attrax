/**
 * Tests for CompliPilotHome. P2/"second-tab indirect demo" bug: the
 * "查看 60 秒演示" link on the homepage currently points to /upload, which
 * forces users through an extra tab before /result/demo. It should jump
 * straight to /result/demo.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

// Mock the homepage's client-only locale hook with a fixed zh locale so the
// assertion is locale-stable. Touching the page text directly would couple us
// to copy changes; we look up via accessible role/name instead.
vi.mock("@/components/blaze-hawks/locale", () => ({
  useBlazeLocale: () => ({
    locale: "zh" as const,
    setLocale: vi.fn(),
  }),
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "zh" }),
}));

import { CompliPilotHome } from "@/components/complipilot/homepage";

function findAnchorByText(exactText: string): HTMLElement | undefined {
  return screen.getAllByRole("link").find(
    (anchor) => anchor.textContent?.trim() === exactText,
  );
}

describe("CompliPilotHome — 60 秒演示 entry point", () => {
  // Open the "关于" dialog first so the in-dialog CTA ("体验合规检测")
  // is in the DOM. The dialog is hidden behind state.default = null.
  const openAboutDialog = (): void => {
    const aboutTrigger = screen.getByRole("button", { name: "关于" });
    fireEvent.click(aboutTrigger);
  };

  it('"查看 60 秒演示" link points directly to /result/demo (no extra tab)', () => {
    render(<CompliPilotHome />);
    const demoLink = findAnchorByText("查看 60 秒演示");
    expect(demoLink, "expected a link with the exact text '查看 60 秒演示'").toBeDefined();
    expect(demoLink).toHaveAttribute("href", "/result/demo");
  });

  it('"查看 60 秒演示" link never points to /upload', () => {
    render(<CompliPilotHome />);
    const demoLink = findAnchorByText("查看 60 秒演示");
    expect(demoLink).toBeDefined();
    expect(demoLink?.getAttribute("href")).not.toBe("/upload");
  });

  it('primary "开始合规检测" link still points to /upload (unchanged)', () => {
    render(<CompliPilotHome />);
    const ctaLink = findAnchorByText("开始合规检测");
    expect(ctaLink).toBeDefined();
    expect(ctaLink).toHaveAttribute("href", "/upload");
  });

  it('nav "开始扫描" link in header still points to /upload (real upload flow)', () => {
    render(<CompliPilotHome />);
    // The header "开始扫描" anchor is rendered without an exact-text match in
    // some versions; locate by href instead.
    const startLink = document.querySelector('a[href="/upload"]');
    expect(startLink).toBeInTheDocument();
  });

  it('nav "演示流程" link points to /result/demo (not /upload, no extra tab)', () => {
    // Another header entry that markets the demo flow to the user. Same fix
    // as "查看 60 秒演示": jump straight to /result/demo.
    render(<CompliPilotHome />);
    const demoFlowLink = findAnchorByText("演示流程");
    expect(demoFlowLink).toBeDefined();
    expect(demoFlowLink).toHaveAttribute("href", "/result/demo");
  });

  it('"体验合规检测" link in about dialog points directly to /result/demo', () => {
    // The "体验合规检测" CTA lives inside the "关于" / about dialog (not the
    // "能做什么" capabilities dialog). Same intent as "查看 60 秒演示":
    // jump to /result/demo, skip the extra tab through /upload.
    render(<CompliPilotHome />);
    openAboutDialog();
    const tryLink = findAnchorByText("体验合规检测");
    expect(tryLink, "expected about dialog to render '体验合规检测' anchor").toBeDefined();
    expect(tryLink).toHaveAttribute("href", "/result/demo");
  });
});
