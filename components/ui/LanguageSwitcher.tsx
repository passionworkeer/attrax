"use client";

import { useState } from "react";
import { Globe, ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

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
        className="flex items-center gap-2 rounded-2xl border border-white/60 bg-white/85 px-3 py-2 shadow-sm backdrop-blur transition-colors hover:bg-white/90"
        aria-label={t("language")}
      >
        <Globe className="h-4 w-4 text-blaze-red" />
        <span className="text-sm font-medium text-foreground">
          {currentLang.flag} {t(currentLang.nameKey)}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-2xl border border-white/60 bg-white/85 shadow-lg backdrop-blur">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  setLocale(lang.code as "zh" | "en");
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                  locale === lang.code
                    ? "bg-blaze-red/10 text-blaze-red"
                    : "text-foreground hover:bg-muted/80"
                }`}
              >
                <span className="text-lg">{lang.flag}</span>
                <span className="font-medium">{t(lang.nameKey)}</span>
                {locale === lang.code && (
                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}