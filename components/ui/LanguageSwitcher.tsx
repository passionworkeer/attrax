"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Globe, ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const languages = [
  { code: "zh", nameKey: "language.zh", flag: "🇨🇳" },
  { code: "en", nameKey: "language.en", flag: "🇺🇸" },
] as const;

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const currentIndex = Math.max(
    0,
    languages.findIndex((l) => l.code === locale),
  );
  const currentLang = languages[currentIndex] ?? languages[0];

  const focusItem = useCallback((index: number) => {
    const next = ((index % languages.length) + languages.length) % languages.length;
    itemRefs.current[next]?.focus();
  }, []);

  const open = useCallback(() => {
    setIsOpen(true);
    // Focus the current language item after the menu mounts.
    requestAnimationFrame(() => focusItem(currentIndex));
  }, [currentIndex, focusItem]);

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  // Close on Escape / outside click handled by overlay; keyboard handled on menu.
  useEffect(() => {
    if (!isOpen) return;
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onDocKey);
    return () => document.removeEventListener("keydown", onDocKey);
  }, [isOpen, close]);

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const focused = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(focused < 0 ? 0 : focused + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(focused < 0 ? languages.length - 1 : focused - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(languages.length - 1);
    }
  }

  function selectLang(code: "zh" | "en") {
    setLocale(code);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t("common.language")}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-200 backdrop-blur transition-all hover:border-blaze-red/40 hover:bg-slate-900 hover:text-white"
      >
        <Globe className="h-4 w-4 text-blaze-red" />
        <span className="hidden sm:inline">
          {currentLang.flag} {t(currentLang.nameKey)}
        </span>
        <span className="sm:hidden">{currentLang.flag}</span>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden="true" />
          <div
            ref={menuRef}
            role="menu"
            aria-label={t("common.language")}
            onKeyDown={handleMenuKeyDown}
            className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-white/10 bg-slate-900/95 shadow-2xl shadow-black/60 backdrop-blur-xl"
          >
            {languages.map((lang, i) => {
              const selected = locale === lang.code;
              return (
                <button
                  key={lang.code}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectLang(lang.code as "zh" | "en")}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                    selected
                      ? "bg-blaze-red/15 text-blaze-red"
                      : "text-slate-200 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <span className="text-base">{lang.flag}</span>
                  <span className="font-medium">{t(lang.nameKey)}</span>
                  {selected && (
                    <svg className="ml-auto h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
