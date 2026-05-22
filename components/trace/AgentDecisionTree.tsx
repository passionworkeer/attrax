"use client";

import { useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Zap,
  Brain,
  FileSearch,
  Lightbulb,
  Clock,
  Target,
  TrendingUp,
  Shield,
  Sparkles,
  Play,
  Pause,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export interface TraceNode {
  id: string;
  type: "input" | "vision" | "planner" | "fanout" | "market" | "synthesis" | "result";
  label: string;
  labelEn: string;
  icon: string;
  children?: TraceNode[];
  data?: Record<string, unknown>;
  status?: "pending" | "running" | "success" | "error";
  duration?: string;
  reasoning?: string;
  reasoningEn?: string;
  confidence?: number;
}

interface DecisionTreeProps {
  traceData?: TraceNode;
  locale: "zh" | "en";
  autoPlay?: boolean;
  animationSpeed?: number;
  score?: number;
  grade?: string;
  traceNodes?: unknown[];
}

const typeIcons: Record<string, string> = {
  input: "📷",
  vision: "🧠",
  planner: "📋",
  fanout: "⚡",
  market: "🌍",
  synthesis: "📊",
  result: "✅",
};

const typeColors: Record<string, { bg: string; border: string; text: string; light: string; dark: string }> = {
  input: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600", light: "bg-blue-100", dark: "bg-blue-500" },
  vision: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-600", light: "bg-purple-100", dark: "bg-purple-500" },
  planner: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-600", light: "bg-amber-100", dark: "bg-amber-500" },
  fanout: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-600", light: "bg-emerald-100", dark: "bg-emerald-500" },
  market: { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-600", light: "bg-cyan-100", dark: "bg-cyan-500" },
  synthesis: { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-600", light: "bg-indigo-100", dark: "bg-indigo-500" },
  result: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-600", light: "bg-rose-100", dark: "bg-rose-500" },
};

// Convert API response to TraceNode format
function _buildTraceTreeFromApi(nodes: {
  id?: string;
  type?: string;
  label?: string;
  icon?: string;
  status?: string;
  duration?: string;
  confidence?: number;
}[]): TraceNode {
  // Map API node types to TraceNode types
  const typeMap: Record<string, TraceNode["type"]> = {
    vision: "vision",
    query_planner: "planner",
    retriever: "fanout",
    synthesis: "synthesis",
    generate: "result",
    verify: "synthesis",
    refine: "synthesis",
  };

  const labelMap: Record<string, { zh: string; en: string }> = {
    vision: { zh: "视觉识别", en: "Vision Analysis" },
    query_planner: { zh: "查询规划", en: "Query Planner" },
    retriever: { zh: "文档检索", en: "Document Retrieval" },
    synthesis: { zh: "综合分析", en: "Synthesis" },
    generate: { zh: "报告生成", en: "Report Generation" },
    verify: { zh: "验证审核", en: "Verification" },
    refine: { zh: "优化迭代", en: "Refinement" },
    fan_out: { zh: "并行检索", en: "Parallel Search" },
  };

  const iconMap: Record<string, string> = {
    vision: "🧠",
    query_planner: "📋",
    retriever: "⚡",
    synthesis: "📊",
    generate: "📝",
    verify: "✅",
    refine: "🔄",
    fan_out: "🌍",
  };

  // Build a tree structure from the nodes
  const children: TraceNode[] = nodes.map((node) => {
    const nodeType = typeMap[node.type || ""] || "synthesis" as TraceNode["type"];
    const nodeLabel = labelMap[node.type || ""] || { zh: node.label || node.type || "", en: node.label || node.type || "" };
    return {
      id: node.id || node.type || "node",
      type: nodeType,
      label: nodeLabel.zh,
      labelEn: nodeLabel.en,
      icon: iconMap[node.type || ""] || "📊",
      status: (node.status as TraceNode["status"]) || "pending",
      duration: node.duration || "0s",
      confidence: node.confidence || 0,
    };
  });

  return {
    id: "root",
    type: "input",
    label: "图片上传",
    labelEn: "Image Upload",
    icon: "📷",
    status: "success",
    children,
  };
}

// Demo trace - fully bilingual
const demoTrace: TraceNode = {
  id: "root",
  type: "input",
  label: "图片上传",
  labelEn: "Image Upload",
  icon: "📷",
  status: "running",
  reasoning: "用户上传产品图片，系统自动接收并验证图片格式（支持 JPG/PNG/WebP，最大 10MB）",
  reasoningEn: "User uploads product images, system receives and validates format (supports JPG/PNG/WebP, max 10MB)",
  children: [
    {
      id: "vision",
      type: "vision",
      label: "Vision AI 图像识别",
      labelEn: "Vision Analysis",
      icon: "🧠",
      status: "pending",
      duration: "1.2s",
      confidence: 0.97,
      reasoning: "基于 CLIP 模型进行多标签分类：识别产品类型为便携式蓝牙音箱，检测到 3 个关键特征",
      reasoningEn: "CLIP-based multi-label classification: identifies portable Bluetooth speaker, detects 3 key features",
      data: {
        productType: "便携式蓝牙音箱",
        productTypeEn: "Portable Bluetooth Speaker",
        confidence: 0.97,
        features: [
          { name: "电池供电", nameEn: "Battery Powered", icon: "🔋" },
          { name: "蓝牙连接", nameEn: "Bluetooth", icon: "📡" },
          { name: "LED显示屏", nameEn: "LED Display", icon: "💡" },
        ],
      },
    },
    {
      id: "planner",
      type: "planner",
      label: "查询规划器",
      labelEn: "Query Planner",
      icon: "📋",
      status: "pending",
      duration: "0.3s",
      confidence: 0.99,
      reasoning: "根据产品特征智能生成多市场合规查询策略，自动排序优先级",
      reasoningEn: "Intelligently generates multi-market compliance queries based on product features, auto-sorts priorities",
      data: {
        strategies: [
          { market: "EU", query: "RoHS + 电子产品", queryEn: "RoHS + Electronics", priority: 1 },
          { market: "EU", query: "REACH + SVHC", queryEn: "REACH + SVHC", priority: 1 },
          { market: "US", query: "FCC + 无线电设备", queryEn: "FCC + Radio Equipment", priority: 1 },
          { market: "US", query: "CPSIA + 铅含量", queryEn: "CPSIA + Lead Content", priority: 2 },
          { market: "CN", query: "CCC + 音响设备", queryEn: "CCC + Audio Equipment", priority: 1 },
        ],
      },
    },
    {
      id: "fanout",
      type: "fanout",
      label: "多市场并行检索",
      labelEn: "Multi-Market Search",
      icon: "⚡",
      status: "pending",
      duration: "2.8s",
      confidence: 0.95,
      reasoning: "LangGraph 并行执行 5 个市场检索任务，FAISS 向量数据库快速召回相关法规文档",
      reasoningEn: "LangGraph executes 5 market queries in parallel, FAISS vector DB quickly retrieves relevant regulations",
      children: [
        {
          id: "eu",
          type: "market",
          label: "🇪🇺 欧盟",
          labelEn: "🇪🇺 European Union",
          icon: "🇪🇺",
          status: "pending",
          duration: "1.1s",
          confidence: 0.98,
          reasoning: "检测到 3 条相关法规：RoHS 3.0 修订（高风险）、REACH SVHC 新增（中风险）、RED 指令（低风险）",
          reasoningEn: "Found 3 relevant regulations: RoHS 3.0 amendment (high), REACH SVHC update (medium), RED directive (low)",
          data: {
            regulations: 3,
            highRisk: 1,
            mediumRisk: 1,
            lowRisk: 1,
            topMatch: { title: "RoHS 3.0 限制物质扩展", titleEn: "RoHS 3.0 Restricted Substances", score: 0.94, effectiveDate: "2026-10-01" },
            complianceRate: 67,
          },
        },
        {
          id: "us",
          type: "market",
          label: "🇺🇸 美国",
          labelEn: "🇺🇸 United States",
          icon: "🇺🇸",
          status: "pending",
          duration: "1.3s",
          confidence: 0.96,
          reasoning: "检测到 2 条相关法规：FCC Part 15 无线电合规（高风险需立即处理）、CPSIA 铅含量限值（中风险）",
          reasoningEn: "Found 2 relevant regulations: FCC Part 15 radio compliance (high - needs immediate action), CPSIA lead limits (medium)",
          data: {
            regulations: 2,
            highRisk: 1,
            mediumRisk: 1,
            lowRisk: 0,
            topMatch: { title: "FCC Part 15 无线电设备", titleEn: "FCC Part 15 Radio Equipment", score: 0.91, effectiveDate: "2026-06-01" },
            complianceRate: 50,
          },
        },
        {
          id: "cn",
          type: "market",
          label: "🇨🇳 中国",
          labelEn: "🇨🇳 China",
          icon: "🇨🇳",
          status: "pending",
          duration: "0.9s",
          confidence: 0.97,
          reasoning: "检测到 1 条相关法规：CCC 强制性认证，产品在认证目录范围内需提前准备",
          reasoningEn: "Found 1 relevant regulation: CCC mandatory certification, product is in certification scope",
          data: {
            regulations: 1,
            highRisk: 0,
            mediumRisk: 1,
            lowRisk: 0,
            topMatch: { title: "CCC 强制性产品认证", titleEn: "CCC Mandatory Certification", score: 0.88, effectiveDate: "2026-07-01" },
            complianceRate: 100,
          },
        },
      ],
    },
    {
      id: "synthesis",
      type: "synthesis",
      label: "综合分析引擎",
      labelEn: "Synthesis Engine",
      icon: "📊",
      status: "pending",
      duration: "3.5s",
      confidence: 0.93,
      reasoning: "聚合 6 条法规检索结果，LLM 生成结构化合规评估报告，计算综合风险评分",
      reasoningEn: "Aggregates 6 regulation results, LLM generates structured compliance report, calculates risk score",
      data: {
        reportSections: ["执行摘要", "市场风险评估", "合规清单", "行动计划", "时间线"],
        reportSectionsEn: ["Executive Summary", "Market Risk Assessment", "Compliance Checklist", "Action Plan", "Timeline"],
      },
    },
    {
      id: "result",
      type: "result",
      label: "合规评估报告",
      labelEn: "Compliance Report",
      icon: "✅",
      status: "pending",
      confidence: 0.95,
      reasoning: "综合评分 85/100，等级 B。主要风险来自 RoHS 3.0 和 FCC Part 15，需立即启动合规准备",
      reasoningEn: "Overall score 85/100, Grade B. Main risks from RoHS 3.0 and FCC Part 15, need to start compliance preparation immediately",
      data: {
        score: 85,
        grade: "B",
        status: "needs_attention",
        totalRisks: 5,
        highRisk: 2,
        mediumRisk: 3,
        lowRisk: 0,
        marketSummary: [
          { market: "EU", marketEn: "🇪🇺 EU", status: "warning", score: 72 },
          { market: "US", marketEn: "🇺🇸 US", status: "warning", score: 68 },
          { market: "CN", marketEn: "🇨🇳 CN", status: "pass", score: 92 },
        ],
        recommendations: [
          { priority: 1, action: "申请 RoHS 3.0 豁免或更换材料", actionEn: "Apply for RoHS 3.0 exemption or replace materials", deadline: "2026-06-01", cost: "¥5,000-20,000" },
          { priority: 2, action: "进行 FCC 射频测试认证", actionEn: "Conduct FCC RF testing certification", deadline: "2026-06-15", cost: "¥15,000-30,000" },
          { priority: 3, action: "准备 CCC 认证申请材料", actionEn: "Prepare CCC certification application materials", deadline: "2026-07-01", cost: "¥8,000-15,000" },
        ],
        timeline: {
          preparation: "2-4 周",
          preparationEn: "2-4 weeks",
          testing: "3-6 周",
          testingEn: "3-6 weeks",
          certification: "2-4 周",
          certificationEn: "2-4 weeks",
          total: "7-14 周",
          totalEn: "7-14 weeks",
        },
      },
    },
  ],
};

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

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case "pending":
      return <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />;
    case "running":
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case "success":
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case "error":
      return <XCircle className="w-4 h-4 text-red-500" />;
    default:
      return null;
  }
}

function ProgressBar({ progress, color = "bg-blue-500" }: { progress: number; color?: string }) {
  return (
    <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-500 ease-out`}
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
}

function ConfidenceBadge({ confidence, locale }: { confidence?: number; locale: "zh" | "en" }) {
  if (!confidence) return null;
  const percentage = Math.round(confidence * 100);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-xs font-medium">
      <Zap className="w-3 h-3" />
      {percentage}%
    </span>
  );
}

function RiskBadge({ level, count, locale }: { level: "high" | "medium" | "low"; count: number; locale: "zh" | "en" }) {
  if (count === 0) return null;
  const config = {
    high: { bg: "bg-red-100", text: "text-red-700", border: "border-red-200", label: locale === "en" ? "High" : "高", icon: "🔴" },
    medium: { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200", label: locale === "en" ? "Med" : "中", icon: "🟡" },
    low: { bg: "bg-green-100", text: "text-green-700", border: "border-green-200", label: locale === "en" ? "Low" : "低", icon: "🟢" },
  };
  const { bg, text, label, icon } = config[level];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${bg} ${text} ${config[level].border}`}>
      {icon} {count} {label}
    </span>
  );
}

