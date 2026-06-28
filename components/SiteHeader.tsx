"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";

interface NavItem {
  href: string;
  label: string;
  labelEn: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "首页", labelEn: "Home" },
  { href: "/regulations", label: "法规更新", labelEn: "Regulations" },
  { href: "/upload", label: "开始扫描", labelEn: "Scan" },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const { t, locale } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/" || pathname === "/zh" || pathname === "/en";
    return pathname.startsWith(href);
  }

  return (
    <header className="fixed top-0 left-0 w-full z-50 h-20 border-b border-white/10 bg-slate-950/80 backdrop-blur-md shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
      <div className="flex justify-between items-center h-full px-6 max-w-[1440px] mx-auto">
        <Link
          href="/"
          className="flex items-center gap-2 group"
          aria-label={t("home.title")}
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blaze-red to-blaze-orange shadow-[0_0_18px_rgba(217,58,26,0.5)]">
            <Flame className="h-5 w-5 text-white" strokeWidth={2.5} fill="white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-black italic tracking-tighter text-white uppercase">
              Attrax
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-blaze-red/80">
              {locale === "en" ? "Compliance Engine" : "合规引擎"}
            </span>
          </div>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-2" aria-label={locale === "en" ? "Primary" : "主导航"}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative px-4 py-2 text-sm font-semibold tracking-tight transition-colors duration-200",
                  active
                    ? "text-blaze-red"
                    : "text-slate-300 hover:text-blaze-red"
                )}
              >
                {locale === "en" ? item.labelEn : item.label}
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-8 bg-blaze-red shadow-[0_0_8px_rgba(217,58,26,0.7)]" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link
            href="/upload"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-blaze-red px-4 py-2 text-sm font-bold tracking-wide text-white transition-all hover:shadow-[0_0_20px_rgba(217,58,26,0.6)] hover:bg-blaze-red/90 active:scale-95 border border-blaze-red/30"
          >
            <Flame className="h-4 w-4" fill="white" />
            {locale === "en" ? "Start Scan" : "立即扫描"}
          </Link>

          {/* Mobile drawer trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <button
                  type="button"
                  className="md:hidden inline-flex items-center justify-center rounded-lg border border-white/10 bg-slate-900/70 p-2 text-slate-200 hover:text-white hover:border-blaze-red/40 transition-colors"
                  aria-label={locale === "en" ? "Open menu" : "打开菜单"}
                />
              }
            >
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-slate-950/95 border-l border-white/10">
              <SheetHeader className="flex-row items-center justify-between">
                <SheetTitle className="text-base font-bold text-white">
                  {locale === "en" ? "Menu" : "菜单"}
                </SheetTitle>
                <SheetClose
                  render={
                    <button
                      type="button"
                      className="rounded-lg p-2 text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                      aria-label={locale === "en" ? "Close" : "关闭"}
                    />
                  }
                >
                  <X className="h-5 w-5" />
                </SheetClose>
              </SheetHeader>
              <nav
                className="flex flex-col gap-1 px-4 pb-6"
                aria-label={locale === "en" ? "Mobile" : "移动端导航"}
              >
                {NAV_ITEMS.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "rounded-lg px-4 py-3 text-sm font-semibold transition-colors",
                        active
                          ? "bg-blaze-red/15 text-blaze-red"
                          : "text-slate-200 hover:bg-white/5 hover:text-white",
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      {locale === "en" ? item.labelEn : item.label}
                    </Link>
                  );
                })}
                <Link
                  href="/upload"
                  onClick={() => setMobileOpen(false)}
                  className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blaze-red px-4 py-3 text-sm font-bold text-white hover:bg-blaze-red/90 transition-colors"
                >
                  <Flame className="h-4 w-4" fill="white" />
                  {locale === "en" ? "Start Scan" : "立即扫描"}
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
