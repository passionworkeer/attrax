"use client";

import { useState, useEffect, useRef } from "react";
import {
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ChevronRight,
  FileText,
  DollarSign,
  TrendingUp,
  Target,
  Sparkles,
  Play,
  Pause,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { englishArray, englishText } from "@/lib/report-localization";

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
  autoPlay?: boolean;
  locale?: "zh" | "en";
}

const typeColors = {
  apply: { bg: "bg-blaze-red/15", border: "border-blaze-red/40", icon: "📝", color: "text-blaze-red", light: "bg-blaze-red/25", dark: "bg-blaze-red" },
  test: { bg: "bg-amber-500/15", border: "border-amber-500/40", icon: "🔬", color: "text-amber-300", light: "bg-amber-500/25", dark: "bg-amber-500" },
  certify: { bg: "bg-cyan-500/15", border: "border-cyan-500/40", icon: "📜", color: "text-cyan-300", light: "bg-cyan-500/25", dark: "bg-cyan-500" },
  complete: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", icon: "✅", color: "text-emerald-300", light: "bg-emerald-500/25", dark: "bg-emerald-500" },
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
    documentsEn: ["Product Specs", "Circuit Schematics", "BOM", "User Manual"],
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

// Animation component
function AnimatedEntry({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      ref={ref}
      className={`transition-all duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"} ${className}`}
    >
      {children}
    </div>
  );
}

function ProgressBar({ progress, color = "bg-gradient-to-r from-blaze-red to-amber-400" }: { progress: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-700 ease-out rounded-full`}
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

export default function ComplianceTimeline({
  items = defaultItems,
  autoPlay = false,
  locale: localeProp,
}: ComplianceTimelineProps) {
  const { t: hookT, locale: hookLocale } = useTranslation();
  const locale = localeProp ?? hookLocale ?? "zh";
  const t = hookT;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentStep, setCurrentStep] = useState(0);

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
    return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getTotalDays = () => getDaysFromNow(items[items.length - 1].date);

  const getTotalCost = () => {
    let min = 0, max = 0;
    items.forEach((item) => {
      if (item.cost) {
        const match = item.cost.match(/¥([\d,]+)-([\d,]+)/);
        if (match) {
          min += parseInt(match[1].replace(",", ""));
          max += parseInt(match[2].replace(",", ""));
        }
      }
    });
    return min > 0 ? `¥${min.toLocaleString()}-${max.toLocaleString()}` : locale === "en" ? "N/A" : "暂无";
  };

  const getProgress = () => {
    const completed = items.filter((item) => item.status === "completed").length;
    return Math.round((completed / items.length) * 100);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
            <CheckCircle2 className="w-3 h-3" />
            {t("roadmap.completed")}
          </span>
        );
      case "in-progress":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-3 py-1 text-xs font-bold text-blue-300">
            <Clock className="w-3 h-3 animate-pulse" />
            {t("roadmap.inProgress")}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 px-3 py-1 text-xs font-medium text-slate-300">
            <Circle className="w-3 h-3" />
            {t("roadmap.pending")}
          </span>
        );
    }
  };

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    if (isPlaying) {
      const interval = setInterval(() => {
        setCurrentStep((prev) => (prev >= items.length - 1 ? 0 : prev + 1));
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [isPlaying, items.length]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 shadow-lg">
            <Target className="w-7 h-7 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-2xl font-black text-white max-sm:text-xl">{t("roadmap.title")}</h3>
            <p className="text-sm text-slate-400">{t("roadmap.subtitle")}</p>
          </div>
        </div>
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`p-3 rounded-xl transition-all shadow-md ${
            isPlaying ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"
          }`}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
      </div>

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AnimatedEntry delay={0}>
          <div className="bg-gradient-to-br from-blaze-red/10 to-rose-50 rounded-2xl p-4 border border-blaze-red/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blaze-red/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-blaze-red" />
              </div>
              <div>
                <div className="text-2xl font-black text-white">{getTotalDays()}</div>
                <div className="text-xs text-slate-400">{t("roadmap.totalDuration")}</div>
              </div>
            </div>
          </div>
        </AnimatedEntry>
        <AnimatedEntry delay={100}>
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4 border border-emerald-500/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">{getTotalCost()}</div>
                <div className="text-xs text-slate-400">{t("roadmap.estimatedCost")}</div>
              </div>
            </div>
          </div>
        </AnimatedEntry>
        <AnimatedEntry delay={200}>
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-500/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-black text-white">{items.length}</div>
                <div className="text-xs text-slate-400">{t("roadmap.stepsCount")}</div>
              </div>
            </div>
          </div>
        </AnimatedEntry>
        <AnimatedEntry delay={300}>
          <div className="bg-gradient-to-br from-purple-50 to-rose-50 rounded-2xl p-4 border border-purple-500/40">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <div className="text-2xl font-black text-white">{getProgress()}%</div>
                <div className="text-xs text-slate-400">{t("roadmap.completed")}</div>
              </div>
            </div>
          </div>
        </AnimatedEntry>
      </div>

      {/* Progress bar */}
      <div className="mb-8">
        <ProgressBar progress={getProgress()} />
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Gradient line */}
        <div className="absolute left-7 top-0 bottom-0 w-1 bg-gradient-to-b from-green-400 via-amber-400 to-blaze-red/30 rounded-full" />

        {/* Items */}
        <div className="space-y-4">
          {items.map((item, index) => {
            const isToday = item.date === today;
            const colors = typeColors[item.type];
            const daysFromNow = getDaysFromNow(item.date);
            const isActive = index === currentStep && isPlaying;
            const isHighlighted = isActive || (expandedId === item.id);

            return (
              <AnimatedEntry key={item.id} delay={index * 100}>
                <div className={`relative transition-all duration-300 ${isHighlighted ? "scale-[1.02]" : ""}`}>
                  {/* Node */}
                  <div
                    className={`absolute left-4 w-6 h-6 rounded-full border-2 z-10 transition-all duration-300 ${
                      item.status === "completed"
                        ? "border-green-500 bg-green-500"
                        : item.status === "in-progress"
                        ? "border-blue-500 bg-blue-500 animate-pulse"
                        : isActive
                        ? "border-blaze-red bg-blaze-red animate-bounce"
                        : "border-white/15 bg-white"
                    }`}
                    style={{ top: "1.1rem" }}
                  >
                    {item.status === "completed" && (
                      <CheckCircle2 className="absolute -left-0.5 -top-0.5 w-7 h-7 text-green-500 bg-white rounded-full" />
                    )}
                  </div>

                  {/* Card */}
                  <div
                    className={`ml-12 rounded-2xl border-2 p-5 transition-all duration-300 cursor-pointer ${
                      colors.bg
                    } ${colors.border} ${
                      isHighlighted ? "shadow-xl ring-2 ring-blaze-red/30" : "hover:shadow-lg"
                    } ${item.status === "in-progress" || isActive ? "ring-2 ring-blue-500/30" : ""}`}
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  >
                    {/* Header */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${colors.light}`}>
                          <span className="text-2xl">{colors.icon}</span>
                          {isActive && (
                            <div className="absolute -inset-1 rounded-xl border-2 border-blaze-red/50 animate-pulse" />
                          )}
                        </div>
                        <div className="min-w-0">
                          {isToday && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blaze-red px-3 py-1 text-xs font-bold text-white mb-2 shadow-md">
                              {t("roadmap.startToday")}
                            </span>
                          )}
                          <h4 className="text-lg font-bold text-white">
                            {locale === "en" ? englishText(item.titleEn, englishText(item.title, "Roadmap task")) : item.title}
                          </h4>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              {formatDate(item.date)}
                            </span>
                            {item.estimatedDays && (
                              <span className="flex items-center gap-1 font-medium text-amber-300">
                                <Clock className="w-4 h-4" />
                                {item.estimatedDays} {t("roadmap.days")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                        {getStatusBadge(item.status)}
                        <ChevronRight
                          className={`w-5 h-5 text-slate-500 transition-all duration-300 ${
                            expandedId === item.id ? "rotate-90" : ""
                          }`}
                        />
                      </div>
                    </div>

                    {/* Description */}
                    <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                      {locale === "en" ? englishText(item.descriptionEn, englishText(item.description, "Add detailed execution notes before starting this step.")) : item.description}
                    </p>

                    {/* Expanded content */}
                    <div
                      className={`overflow-hidden transition-all duration-300 ${
                        expandedId === item.id ? "max-h-96 opacity-100 mt-4" : "max-h-0 opacity-0"
                      }`}
                    >
                      <div className="pt-4 border-t border-slate-500/40 space-y-4">
                        {/* Cost */}
                        {item.cost && (
                          <div className="flex items-center gap-3 p-3 bg-white rounded-xl border">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                              <DollarSign className="w-5 h-5 text-emerald-300" />
                            </div>
                            <div>
                              <div className="text-xs text-slate-400">{t("roadmap.cost")}</div>
                              <div className="text-lg font-bold text-white">{item.cost}</div>
                            </div>
                          </div>
                        )}

                        {/* Documents */}
                        {item.documents && item.documents.length > 0 && (
                          <div className="p-3 bg-white rounded-xl border">
                            <div className="flex items-center gap-2 mb-3">
                              <FileText className="w-4 h-4 text-slate-400" />
                              <span className="text-sm font-semibold text-slate-200">{t("roadmap.requiredDocs")}:</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {(item.documents && item.documents.length > 0
                                ? locale === "en"
                                  ? englishArray(item.documentsEn || item.documents, ["Source document checklist TBD"])
                                  : item.documents
                                : []
                              ).map((doc, i) => (
                                <span
                                  key={i}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-500/10 px-3 py-1.5 text-xs font-medium text-slate-200 border"
                                >
                                  📄 {doc}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Days indicator */}
                        {daysFromNow > 0 && (
                          <div className="flex items-center gap-3 p-3 bg-amber-500/10 rounded-xl border border-amber-500/40">
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                            <div>
                              <div className="text-sm font-medium text-amber-800">
                                {t("roadmap.untilThisStep", { days: daysFromNow })}
                              </div>
                              <div className="text-xs text-amber-300">{t("roadmap.suggestStartNow")}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </AnimatedEntry>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <AnimatedEntry delay={800}>
        <div className="mt-8 p-6 bg-gradient-to-r from-blaze-red/10 via-rose-50 to-amber-50 rounded-2xl border border-blaze-red/20">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-lg font-bold text-white">{t("roadmap.readyToStart")}</h4>
              <p className="text-sm text-slate-300">{t("roadmap.suggestStartNow")}</p>
            </div>
            <button type="button" className="px-6 py-3 bg-gradient-to-r from-blaze-red to-rose-500 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-all">
              {t("roadmap.startNow")} →
            </button>
          </div>
        </div>
      </AnimatedEntry>
    </div>
  );
}
