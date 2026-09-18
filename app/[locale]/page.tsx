"use client";

import React, { useEffect } from "react";
import { CompliPilotHome } from "@/components/complipilot/homepage";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";

interface PageProps {
  params: Promise<{ locale: string }>;
}

type Locale = "zh" | "en";

function normalizeLocale(locale: string): Locale {
  return locale === "en" ? "en" : "zh";
}

export default function LocalizedHome({ params }: PageProps) {
  const { locale: rawLocale } = React.use(params);
  const locale = normalizeLocale(rawLocale);
  const { locale: currentLocale, setLocale } = useBlazeLocale();

  useEffect(() => {
    if (locale !== currentLocale) {
      setLocale(locale);
    }
  }, [locale, currentLocale, setLocale]);

  return <CompliPilotHome initialLocale={locale} />;
}
