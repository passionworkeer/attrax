/**
 * Tests for CompliPilotHome. P2/"second-tab indirect demo" bug: the
 * "查看 60 秒演示" link on the homepage currently points to /upload, which
 * forces users through an extra tab before /result/demo. It should jump
 * straight to /result/demo.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("CompliPilotHome — compliance entry points", () => {
  it("hides preset demo links while preserving the real scan entry", () => {
    const { container } = render(<CompliPilotHome />);
    expect(container.querySelectorAll('a[href*="/result/demo"]')).toHaveLength(0);
    expect(screen.queryByText("查看 60 秒演示")).not.toBeInTheDocument();
    expect(findAnchorByText("开始合规检测")).toHaveAttribute("href", "/upload");
    expect(findAnchorByText("产品方案")).toHaveAttribute("href", "/pricing");
  });
});
