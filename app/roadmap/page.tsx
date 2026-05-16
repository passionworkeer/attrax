"use client";

import { useState, useEffect } from "react";
import ComplianceTimeline from "@/components/trace/ComplianceTimeline";
import { Target, Clock, DollarSign, Sparkles, TrendingUp } from "lucide-react";

const translations = {
  zh: {
    title: "合规路线图",
    subtitle: "从评估到产品上市的全流程时间规划",
    totalDays: "总工期",
    totalCost: "预估总费用",
    steps: "步骤数",
    progress: "完成度",
  },
  en: {
    title: "Compliance Roadmap",
    subtitle: "Full timeline from assessment to market launch",
    totalDays: "Total Days",
    totalCost: "Est. Cost",
    steps: "Steps",
    progress: "Progress",
  },
};

export default function RoadmapPage() {
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
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-green-50 to-emerald-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-green-50/30 to-emerald-50/30">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-green-50 via-emerald-50 to-teal-50 border-b border-green-200/50">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg">
                <Target className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-black text-gray-900">{t.title}</h1>
                <p className="text-gray-500">{t.subtitle}</p>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4">
              <div className="text-center px-5 py-3 bg-white rounded-2xl shadow-md border border-green-100">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-green-500" />
                  <div className="text-2xl font-black text-gray-900">63</div>
                </div>
                <div className="text-xs text-gray-500">{t.totalDays}</div>
              </div>
              <div className="text-center px-5 py-3 bg-white rounded-2xl shadow-md border border-green-100">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-500" />
                  <div className="text-lg font-black text-gray-900">¥20K+</div>
                </div>
                <div className="text-xs text-gray-500">{t.totalCost}</div>
              </div>
              <div className="text-center px-5 py-3 bg-white rounded-2xl shadow-md border border-green-100">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-green-500" />
                  <div className="text-2xl font-black text-gray-900">7</div>
                </div>
                <div className="text-xs text-gray-500">{t.steps}</div>
              </div>
              <div className="text-center px-5 py-3 bg-white rounded-2xl shadow-md border border-green-100">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-500" />
                  <div className="text-2xl font-black text-gray-900">14%</div>
                </div>
                <div className="text-xs text-gray-500">{t.progress}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        <ComplianceTimeline locale={locale} autoPlay={false} />
      </div>
    </div>
  );
}