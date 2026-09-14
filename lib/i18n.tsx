"use client";

import { useCallback } from "react";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { translations } from "./i18n/translations";

export type Locale = "zh" | "en";

function lookupKey(locale: Locale, key: string): string {
  const keys = key.split(".");
  let value: unknown = translations[locale];

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }

  return typeof value === "string" ? value : key;
}

function applyParams(value: string, params?: Record<string, string | number>): string {
  if (!params) return value;
  let result = value;
  for (const [pKey, pVal] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${pKey}\\}`, "g"), String(pVal));
  }
  return result;
}

/**
 * Hook-only translation helper. Locale is sourced from `BlazeLocaleProvider`
 * (the single source of truth for the app), and `t()` looks up keys from the
 * shared translation table.
 *
 * History: this module used to export a parallel `TranslationProvider` that
 * sat alongside `BlazeLocaleProvider`. The provider was redundant — locale
 * already lives in `BlazeLocaleProvider`, and the only thing this hook needs
 * is a stable locale + lookup table. The provider was dropped in the i18n
 * consolidation (2026-09-14); consumers that previously rendered with
 * `<TranslationProvider>` now wrap with `<BlazeLocaleProvider>`.
 */
export function useTranslation() {
  const { locale, setLocale } = useBlazeLocale();

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string =>
      applyParams(lookupKey(locale, key), params),
    [locale],
  );

  return { t, locale, setLocale };
}

/** Non-React translation lookup — usable in Node.js / server-side utilities. */
export function getTranslations(locale: Locale = "zh") {
  return translations[locale];
}

/** Lookup a translation key from a locale string (for server-side use). */
export function t(
  key: string,
  locale: Locale = "zh",
  params?: Record<string, string | number>,
): string {
  return applyParams(lookupKey(locale, key), params);
}