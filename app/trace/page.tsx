"use client";

import { useState, useEffect } from "react";
import AgentDecisionTree from "@/components/trace/AgentDecisionTree";
import { Globe, Zap, BarChart3, ChevronRight, Sparkles, Clock, Target, FileSearch } from "lucide-react";

const translations = {
  zh: {
    title: "AI 决策过程",
    subtitle: "查看 Agent 如何分析产品合规性并生成报告",
    executionTime: "执行时间",
    steps: "执行步骤",
    markets: "扫描市场",
    regulations: "相关法规",
    feature1Title: "实时分析",
    feature1Desc: "观看 AI Agent 实时分析您的产品，从图片上传到合规报告",
    feature2Title: "多市场覆盖",
    feature2Desc: "同时扫描欧盟、美国、中国及10+市场的法规",
    feature3Title: "可执行建议",
    feature3Desc: "获取带有截止日期、成本和预期结果的就绪行动项目",
  },
  en: {
    title: "AI Decision Process",
    subtitle: "See how the Agent analyzes product compliance",
    executionTime: "Execution Time",
    steps: "Steps",
    markets: "Markets Scanned",
    regulations: "Regulations Found",
    feature1Title: "Real-time Analysis",
    feature1Desc: "Watch the AI agent analyze your product in real-time, from image upload to compliance report",
    feature2Title: "Multi-market Coverage",
    feature2Desc: "Simultaneously scan regulations from EU, US, China and 10+ other markets",
    feature3Title: "Actionable Insights",
    feature3Desc: "Get prioritized action items with deadlines, costs, and expected outcomes",
  },
};

export default function TracePage() {
  const [locale, setLocale] = useState<"zh" | "en">("zh");
  const [mounted, setMounted] = useState(false);

  const t = translations[locale];

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("locale") as "zh" | "en";
    if (stored && ["zh", "en"].includes(stored)) {
      setLocale(stored);
    }
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50 to-indigo-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-purple-50/30 to-indigo-50/30">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-blaze-red/5 via-rose-50 to-amber-50 border-b border-blaze-red/10">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center shadow-lg">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-4xl font-black text-gray-900">{t.title}</h1>
                  <p className="text-gray-500">{t.subtitle}</p>
                </div>
              </div>
            </div>
            
            {/* Stats */}
            <div className="flex items-center gap-6">
              <div className="text-center px-6 py-3 bg-white rounded-2xl shadow-md border">
                <div className="flex items-center gap-2 justify-center text-3xl font-black text-blaze-red">
                  <Clock className="w-6 h-6" />
                  8.8s
                </div>
                <div className="text-xs text-gray-500">{t.executionTime}</div>
              </div>
              <div className="text-center px-6 py-3 bg-white rounded-2xl shadow-md border">
                <div className="flex items-center gap-2 justify-center text-3xl font-black text-purple-600">
                  <Target className="w-6 h-6" />
                  9
                </div>
                <div className="text-xs text-gray-500">{t.steps}</div>
              </div>
              <div className="text-center px-6 py-3 bg-white rounded-2xl shadow-md border">
                <div className="flex items-center gap-2 justify-center text-3xl font-black text-green-600">
                  <Sparkles className="w-6 h-6" />
                  4
                </div>
                <div className="text-xs text-gray-500">{t.markets}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        <AgentDecisionTree locale={locale} autoPlay={false} />
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 py-12 border-t border-gray-200">
        <div className="grid grid-cols-3 gap-6">
          <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center mb-4">
              <BarChart3 className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t.feature1Title}</h3>
            <p className="text-sm text-gray-600">{t.feature1Desc}</p>
          </div>
          <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mb-4">
              <Globe className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t.feature2Title}</h3>
            <p className="text-sm text-gray-600">{t.feature2Desc}</p>
          </div>
          <div className="p-6 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mb-4">
              <ChevronRight className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t.feature3Title}</h3>
            <p className="text-sm text-gray-600">{t.feature3Desc}</p>
          </div>
        </div>
      </div>
    </div>
  );
}