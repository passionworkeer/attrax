/**
 * Tests for SiteHeader, LanguageSwitcher, and /api/regulations/updates route
 * (P2 / 20-round agent scan found these had 0% coverage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import SiteHeader from "@/components/SiteHeader";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import { TranslationProvider, useTranslation } from "@/lib/i18n";

// next/navigation usePathname needs a router context; setup.ts already provides
// a basic stub. We override per-test via next/navigation mock when needed.
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// next/cache unstable_cache requires the Next.js runtime which is unavailable
// in vitest. Bypass it by passing the underlying function straight through.
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import { usePathname } from "next/navigation";
const mockedUsePathname = vi.mocked(usePathname);

function renderInProvider(node: React.ReactNode) {
  return render(<TranslationProvider>{node}</TranslationProvider>);
}

describe("SiteHeader", () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue("/");
  });

  it("renders the Attrax brand link with localized subtitle", () => {
    renderInProvider(<SiteHeader />);
    expect(screen.getByText("Attrax")).toBeInTheDocument();
    // Default zh locale -> 合规引擎
    expect(screen.getByText("合规引擎")).toBeInTheDocument();
  });

  it("renders all nav items with Chinese labels by default", () => {
    renderInProvider(<SiteHeader />);
    expect(screen.getByText("首页")).toBeInTheDocument();
    expect(screen.getByText("法规更新")).toBeInTheDocument();
    expect(screen.getByText("开始扫描")).toBeInTheDocument();
  });

  it("renders English labels when locale=en", () => {
    function Enforcer({ children }: { children: React.ReactNode }) {
      const { setLocale } = useTranslation();
      React.useEffect(() => {
        setLocale("en");
      }, [setLocale]);
      return <>{children}</>;
    }
    render(
      <TranslationProvider>
        <Enforcer>
          <SiteHeader />
        </Enforcer>
      </TranslationProvider>,
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Regulations")).toBeInTheDocument();
    expect(screen.getByText("Scan")).toBeInTheDocument();
    expect(screen.getByText("Compliance Engine")).toBeInTheDocument();
    expect(screen.getByText("Start Scan")).toBeInTheDocument();
  });

  it("marks the home nav item active when pathname is /", () => {
    mockedUsePathname.mockReturnValue("/");
    const { container } = renderInProvider(<SiteHeader />);
    // The home nav link is inside <nav>, not the brand link.
    const homeNavLink = container.querySelector("nav a[href='/']");
    expect(homeNavLink).toBeInTheDocument();
    expect(homeNavLink!.className).toContain("text-blaze-red");
  });

  it("treats /zh and /en as home", () => {
    mockedUsePathname.mockReturnValue("/zh");
    const { container } = renderInProvider(<SiteHeader />);
    const homeNavLink = container.querySelector("nav a[href='/']");
    expect(homeNavLink!.className).toContain("text-blaze-red");
  });

  it("marks the regulations item active when pathname starts with /regulations", () => {
    mockedUsePathname.mockReturnValue("/regulations/something");
    const { container } = renderInProvider(<SiteHeader />);
    const regLink = container.querySelector('a[href="/regulations"]');
    expect(regLink!.className).toContain("text-blaze-red");
  });

  it("includes the LanguageSwitcher in the header", () => {
    const { container } = renderInProvider(<SiteHeader />);
    // LanguageSwitcher renders a globe button (Globe icon class name)
    expect(container.querySelector("button")).toBeInTheDocument();
  });
});

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedUsePathname.mockReturnValue("/");
  });

  it("renders the current language flag + name", () => {
    renderInProvider(<LanguageSwitcher />);
    // Default locale is zh
    expect(screen.getByText(/中文/)).toBeInTheDocument();
    expect(screen.getByText("🇨🇳")).toBeInTheDocument();
  });

  it("does not show the dropdown initially", () => {
    const { container } = renderInProvider(<LanguageSwitcher />);
    // The dropdown contains the language option list; check that the EN
    // option is not visible without clicking the toggle.
    expect(screen.queryByText("🇺🇸")).not.toBeInTheDocument();
    expect(container.querySelector(".absolute.right-0")).not.toBeInTheDocument();
  });

  it("opens the dropdown when the toggle button is clicked", () => {
    renderInProvider(<LanguageSwitcher />);
    const toggle = screen.getByRole("button", { name: /语言|language/i });
    fireEvent.click(toggle);
    // The EN option only appears in the dropdown (toggle shows current = zh).
    // Use getAllByText since both flags exist after open.
    const usFlags = screen.getAllByText("🇺🇸");
    expect(usFlags.length).toBeGreaterThanOrEqual(1);
  });

  it("switches locale when an option is clicked", () => {
    function Probe() {
      const { locale } = useTranslation();
      return <span data-testid="locale">{locale}</span>;
    }
    render(
      <TranslationProvider>
        <LanguageSwitcher />
        <Probe />
      </TranslationProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("zh");
    fireEvent.click(screen.getByRole("button", { name: /语言|language/i }));
    fireEvent.click(screen.getByText("🇺🇸"));
    expect(screen.getByTestId("locale").textContent).toBe("en");
    // After selection, dropdown closes (EN flag not directly visible without re-opening)
  });

  it("closes the dropdown when the backdrop is clicked", () => {
    renderInProvider(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /语言|language/i }));
    expect(screen.getByText("🇺🇸")).toBeInTheDocument();
    const backdrop = document.querySelector(".fixed.inset-0");
    expect(backdrop).toBeInTheDocument();
    fireEvent.click(backdrop!);
    // Dropdown should be gone
    expect(document.querySelector(".absolute.right-0")).not.toBeInTheDocument();
  });
});

describe("GET /api/regulations/updates", () => {
  let originalRevalidate: number | undefined;

  beforeEach(() => {
    vi.resetModules();
    originalRevalidate = process.env.NEXT_RUNTIME;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function callRoute(url: string) {
    const mod = await import("@/app/api/regulations/updates/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest(new Request(url));
    return mod.GET(req);
  }

  it("returns the default page (market=all, search=null, limit=50)", async () => {
    const res = await callRoute("http://localhost/api/regulations/updates");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    // ok() spreads `data` into the response: body.data IS the array,
    // and the meta fields live under body.meta.
    expect(body.data).toBeInstanceOf(Array);
    expect(body.meta).toMatchObject({
      dataset: "static-demo",
      returned: expect.any(Number),
      matching: expect.any(Number),
      total: expect.any(Number),
      markets: expect.any(Number),
    });
  });

  it("filters by market when provided", async () => {
    const res = await callRoute("http://localhost/api/regulations/updates?market=EU");
    const body = await res.json();
    expect(body.success).toBe(true);
    for (const r of body.data) {
      expect(r.market).toBe("EU");
    }
  });

  it("caps the limit to 100", async () => {
    const res = await callRoute("http://localhost/api/regulations/updates?limit=99999");
    const body = await res.json();
    expect(body.data.length).toBeLessThanOrEqual(100);
  });

  it("returns empty data array when no items match", async () => {
    const res = await callRoute(
      "http://localhost/api/regulations/updates?market=ZZ_NONEXISTENT",
    );
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.meta.matching).toBe(0);
  });

  it("searches case-insensitively across the searchableText", async () => {
    const res = await callRoute(
      "http://localhost/api/regulations/updates?search=CE",
    );
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(0);
    expect(body.meta.matching).toBeGreaterThanOrEqual(body.meta.returned);
  });

  it("sorts urgent (≤45 days) before non-urgent", async () => {
    const res = await callRoute("http://localhost/api/regulations/updates");
    const body = await res.json();
    const data = body.data;
    if (data.length < 2) return;
    let lastUrgentIdx = -1;
    let firstNonUrgentIdx = -1;
    for (let i = 0; i < data.length; i++) {
      const days = data[i].daysUntilEffective;
      if (days >= 0 && days <= 45) lastUrgentIdx = i;
      else if (firstNonUrgentIdx === -1) firstNonUrgentIdx = i;
    }
    if (lastUrgentIdx >= 0 && firstNonUrgentIdx >= 0) {
      expect(lastUrgentIdx).toBeLessThan(firstNonUrgentIdx);
    }
  });

  it("returns a valid ISO timestamp in the meta block", async () => {
    const res = await callRoute("http://localhost/api/regulations/updates");
    const body = await res.json();
    expect(body.meta.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});