function ReasoningPanel({ text, locale }: { text?: string; locale: "zh" | "en" }) {
  const { t } = useTranslation();
  if (!text) return null;
  return (
    <AnimatedEntry delay={100}>
      <div className="mt-3 p-4 rounded-xl bg-gradient-to-r from-yellow-50 to-amber-50 border-l-4 border-yellow-400 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center">
            <Lightbulb className="w-4 h-4 text-yellow-600" />
          </div>
          <div>
            <div className="text-xs font-semibold text-yellow-700 mb-1">{t("trace.aiReasoning")}</div>
            <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
          </div>
        </div>
      </div>
    </AnimatedEntry>
  );
}

function ResultCard({ data, locale }: { data: Record<string, unknown>; locale: "zh" | "en" }) {
  const { t } = useTranslation();
  const score = typeof data.score === "number" ? data.score : 0;
  const grade = String(data.grade || "");
  const highRisk = typeof data.highRisk === "number" ? data.highRisk : 0;
  const mediumRisk = typeof data.mediumRisk === "number" ? data.mediumRisk : 0;
  const lowRisk = typeof data.lowRisk === "number" ? data.lowRisk : 0;
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations as Array<{ priority: number; action: string; actionEn: string; deadline: string; cost: string }> : [];
  const timeline = data.timeline as Record<string, string> | undefined;
  const timelineEn = data.timeline as Record<string, string> | undefined;
  const marketSummary = Array.isArray(data.marketSummary) ? data.marketSummary as Array<{ market: string; marketEn: string; status: string; score: number }> : [];

  const gradeColors: Record<string, { bg: string; text: string; ring: string }> = {
    A: { bg: "bg-green-100", text: "text-green-700", ring: "ring-green-500" },
    B: { bg: "bg-blue-100", text: "text-blue-700", ring: "ring-blue-500" },
    C: { bg: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-500" },
    D: { bg: "bg-orange-100", text: "text-orange-700", ring: "ring-orange-500" },
    F: { bg: "bg-red-100", text: "text-red-700", ring: "ring-red-500" },
  };

  return (
    <AnimatedEntry delay={200}>
      <div className="mt-4 space-y-4">
        {/* Score and Grade */}
        <div className="flex items-center justify-center gap-8 p-4 bg-gradient-to-r from-gray-50 to-white rounded-xl border">
          <div className="text-center">
            <div className="relative">
              <div className="text-5xl font-black text-blaze-red">{score}</div>
              <span className="absolute -right-4 top-0 text-sm text-gray-400">/100</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">{t("trace.score")}</div>
          </div>
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-black ring-4 ${gradeColors[grade]?.ring || "ring-gray-300"} ${gradeColors[grade]?.bg || "bg-gray-100"} ${gradeColors[grade]?.text || "text-gray-700"}`}>
            {grade}
          </div>
        </div>

        {/* Market Summary */}
        {marketSummary.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {marketSummary.map((m, i) => (
              <div key={i} className={`p-3 rounded-xl border ${m.status === "pass" ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="text-lg font-bold">{locale === "en" ? m.marketEn : m.market}</div>
                <div className="text-2xl font-black mt-1">{m.score}</div>
                <div className="text-xs text-gray-500">{t("trace.score")}</div>
              </div>
            ))}
          </div>
        )}

        {/* Risk Summary */}
        <div className="flex items-center justify-center gap-3">
          <RiskBadge level="high" count={highRisk} locale={locale} />
          <RiskBadge level="medium" count={mediumRisk} locale={locale} />
          <RiskBadge level="low" count={lowRisk} locale={locale} />
        </div>

        {/* Timeline */}
        {timeline && (
          <div className="p-4 bg-gray-50 rounded-xl">
            <div className="text-xs font-semibold text-gray-500 mb-2">{t("trace.estimatedTimeline")}</div>
            <div className="grid grid-cols-4 gap-2 text-center">
              {Object.entries(timeline).map(([key, value], idx) => {
                const enKeys = ["preparation", "testing", "certification", "total"];
                const displayKey = locale === "en" ? enKeys[idx] : key;
                return (
                  <div key={key} className="p-2 bg-white rounded-lg border">
                    <div className="text-lg font-bold text-gray-900">{value}</div>
                    <div className="text-xs text-gray-500 capitalize">{displayKey}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="border-t pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-700">{t("trace.suggestedAction")}</span>
            </div>
            <div className="space-y-2">
              {recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-white rounded-xl border hover:shadow-md transition-shadow">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold ${
                    rec.priority === 1 ? "bg-red-100 text-red-600" : rec.priority === 2 ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-600"
                  }`}>
                    {rec.priority}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{locale === "en" ? rec.actionEn : rec.action}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {rec.deadline}
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        {rec.cost}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AnimatedEntry>
  );
}

function MarketCard({ node, locale }: { node: TraceNode; locale: "zh" | "en" }) {
  const { t } = useTranslation();
  const data = node.data as {
    regulations?: number;
    highRisk?: number;
    mediumRisk?: number;
    lowRisk?: number;
    topMatch?: { title: string; titleEn: string; score: number; effectiveDate: string };
    complianceRate?: number;
  } | undefined;

  return (
    <AnimatedEntry delay={150}>
      <div className="space-y-3">
        {/* Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">{t("trace.regulations")}</span>
            <span className="text-xl font-bold text-gray-900">{data?.regulations || 0}</span>
            <span className="text-sm text-gray-600">{t("trace.regulations")}</span>
          </div>
          <ConfidenceBadge confidence={node.confidence} locale={locale} />
        </div>

        {/* Compliance Rate */}
        {data?.complianceRate !== undefined && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">{t("result.overallScore")}</span>
              <span className="font-medium text-gray-700">{data.complianceRate}%</span>
            </div>
            <ProgressBar progress={data.complianceRate} color={data.complianceRate >= 80 ? "bg-green-500" : data.complianceRate >= 50 ? "bg-amber-500" : "bg-red-500"} />
          </div>
        )}

        {/* Risk badges */}
        <div className="flex flex-wrap gap-2">
          <RiskBadge level="high" count={data?.highRisk || 0} locale={locale} />
          <RiskBadge level="medium" count={data?.mediumRisk || 0} locale={locale} />
          <RiskBadge level="low" count={data?.lowRisk || 0} locale={locale} />
        </div>

        {/* Top match */}
        {data?.topMatch && (
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">{t("trace.maxMatch")}</div>
            <div className="text-sm font-medium text-gray-900">{locale === "en" ? data.topMatch.titleEn : data.topMatch.title}</div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
              <span>{Math.round(data.topMatch.score * 100)}%</span>
              <span>•</span>
              <span>{t("trace.effective")}: {data.topMatch.effectiveDate}</span>
            </div>
          </div>
        )}
      </div>
    </AnimatedEntry>
  );
}

function TraceNodeComponent({
  node,
  locale,
  depth = 0,
  index = 0,
}: {
  node: TraceNode;
  locale: "zh" | "en";
  depth?: number;
  index?: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(depth <= 1);
  const [showReasoning, setShowReasoning] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const colors = typeColors[node.type] || typeColors.input;
  const label = locale === "en" ? node.labelEn : node.label;
  const reasoning = locale === "en" && node.reasoningEn ? node.reasoningEn : node.reasoning;

  const handleToggle = () => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
  };

  return (
    <AnimatedEntry delay={index * 100}>
      <div className="relative">
        {/* Connector line */}
        {depth > 0 && (
          <div className="absolute -left-6 top-6 w-4 h-px bg-gradient-to-r from-transparent to-gray-300" />
        )}

        {/* Node card */}
        <div
          className={`relative rounded-2xl border-2 ${colors.bg} ${colors.border} overflow-hidden transition-all duration-300 ${
            depth === 0 ? "shadow-lg" : "hover:shadow-md hover:border-opacity-70"
          }`}
        >
          {/* Status bar */}
          <div className={`h-1 ${colors.dark} ${node.status === "running" ? "animate-pulse" : ""}`} />

          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`relative flex items-center justify-center w-14 h-14 rounded-2xl ${colors.light} shadow-sm`}>
                  <span className="text-3xl">{node.icon || typeIcons[node.type]}</span>
                  <div className="absolute -bottom-1 -right-1">
                    <StatusIcon status={node.status} />
                  </div>
                </div>
                <div>
                  <h4 className="text-lg font-bold text-gray-900">{label}</h4>
                  <div className="flex items-center gap-3 mt-1">
                    {node.duration && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500 font-mono">
                        <Clock className="w-3 h-3" />
                        {node.duration}
                      </span>
                    )}
                    <ConfidenceBadge confidence={node.confidence} locale={locale} />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {node.reasoning && (
                  <button
                    onClick={() => setShowReasoning(!showReasoning)}
                    className={`p-2 rounded-xl transition-all ${showReasoning ? `${colors.light} ${colors.text}` : "hover:bg-gray-100 text-gray-500"}`}
                    title={t("trace.aiReasoning")}
                  >
                    <Lightbulb className="w-5 h-5" />
                  </button>
                )}
                {hasChildren && (
                  <button
                    onClick={handleToggle}
                    className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
                  >
                    {expanded ? (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-500" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Reasoning panel */}
            {showReasoning && <ReasoningPanel text={reasoning} locale={locale} />}

            {/* Data content */}
            {node.data && !showReasoning && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                {node.type === "result" && <ResultCard data={node.data} locale={locale} />}
                {node.type === "market" && <MarketCard node={node} locale={locale} />}
              </div>
            )}
          </div>
        </div>

        {/* Children */}
        {hasChildren && expanded && (
          <div className="mt-4 ml-6 pl-6 border-l-2 border-dashed border-gray-300 space-y-4">
            {node.children!.map((child, idx) => (
              <TraceNodeComponent key={child.id} node={child} locale={locale} depth={depth + 1} index={idx} />
            ))}
          </div>
        )}
      </div>
    </AnimatedEntry>
  );
}

export default function AgentDecisionTree({
  traceData,
  locale = "zh",
  autoPlay = false,
  animationSpeed = 1,
  score,
  grade,
  traceNodes,
}: DecisionTreeProps) {
  const { t } = useTranslation();
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [progress, setProgress] = useState(0);

  // 使用 API 返回的真实数据，否则用 demo 数据
  const data = (() => {
    if (traceNodes && Array.isArray(traceNodes) && traceNodes.length > 0) {
      // 从 API 转换真实数据
      return _buildTraceTreeFromApi(traceNodes as {
        id?: string;
        type?: string;
        label?: string;
        icon?: string;
        status?: string;
        duration?: string;
        confidence?: number;
      }[]);
    }
    return traceData || demoTrace;
  })();

  const totalTime = data.children?.reduce((acc, child) => {
    const duration = child.duration?.replace("s", "") || "0";
    return acc + parseFloat(duration);
  }, 0) || 0;

  const totalSteps = 1 + (data.children?.length || 0) + (data.children?.reduce((acc, child) => acc + (child.children?.length || 0), 0) || 0);

  // 使用传入的 score 和 grade，或从 data 中提取
  const displayScore = score ?? (data as TraceNode)?.data?.score as number ?? 85;
  const displayGrade = grade ?? (data as TraceNode)?.data?.grade as string ?? "B";

  useEffect(() => {
    if (isPlaying) {
      const interval = setInterval(() => {
        setProgress((p) => (p >= 100 ? 0 : p + 2));
      }, 100 / animationSpeed);
      return () => clearInterval(interval);
    }
  }, [isPlaying, animationSpeed]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
              <span className="text-sm font-bold text-white">AI</span>
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-900">{t("trace.title")}</h3>
              <p className="text-sm text-gray-500">{t("trace.subtitle")}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-2xl font-black text-gray-900">
              {totalTime.toFixed(1)}s
            </div>
            <div className="text-xs text-gray-500">{t("trace.executionTime")}</div>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          <div className="text-center">
            <div className="text-2xl font-black text-gray-900">
              {totalSteps}
            </div>
            <div className="text-xs text-gray-500">{t("trace.executionSteps")}</div>
          </div>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-3 rounded-xl transition-all ${isPlaying ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"}`}
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <ProgressBar progress={progress} color="bg-gradient-to-r from-purple-500 to-indigo-500" />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(typeColors).map(([type, colors]) => (
          <div
            key={type}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl ${colors.bg} ${colors.border} border transition-all hover:scale-105`}
          >
            <span className="text-lg">{typeIcons[type]}</span>
            <span className="text-xs font-semibold text-gray-700">
              {t("trace." + type)}
            </span>
          </div>
        ))}
      </div>

      {/* Tree */}
      <div className="bg-gradient-to-br from-gray-50 via-white to-purple-50 rounded-3xl border border-gray-200 p-8 shadow-inner">
        <TraceNodeComponent node={data} locale={locale} />
      </div>

      {/* Footer stats */}
      <div className="mt-6 grid grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4 border border-green-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <div className="text-lg font-bold text-green-800">{t("trace.analysisComplete")}</div>
              <div className="text-xs text-green-600">4 {t("trace.targetMarkets")}</div>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
              <Brain className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-lg font-bold text-blue-800">LangGraph</div>
              <div className="text-xs text-blue-600">FAISS + {t("trace.vectorSearch")}</div>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-purple-50 to-rose-50 rounded-2xl p-4 border border-purple-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
              <FileSearch className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <div className="text-lg font-bold text-purple-800">6 {t("trace.regulations")}</div>
              <div className="text-xs text-purple-600">5 {t("trace.riskPoints")}</div>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Shield className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <div className="text-lg font-bold text-amber-800">Grade B</div>
              <div className="text-xs text-amber-600">{t("trace.score")}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}