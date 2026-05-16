"use client";

import { useState } from "react";
import { Calendar, CheckCircle2, Circle, Clock, AlertTriangle, ChevronRight } from "lucide-react";

interface TimelineItem {
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

interface ComplianceTimelineProps {
  items?: TimelineItem[];
  locale?: "zh" | "en";
}

const translations = {
  zh: {
    title: "合规路线图",
    subtitle: "从今天到产品上市的时间规划",
    today: "今天",
    estimated: "预计",
    days: "天",
    completed: "已完成",
    inProgress: "进行中",
    pending: "待完成",
    documents: "所需材料",
    apply: "申请",
    test: "测试",
    certify: "认证",
    complete: "完成",
  },
  en: {
    title: "Compliance Roadmap",
    subtitle: "Timeline from today to market launch",
    today: "Today",
    estimated: "Est.",
    days: "days",
    completed: "Completed",
    inProgress: "In Progress",
    pending: "Pending",
    documents: "Required Documents",
    apply: "Apply",
    test: "Test",
    certify: "Certify",
    complete: "Complete",
  },
};

const defaultItems: TimelineItem[] = [
  {
    id: "1",
    date: new Date().toISOString().split("T")[0],
    title: "合规评估完成",
    titleEn: "Compliance Assessment Complete",
    description: "AI 系统完成初步合规评估，生成风险报告和改进建议",
    descriptionEn: "AI system completes initial compliance assessment and generates risk report",
    type: "complete",
    status: "completed",
  },
  {
    id: "2",
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    title: "准备申请材料",
    titleEn: "Prepare Application Materials",
    description: "收集产品规格、技术文档、测试报告等申请所需材料",
    descriptionEn: "Gather product specifications, technical documents, test reports",
    type: "apply",
    status: "pending",
    estimatedDays: 7,
    documents: ["产品规格书", "电路原理图", "BOM清单", "说明书"],
    documentsEn: ["Product Specifications", "Circuit Schematics", "BOM", "User Manual"],
  },
  {
    id: "3",
    date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
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
    date: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
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
    date: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
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
    date: new Date(Date.now() + 56 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
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
    date: new Date(Date.now() + 63 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    title: "合规上市销售",
    titleEn: "Compliant Market Launch",
    description: "完成所有合规要求，产品可以在目标市场合法销售",
    descriptionEn: "Complete all compliance requirements, product ready for legal sale",
    type: "complete",
    status: "pending",
  },
];

const typeColors = {
  apply: { bg: "bg-blue-50", border: "border-blue-200", icon: "📝", color: "text-blue-600" },
  test: { bg: "bg-amber-50", border: "border-amber-200", icon: "🔬", color: "text-amber-600" },
  certify: { bg: "bg-green-50", border: "border-green-200", icon: "📜", color: "text-green-600" },
  complete: { bg: "bg-emerald-50", border: "border-emerald-200", icon: "✅", color: "text-emerald-600" },
};

const typeLabels = {
  zh: { apply: "申请", test: "检测", certify: "认证", complete: "完成" },
  en: { apply: "Apply", test: "Test", certify: "Certify", complete: "Complete" },
};

export default function ComplianceTimeline({
  items = defaultItems,
  locale = "zh",
}: ComplianceTimelineProps) {
  const t = translations[locale];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getDaysFromNow = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
            <CheckCircle2 className="w-3 h-3" />
            {t.completed}
          </span>
        );
      case "in-progress":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
            <Clock className="w-3 h-3" />
            {t.inProgress}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
            <Circle className="w-3 h-3" />
            {t.pending}
          </span>
        );
    }
  };

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{t.title}</h3>
          <p className="text-sm text-gray-500">{t.subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">{locale === "en" ? "Total Duration" : "总耗时"}</div>
          <div className="text-2xl font-bold text-blaze-red">
            {getDaysFromNow(items[items.length - 1].date)} {t.days}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blaze-red via-amber-400 to-green-500" />

        {/* Items */}
        <div className="space-y-4">
          {items.map((item, index) => {
            const isToday = item.date === today;
            const isPast = new Date(item.date) < new Date(today);
            const colors = typeColors[item.type];
            const daysFromNow = getDaysFromNow(item.date);

            return (
              <div key={item.id} className="relative">
                {/* Node */}
                <div
                  className={`absolute left-4 w-4 h-4 rounded-full border-2 bg-white z-10 ${
                    item.status === "completed"
                      ? "border-green-500 bg-green-500"
                      : item.status === "in-progress"
                      ? "border-blue-500 bg-blue-500"
                      : "border-gray-300"
                  }`}
                  style={{ top: "1.25rem" }}
                >
                  {item.status === "completed" && (
                    <CheckCircle2 className="absolute -left-0.5 -top-0.5 w-5 h-5 text-green-500 bg-white rounded-full" />
                  )}
                </div>

                {/* Card */}
                <div
                  className={`ml-12 rounded-xl border ${colors.bg} ${colors.border} p-4 transition-all hover:shadow-md cursor-pointer ${
                    expandedId === item.id ? "ring-2 ring-blaze-red/30" : ""
                  }`}
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{colors.icon}</span>
                      <div>
                        {isToday && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blaze-red px-2 py-0.5 text-xs font-medium text-white mb-1">
                            {t.today}
                          </span>
                        )}
                        <h4 className="font-medium text-gray-900">
                          {locale === "en" ? item.titleEn : item.title}
                        </h4>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Calendar className="w-4 h-4" />
                          <span>{formatDate(item.date)}</span>
                          {item.estimatedDays && (
                            <span className="text-amber-600">
                              {t.estimated} {item.estimatedDays} {t.days}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(item.status)}
                      <ChevronRight
                        className={`w-5 h-5 text-gray-400 transition-transform ${
                          expandedId === item.id ? "rotate-90" : ""
                        }`}
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <p className="mt-2 text-sm text-gray-600">
                    {locale === "en" ? item.descriptionEn : item.description}
                  </p>

                  {/* Expanded content */}
                  {expandedId === item.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                      {/* Cost */}
                      {item.cost && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">{locale === "en" ? "Estimated Cost" : "预估费用"}:</span>
                          <span className="text-sm font-medium text-gray-900">{item.cost}</span>
                        </div>
                      )}

                      {/* Documents */}
                      {item.documents && item.documents.length > 0 && (
                        <div>
                          <span className="text-sm font-medium text-gray-700 mb-2 block">{t.documents}:</span>
                          <div className="flex flex-wrap gap-2">
                            {(item.documents && item.documents.length > 0 ? (locale === "en" ? (item.documentsEn || item.documents) : item.documents) : []).map((doc, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                              >
                                📄 {doc}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Days indicator */}
                      {daysFromNow > 0 && (
                        <div className="flex items-center gap-2 text-sm">
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                          <span className="text-gray-600">
                            {locale === "en"
                              ? `${daysFromNow} days until this step`
                              : `还有 ${daysFromNow} 天`}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 p-4 bg-gradient-to-r from-blaze-red/10 to-amber-50 rounded-xl border border-blaze-red/20">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-gray-900">
              {locale === "en" ? "Total Investment" : "总体投入"}
            </h4>
            <p className="text-sm text-gray-600">
              {locale === "en" ? "Estimated time and cost for full compliance" : "达到完全合规的预计时间和费用"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blaze-red">
              {getDaysFromNow(items[items.length - 1].date)} {t.days}
            </div>
            <div className="text-sm text-gray-500">
              {locale === "en" ? "Timeline" : "时间线"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}