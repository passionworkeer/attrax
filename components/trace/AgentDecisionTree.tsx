"use client";

import { useState } from "react";
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
} from "lucide-react";

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
}

interface DecisionTreeProps {
  traceData?: TraceNode;
  locale: "zh" | "en";
}

const defaultTrace: TraceNode = {
  id: "root",
  type: "input",
  label: "图片上传",
  labelEn: "Image Upload",
  icon: "📷",
  status: "success",
  children: [
    {
      id: "vision",
      type: "vision",
      label: "Vision AI 识别",
      labelEn: "Vision Analysis",
      icon: "🧠",
      status: "success",
      duration: "1.2s",
      data: {
        productType: "消费电子产品",
        productTypeEn: "Consumer Electronics",
        features: ["电池供电", "LED显示屏", "USB充电"],
      },
    },
    {
      id: "planner",
      type: "planner",
      label: "查询规划",
      labelEn: "Query Planning",
      icon: "📋",
      status: "success",
      duration: "0.3s",
      data: {
        queries: ["RoHS + 电子产品 + 合规", "FCC + 电子产品 + 标准", "REACH + 电子产品 + SVHC"],
      },
    },
    {
      id: "fanout",
      type: "fanout",
      label: "多市场并行检索",
      labelEn: "Multi-Market Search",
      icon: "⚡",
      status: "success",
      duration: "2.8s",
      children: [
        {
          id: "eu",
          type: "market",
          label: "🇪🇺 欧盟",
          labelEn: "🇪🇺 European Union",
          icon: "🇪🇺",
          status: "success",
          duration: "1.1s",
          data: { regulations: 3, topMatch: "REACH Article 22" },
        },
        {
          id: "us",
          type: "market",
          label: "🇺🇸 美国",
          labelEn: "🇺🇸 United States",
          icon: "🇺🇸",
          status: "success",
          duration: "1.3s",
          data: { regulations: 2, topMatch: "FCC Part 15" },
        },
        {
          id: "cn",
          type: "market",
          label: "🇨🇳 中国",
          labelEn: "🇨🇳 China",
          icon: "🇨🇳",
          status: "success",
          duration: "0.9s",
          data: { regulations: 1, topMatch: "出口管制法" },
        },
      ],
    },
    {
      id: "synthesis",
      type: "synthesis",
      label: "综合分析与报告生成",
      labelEn: "Synthesis & Report Generation",
      icon: "📊",
      status: "success",
      duration: "3.5s",
    },
    {
      id: "result",
      type: "result",
      label: "合规评估结果",
      labelEn: "Compliance Result",
      icon: "✅",
      status: "success",
      data: {
        score: 85,
        grade: "B",
        status: "pass",
        risks: 3,
        highRisk: 1,
        mediumRisk: 2,
      },
    },
  ],
};

const typeIcons: Record<string, string> = {
  input: "📷",
  vision: "🧠",
  planner: "📋",
  fanout: "⚡",
  market: "🌍",
  synthesis: "📊",
  result: "✅",
};

const typeColors: Record<string, { bg: string; border: string; text: string }> = {
  input: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600" },
  vision: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-600" },
  planner: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-600" },
  fanout: { bg: "bg-green-50", border: "border-green-200", text: "text-green-600" },
  market: { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-600" },
  synthesis: { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-600" },
  result: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-600" },
};

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

function VisionDataView({ data, locale, colors }: { data: Record<string, unknown>; locale: "zh" | "en"; colors: { text: string } }) {
  const productType = String(data.productType || "");
  const productTypeEn = String(data.productTypeEn || "");
  const features = Array.isArray(data.features) ? data.features.map(String) : [];
  
  return (
    <div className="flex flex-wrap gap-2">
      <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-purple-100 ${colors.text}`}>
        {locale === "en" ? "Product" : "产品类型"}: {locale === "en" ? productTypeEn : productType}
      </span>
      {features.map((f, i) => (
        <span key={i} className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
          {f}
        </span>
      ))}
    </div>
  );
}

function ResultDataView({ data, locale }: { data: Record<string, unknown>; locale: "zh" | "en" }) {
  const score = typeof data.score === "number" ? data.score : 0;
  const grade = String(data.grade || "");
  const status = String(data.status || "");
  const highRisk = typeof data.highRisk === "number" ? data.highRisk : 0;
  const mediumRisk = typeof data.mediumRisk === "number" ? data.mediumRisk : 0;
  
  return (
    <>
      <div className="text-center">
        <div className="text-2xl font-bold text-blaze-red">{score}</div>
        <div className="text-xs text-gray-500">{locale === "en" ? "Score" : "评分"}</div>
      </div>
      <div className="text-center">
        <div className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
          status === "pass" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
        }`}>
          {grade}
        </div>
        <div className="text-xs text-gray-500">{locale === "en" ? "Grade" : "等级"}</div>
      </div>
      <div className="flex items-center gap-1">
        {highRisk > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs text-red-600">
            <AlertTriangle className="w-3 h-3" />
            {highRisk} {locale === "en" ? "High" : "高风险"}
          </span>
        )}
        {mediumRisk > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-600">
            {mediumRisk} {locale === "en" ? "Medium" : "中风险"}
          </span>
        )}
      </div>
    </>
  );
}

