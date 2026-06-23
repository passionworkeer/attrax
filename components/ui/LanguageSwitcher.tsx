"use client";

import { useState } from "react";
import { Globe, ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const languages = [
  { code: "zh", nameKey: "language.zh", flag: "🇨🇳" },
  { code: "en", nameKey: "language.en", flag: "🇺🇸" },
];

export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const currentLang = languages.find((l) => l.code === locale) || languages[0];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2 text-sm font-medium text-slate-200 backdrop-blur transition-all hover:border-blaze-red/40 hover:bg-slate-900 hover:text-white"
        aria-label={t("language")}
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
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-white/10 bg-slate-900/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
            {languages.map((lang) => {
              const selected = locale === lang.code;
              return (
                <button
                  key={lang.code}
                  onClick={() => {
                    setLocale(lang.code as "zh" | "en");
                    setIsOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                    selected
                      ? "bg-blaze-red/15 text-blaze-red"
                      : "text-slate-200 hover:bg-white/5 hover:text-white"
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
