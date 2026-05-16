"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "@/lib/i18n";
import ComplianceTimeline from "@/components/trace/ComplianceTimeline";

const translations = {
  zh: {
    title: "合规路线图",
    subtitle: "从评估到上市的时间规划",
    viewTimeline: "查看时间线",
    hideTimeline: "收起",
  },
  en: {
    title: "Compliance Roadmap",
    subtitle: "Timeline from assessment to market launch",
    viewTimeline: "View Timeline",
    hideTimeline: "Hide",
  },
};

export default function RoadmapPage() {
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [showTimeline, setShowTimeline] = useState(true);

  const t = translations[locale];

  useEffect(() => {
    const stored = localStorage.getItem("locale") as "zh" | "en";
    if (stored && ["zh", "en"].includes(stored)) {
      setLocale(stored);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-6">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{t.title}</h1>
          <p className="text-gray-600">{t.subtitle}</p>
        </div>

        {/* Timeline */}
        {showTimeline && <ComplianceTimeline locale={locale} />}

        {/* Toggle Button */}
        <div className="mt-6 text-center">
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className="rounded-lg bg-white px-6 py-3 font-medium text-gray-700 border border-gray-200 hover:bg-gray-100 transition-colors"
          >
            {showTimeline ? t.hideTimeline : t.viewTimeline}
          </button>
        </div>
      </div>
    </div>
  );
}