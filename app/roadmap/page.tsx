"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import ComplianceTimeline from "@/components/trace/ComplianceTimeline";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

interface RoadmapItem {
  id: string;
  date: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  type: "apply" | "test" | "certify" | "complete";
  status: "pending" | "in-progress" | "completed";
  estimatedDays?: number;
  cost?: string;
  documents?: string[];
  documentsEn?: string[];
}

export default function RoadmapPage({ params }: { params: Promise<{ sessionId?: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { t, locale: i18nLocale } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const [roadmapData, setRoadmapData] = useState<{
    product?: string;
    totalDays?: number;
    totalCost?: string;
    progress?: number;
    items?: RoadmapItem[];
  } | null>(null);
  const locale = i18nLocale;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsClient(true);
      setMounted(true);
      const querySessionId = new URLSearchParams(window.location.search).get("sessionId");
      const urlSessionId = resolvedParams?.sessionId;
      const storageSessionId = sessionStorage.getItem("lastSessionId");
      setSessionId(querySessionId || urlSessionId || storageSessionId || "");
    }, 0);

    return () => window.clearTimeout(timer);
  }, [resolvedParams?.sessionId]);

  useEffect(() => {
    if (!sessionId || !isClient) return;

    // 从 API 获取真实路线图数据
    fetch(`/api/roadmap/${sessionId}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.items) {
          setRoadmapData(data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // 同时获取完整扫描结果
    fetch(`/api/scan/${sessionId}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(payload => {
        if (payload?.result) {
          sessionStorage.setItem(`scan:${sessionId}`, JSON.stringify(payload.result));
        }
      })
      .catch(() => {});
  }, [sessionId, isClient]);

  const handleBack = () => {
    if (sessionId) {
      router.push(`/result/${sessionId}`);
    } else {
      router.push("/upload");
    }
  };

  if (!mounted || (sessionId && loading)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-green-50 to-emerald-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">{t("roadmap.loading")}</div>
      </div>
    );
  }

  // 从 API 数据提取统计
  const totalDays = roadmapData?.totalDays || 63;
  const totalCost = roadmapData?.totalCost || "¥20K+";
  const progress = roadmapData?.progress || 14;
  const steps = roadmapData?.items?.length || 7;

  // 使用 API 数据或默认
  const items = roadmapData?.items || _getDefaultRoadmapItems();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-green-50/30 to-emerald-50/30">
      {/* Back Button */}
      <div className="max-w-6xl mx-auto px-6 pt-8">
        <button
          onClick={handleBack}
          className={cn(buttonVariants({ variant: "ghost", size: "default" }), "text-gray-600 hover:text-gray-900")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
            <path d="m15 18-6-6 6-6"/>
          </svg>
          {t("roadmap.backToResult")}
        </button>
      </div>

      {/* Hero Header */}
      <div className="bg-gradient-to-r from-green-50 via-emerald-50 to-teal-50 border-b border-green-200/50">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg">
                <span className="text-2xl font-bold text-white">{t("roadmap.roadmap")}</span>
              </div>
              <div>
                <h1 className="text-4xl font-black text-gray-900">{t("roadmap.title")}</h1>
                <p className="text-gray-500">{t("roadmap.subtitle")}</p>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-4">
              <div className="text-center px-5 py-3 bg-white rounded-2xl shadow-md border border-green-100">
                <div className="text-2xl font-black text-gray-900">{totalDays}</div>
                <div className="text-xs text-gray-500">{t("roadmap.totalDays")}</div>
              </div>
              <div className="text-center px-5 py-3 bg-white rounded-2xl shadow-md border border-green-100">
                <div className="text-lg font-black text-gray-900">{totalCost}</div>
                <div className="text-xs text-gray-500">{t("roadmap.estimatedCost")}</div>
              </div>
              <div className="text-center px-5 py-3 bg-white rounded-2xl shadow-md border border-green-100">
                <div className="text-2xl font-black text-gray-900">{steps}</div>
                <div className="text-xs text-gray-500">{t("roadmap.stepsCount")}</div>
              </div>
              <div className="text-center px-5 py-3 bg-white rounded-2xl shadow-md border border-green-100">
                <div className="text-2xl font-black text-gray-900">{progress}%</div>
                <div className="text-xs text-gray-500">{t("roadmap.progress")}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-12">
        <ComplianceTimeline locale={locale} autoPlay={false} items={items} />
      </div>
    </div>
  );
}

function _getDefaultRoadmapItems(): RoadmapItem[] {
  const now = new Date();
  return [
    {
      id: "1",
      date: now.toISOString().split("T")[0],
      title: "合规评估完成",
      titleEn: "Compliance Assessment Complete",
      description: "AI 系统完成初步合规评估，生成风险报告和改进建议",
      descriptionEn: "AI system completes initial compliance assessment and generates risk report",
      type: "complete",
      status: "completed",
    },
    {
      id: "2",
      date: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "准备申请材料",
      titleEn: "Prepare Application Materials",
      description: "收集产品规格、技术文档、测试报告等申请所需材料",
      descriptionEn: "Gather product specifications, technical documents, test reports",
      type: "apply",
      status: "pending",
      estimatedDays: 7,
      documents: ["产品规格书", "电路原理图", "BOM清单", "说明书"],
      documentsEn: ["Product Specs", "Circuit Schematics", "BOM", "User Manual"],
    },
    {
      id: "3",
      date: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "选择认证机构",
      titleEn: "Select Certification Body",
      description: "根据目标市场选择合适的认证机构（如 SGS、TUV、BV 等）",
      descriptionEn: "Select appropriate certification body based on target market",
      type: "certify",
      status: "pending",
      estimatedDays: 7,
      cost: "¥5,000-10,000",
    },
    {
      id: "4",
      date: new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "提交认证申请",
      titleEn: "Submit Certification Application",
      description: "向认证机构提交申请材料，等待审核通过",
      descriptionEn: "Submit application to certification body, await approval",
      type: "apply",
      status: "pending",
      estimatedDays: 3,
    },
    {
      id: "5",
      date: new Date(now.getTime() + 35 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "产品检测",
      titleEn: "Product Testing",
      description: "在认证机构实验室进行安全、EMC、环境等测试",
      descriptionEn: "Conduct safety, EMC, and environmental tests at certification lab",
      type: "test",
      status: "pending",
      estimatedDays: 21,
      cost: "¥15,000-30,000",
    },
    {
      id: "6",
      date: new Date(now.getTime() + 56 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "获取认证证书",
      titleEn: "Obtain Certification",
      description: "测试通过后，获得认证证书（如 CE、FCC、CCC 等）",
      descriptionEn: "Receive certification certificate after passing tests",
      type: "certify",
      status: "pending",
      estimatedDays: 7,
    },
    {
      id: "7",
      date: new Date(now.getTime() + 63 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      title: "合规上市销售",
      titleEn: "Compliant Market Launch",
      description: "完成所有合规要求，产品可以在目标市场合法销售",
      descriptionEn: "Complete all compliance requirements, product ready for legal sale",
      type: "complete",
      status: "pending",
    },
  ];
}