function TraceNodeComponent({
  node,
  locale,
  depth = 0,
}: {
  node: TraceNode;
  locale: "zh" | "en";
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children && node.children.length > 0;
  const colors = typeColors[node.type] || typeColors.input;
  const label = locale === "en" ? node.labelEn : node.label;

  return (
    <div className="relative">
      {depth > 0 && (
        <div className="absolute left-0 top-0 w-6 h-full">
          <div className="absolute left-6 top-0 w-px h-6 bg-gray-200" />
          <div className="absolute left-6 top-6 w-6 h-px bg-gray-200" />
        </div>
      )}

      <div
        className={`relative mb-2 rounded-lg border ${colors.bg} ${colors.border} p-4 transition-all hover:shadow-md`}
        style={{ marginLeft: depth > 0 ? "1.5rem" : "0" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white shadow-sm">
              <span className="text-xl">{node.icon || typeIcons[node.type]}</span>
            </div>
            <div>
              <h4 className="font-medium text-gray-900">{label}</h4>
              {node.duration && (
                <span className="text-xs text-gray-500">{node.duration}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon status={node.status} />
            {hasChildren && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 rounded hover:bg-white/50 transition-colors"
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

        {node.data && (
          <div className="mt-3">
            {node.type === "vision" && (
              <VisionDataView data={node.data} locale={locale} colors={colors} />
            )}
            {node.type === "result" && (
              <div className="flex items-center gap-4">
                <ResultDataView data={node.data} locale={locale} />
              </div>
            )}
          </div>
        )}
      </div>

      {hasChildren && expanded && (
        <div className="relative border-l-2 border-dashed border-gray-200 ml-6">
          {node.children!.map((child, index) => (
            <div key={child.id} className="relative">
              <div className="absolute -left-6 top-6">
                <div className="w-4 h-4 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center">
                  <span className="text-xs text-gray-500">{index + 1}</span>
                </div>
              </div>
              <TraceNodeComponent node={child} locale={locale} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentDecisionTree({ traceData, locale = "zh" }: DecisionTreeProps) {
  const data = traceData || defaultTrace;
  const totalTime = data.children?.reduce((acc, child) => {
    const duration = child.duration?.replace("s", "") || "0";
    return acc + parseFloat(duration);
  }, 0) || 0;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          {locale === "en" ? "AI Decision Tree" : "AI 决策过程"}
        </h3>
        <span className="text-sm text-gray-500">
          {locale === "en" ? "Trace Visualization" : "执行链路可视化"}
        </span>
      </div>

      <div className="flex flex-wrap gap-3 mb-6 text-xs">
        {Object.entries(typeColors).map(([type, colors]) => (
          <div key={type} className={`flex items-center gap-1 px-2 py-1 rounded ${colors.bg} ${colors.border}`}>
            <span>{typeIcons[type]}</span>
            <span className="text-gray-600">{type.toUpperCase()}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <TraceNodeComponent node={data} locale={locale} />
      </div>

      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">{locale === "en" ? "Total Duration" : "总耗时"}:</span>
          <span className="font-mono font-medium">{totalTime}s</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-1">
          <span className="text-gray-600">{locale === "en" ? "Steps Executed" : "执行步骤"}:</span>
          <span className="font-mono font-medium">{(data.children?.length || 0) + 1}</span>
        </div>
      </div>
    </div>
  );
}