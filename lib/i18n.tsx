"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { translations } from "./i18n/translations";

export type Locale = "zh" | "en";

interface TranslationContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const TranslationContext = createContext<TranslationContextType | null>(null);

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "zh";

  const stored = localStorage.getItem("locale") as Locale | null;
  if (stored && ["zh", "en"].includes(stored)) return stored;

  return navigator.language.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("zh");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocale(detectInitialLocale());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const handleSetLocale = (newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem("locale", newLocale);
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    const keys = key.split(".");
    let value: unknown = translations[locale];

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        return key;
      }
    }

    let result = typeof value === "string" ? value : key;
    if (params) {
      for (const [pKey, pVal] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{${pKey}\\}`, "g"), String(pVal));
      }
    }
    return result;
  };

  return (
    <TranslationContext.Provider value={{ locale, setLocale: handleSetLocale, t }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error("useTranslation must be used within a TranslationProvider");
  }
  return context;
}

/** Non-React translation lookup — usable in Node.js / server-side utilities. */
export function getTranslations(locale: Locale = "zh") {
  return translations[locale];
}

/** Lookup a translation key from a locale string (for server-side use). */
export function t(key: string, locale: Locale = "zh", params?: Record<string, string | number>): string {
  const keys = key.split(".");
  let value: unknown = translations[locale];
  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }
  let result = typeof value === "string" ? value : key;
  if (params) {
    for (const [pKey, pVal] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${pKey}\\}`, "g"), String(pVal));
    }
  }
  return result;
}
