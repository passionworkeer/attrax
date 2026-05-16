"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "@/lib/i18n";
import AgentDecisionTree from "@/components/trace/AgentDecisionTree";

const translations = {
  zh: {
    title: "AI 决策过程",
    subtitle: "查看 Agent 如何分析产品合规性",
    demo: "查看 Demo",
    reset: "重置",
    running: "运行中...",
    executionTime: "执行时间",
    steps: "执行步骤",
  },
  en: {
    title: "AI Decision Process",
    subtitle: "See how the Agent analyzes product compliance",
    demo: "View Demo",
    reset: "Reset",
    running: "Running...",
    executionTime: "Execution Time",
    steps: "Steps",
  },
};

export default function TracePage() {
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [showDemo, setShowDemo] = useState(false);

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

        {/* Demo Toggle */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => setShowDemo(!showDemo)}
            className={`rounded-lg px-4 py-2 font-medium transition-colors ${
              showDemo
                ? "bg-blaze-red text-white"
                : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
            }`}
          >
            {showDemo ? "✓ " : ""}{t.demo}
          </button>
          {showDemo && (
            <button
              onClick={() => setShowDemo(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              {t.reset}
            </button>
          )}
        </div>

        {/* Decision Tree */}
        {showDemo && (
          <AgentDecisionTree locale={locale} />
        )}

        {/* Not showing demo */}
        {!showDemo && (
          <div className="rounded-xl bg-white p-12 text-center border border-gray-200">
            <div className="mb-4 text-6xl">🔍</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              {locale === "en" ? "Interactive Demo" : "交互式演示"}
            </h3>
            <p className="text-gray-600 mb-6">
              {locale === "en"
                ? "Click the button above to see how the AI analyzes a product and makes compliance decisions"
                : "点击上方按钮查看 AI 如何分析产品并做出合规决策"}
            </p>
            <button
              onClick={() => setShowDemo(true)}
              className="rounded-lg bg-blaze-red px-6 py-3 font-medium text-white hover:bg-blaze-red/90 transition-colors"
            >
              {t.demo}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}