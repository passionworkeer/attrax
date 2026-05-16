"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Locale = "zh" | "en";

const translations = {
  zh: {
    common: {
      loading: "加载中...",
      error: "错误",
      retry: "重试",
      submit: "提交",
      cancel: "取消",
      save: "保存",
      delete: "删除",
      edit: "编辑",
      search: "搜索",
      filter: "筛选",
      language: "语言",
      home: "首页",
    },
    home: {
      title: "火鹰合规",
      subtitle: "想出海？先烧毁！",
      description: "AI驱动的跨境电商合规风险智能扫描平台",
      startScanning: "开始扫描",
      features: {
        title: "核心功能",
        multiMarket: "多市场覆盖",
        multiMarketDesc: "覆盖欧盟、美国、英国、中国、澳大利亚、沙特、阿联酋等16+市场",
        fastAnalysis: "快速分析",
        fastAnalysisDesc: "5分钟内获得完整合规报告",
        preciseCitations: "精确条款引用",
        preciseCitationsDesc: "附带法规编号和页码的精确引用",
        actionableAdvice: "可执行建议",
        actionableAdviceDesc: "包含预估费用的具体整改步骤",
      },
      stats: {
        markets: "市场",
        regulations: "法规",
        users: "用户",
      },
      regulations: {
        title: "法规更新",
        recentUpdates: "最新更新",
        viewAll: "查看全部",
        noUpdates: "暂无更新",
      },
    },
  },
  en: {
    common: {
      loading: "Loading...",
      error: "Error",
      retry: "Retry",
      submit: "Submit",
      cancel: "Cancel",
      save: "Save",
      delete: "Delete",
      edit: "Edit",
      search: "Search",
      filter: "Filter",
      language: "Language",
      home: "Home",
    },
    home: {
      title: "Blaze Hawks",
      subtitle: "Think Before You Expand",
      description: "AI-powered compliance risk scanning for cross-border e-commerce",
      startScanning: "Start Scanning",
      features: {
        title: "Key Features",
        multiMarket: "Multi-Market Coverage",
        multiMarketDesc: "Covering 16+ markets including EU, US, UK, CN, AU, SA, AE",
        fastAnalysis: "Fast Analysis",
        fastAnalysisDesc: "Get complete compliance report in 5 minutes",
        preciseCitations: "Precise Citations",
        preciseCitationsDesc: "Legal references with Article No. and page numbers",
        actionableAdvice: "Actionable Advice",
        actionableAdviceDesc: "Specific remediation steps with estimated costs",
      },
      stats: {
        markets: "Markets",
        regulations: "Regulations",
        users: "Users",
      },
      regulations: {
        title: "Regulation Updates",
        recentUpdates: "Recent Updates",
        viewAll: "View All",
        noUpdates: "No recent updates",
      },
    },
  },
};

interface TranslationContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const TranslationContext = createContext<TranslationContextType | null>(null);

export function TranslationProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("zh");

  useEffect(() => {
    const stored = localStorage.getItem("locale") as Locale;
    if (stored && ["zh", "en"].includes(stored)) {
      setLocale(stored);
    } else {
      const browserLang = navigator.language.toLowerCase();
      if (browserLang.startsWith("en")) {
        setLocale("en");
      }
    }
  }, []);

  const handleSetLocale = (newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem("locale", newLocale);
    document.documentElement.lang = newLocale;
  };

  const t = (key: string): string => {
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