"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";

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

        <nav className="hidden md:flex items-center gap-2">
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
        </div>
      </div>
    </header>
  );
}
