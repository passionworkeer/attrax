"use client";

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type BlazeLocale = "zh" | "en";

type BlazeLocaleContextValue = {
  locale: BlazeLocale;
  setLocale: (locale: BlazeLocale) => void;
};

const BlazeLocaleContext = createContext<BlazeLocaleContextValue | null>(null);

const STORAGE_KEY = "complipilot-locale";

export function BlazeLocaleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<BlazeLocale>("zh");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "zh" || stored === "en") setLocaleState(stored);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const setLocale = useCallback((nextLocale: BlazeLocale) => {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    setLocaleState(nextLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.body.dataset.locale = locale;
    const timer = window.setTimeout(() => {
      document.title =
        locale === "zh"
          ? "规航AI · 先合规，再出海"
          : "CompliPilot · Comply Before You Expand";
    }, 0);

    return () => window.clearTimeout(timer);
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
    }),
    [locale, setLocale]
  );

  return (
    <BlazeLocaleContext.Provider value={value}>
      {children}
    </BlazeLocaleContext.Provider>
  );
}

export function useBlazeLocale() {
  const context = useContext(BlazeLocaleContext);
  if (!context) {
    throw new Error("useBlazeLocale must be used within BlazeLocaleProvider");
  }
  return context;
}

/** Allows compatibility providers to share the new frontend locale when present. */
export function useOptionalBlazeLocale() {
  return useContext(BlazeLocaleContext);
}
