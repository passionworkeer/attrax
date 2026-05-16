"use client";

import { useState, useEffect } from "react";
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
} from "lucide-react";

export interface TraceNode {
  id: string;
  type: "input" | "vision" | "planner" | "fanout" | "market" | "synthesis" | "result" | "reasoning";
  label: string;
  labelEn: string;
  icon: string;
  children?: TraceNode[];
  data?: Record<string, unknown>;
  status?: "pending" | "running" | "success" | "error";
  duration?: string;
  reasoning?: string; // AI reasoning for this step
  confidence?: number; // Confidence score 0-1
}

interface DecisionTreeProps {
  traceData?: TraceNode;
  locale: "zh" | "en";
}

// Demo trace showing realistic AI agent decision process
const demoTrace: TraceNode = {
  id: "root",
  type: "input",
  label: "图片上传",
  labelEn: "Image Upload",
  icon: "📷",
  status: "success",
  reasoning: "用户上传产品图片，系统接收并验证图片格式",
  children: [
    {
      id: "vision",
      type: "vision",
      label: "Vision AI 图像识别",
      labelEn: "Vision Analysis",
      icon: "🧠",
      status: "success",
      duration: "1.2s",
      confidence: 0.97,
      reasoning: "基于 CLIP 模型识别产品类型：便携式电池供电蓝牙音箱，检测到 LED 显示屏和 USB-C 充电接口",
      data: {
        productType: "便携式蓝牙音箱",
        productTypeEn: "Portable Bluetooth Speaker",
        confidence: 0.97,
        features: [
          { name: "电池供电", confidence: 0.98 },
          { name: "蓝牙连接", confidence: 0.95 },
          { name: "LED显示屏", confidence: 0.92 },
        ],
      },
    },
    {
      id: "planner",
      type: "planner",
      label: "查询规划器",
      labelEn: "Query Planner",
      icon: "📋",
      status: "success",
      duration: "0.3s",
      confidence: 0.99,
      reasoning: "根据产品特征生成多市场合规查询策略，覆盖欧盟、美国、中国等主要市场",
      data: {
        strategies: [
          { market: "EU", query: "RoHS + 电子产品 + 便携式设备", priority: 1 },
          { market: "EU", query: "REACH + SVHC + 电子产品", priority: 1 },
          { market: "US", query: "FCC + Part 15 + 无线电设备", priority: 1 },
          { market: "US", query: "CPSIA + 铅含量 + 儿童产品邻接", priority: 2 },
          { market: "CN", query: "CCC + 音响设备 + 认证范围", priority: 1 },
        ],
      },
    },
    {
      id: "fanout",
      type: "fanout",
      label: "多市场并行检索",
      labelEn: "Multi-Market Parallel Search",
      icon: "⚡",
      status: "success",
      duration: "2.8s",
      confidence: 0.95,
      reasoning: "LangGraph 并行执行 5 个市场检索任务，利用 FAISS 向量数据库快速召回相关法规",
      children: [
        {
          id: "eu",
          type: "market",
          label: "🇪🇺 欧盟市场",
          labelEn: "🇪🇺 EU Market",
          icon: "🇪🇺",
          status: "success",
          duration: "1.1s",
          confidence: 0.98,
          reasoning: "找到 3 条相关法规：RoHS 3.0 修订提案(高风险)、REACH SVHC 新增 3 种物质(中风险)、RED 指令更新(低风险)",
          data: {
            regulations: 3,
            highRisk: 1,
            mediumRisk: 1,
            lowRisk: 1,
            topMatch: { title: "RoHS 3.0 限制物质扩展", score: 0.94 },
          },
        },
        {
          id: "us",
          type: "market",
          label: "🇺🇸 美国市场",
          labelEn: "🇺🇸 US Market",
          icon: "🇺🇸",
          status: "success",
          duration: "1.3s",
          confidence: 0.96,
          reasoning: "找到 2 条相关法规：FCC Part 15 无线电合规(高风险)、CPSIA 铅含量限值(中风险)",
          data: {
            regulations: 2,
            highRisk: 1,
            mediumRisk: 1,
            lowRisk: 0,
            topMatch: { title: "FCC Part 15 无线电设备", score: 0.91 },
          },
        },
        {
          id: "cn",
          type: "market",
          label: "🇨🇳 中国市场",
          labelEn: "🇨🇳 CN Market",
          icon: "🇨🇳",
          status: "success",
          duration: "0.9s",
          confidence: 0.97,
          reasoning: "找到 1 条相关法规：CCC 认证范围内含音响设备，需提前准备",
          data: {
            regulations: 1,
            highRisk: 0,
            mediumRisk: 1,
            lowRisk: 0,
            topMatch: { title: "CCC 强制性产品认证", score: 0.88 },
          },
        },
      ],
    },
    {
      id: "synthesis",
      type: "synthesis",
      label: "综合分析与报告生成",
      labelEn: "Synthesis & Report",
      icon: "📊",
      status: "success",
      duration: "3.5s",
      confidence: 0.93,
      reasoning: "聚合多市场检索结果，使用 LLM 生成结构化合规评估报告，计算综合风险评分",
      data: {
        reportSections: ["执行摘要", "市场风险评估", "合规清单", "行动计划", "时间线"],
        generatedAt: new Date().toISOString(),
      },
    },
    {
      id: "result",
      type: "result",
      label: "合规评估结果",
      labelEn: "Compliance Result",
      icon: "✅",
      status: "success",
      confidence: 0.95,
      reasoning: "综合评分 85/100，等级 B。主要风险：RoHS 3.0 和 FCC Part 15。建议立即启动合规准备",
      data: {
        score: 85,
        grade: "B",
        status: "needs_attention",
        totalRisks: 5,
        highRisk: 2,
        mediumRisk: 3,
        lowRisk: 0,
        recommendations: [
          { priority: 1, action: "准备 RoHS 3.0 豁免申请", deadline: "2026-06-01" },
          { priority: 2, action: "进行 FCC 射频测试", deadline: "2026-06-15" },
          { priority: 3, action: "更新 REACH 声明文件", deadline: "2026-07-01" },
        ],
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
  reasoning: "💡",
};

const typeColors: Record<string, { bg: string; border: string; text: string; light: string }> = {
  input: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600", light: "bg-blue-100" },
  vision: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-600", light: "bg-purple-100" },
  planner: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-600", light: "bg-amber-100" },
  fanout: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-600", light: "bg-emerald-100" },
  market: { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-600", light: "bg-cyan-100" },
  synthesis: { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-600", light: "bg-indigo-100" },
  result: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-600", light: "bg-rose-100" },
  reasoning: { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-600", light: "bg-yellow-100" },
};

const typeLabels: Record<string, { zh: string; en: string }> = {
  input: { zh: "输入", en: "Input" },
  vision: { zh: "视觉识别", en: "Vision" },
  planner: { zh: "查询规划", en: "Planner" },
  fanout: { zh: "并行检索", en: "Fanout" },
  market: { zh: "市场检索", en: "Market" },
  synthesis: { zh: "综合分析", en: "Synthesis" },
  result: { zh: "评估结果", en: "Result" },
  reasoning: { zh: "推理过程", en: "Reasoning" },
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

function ConfidenceBadge({ confidence }: { confidence?: number }) {
  if (!confidence) return null;
  const percentage = Math.round(confidence * 100);
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600">
      <Zap className="w-3 h-3" />
      {percentage}%
    </span>
  );
}

function RiskBadge({ level, count, locale }: { level: "high" | "medium" | "low"; count: number; locale: "zh" | "en" }) {
  if (count === 0) return null;
  const config = {
    high: { bg: "bg-red-100", text: "text-red-700", label: locale === "en" ? "高风险" : "High Risk" },
    medium: { bg: "bg-amber-100", text: "text-amber-700", label: locale === "en" ? "中风险" : "Medium Risk" },
    low: { bg: "bg-green-100", text: "text-green-700", label: locale === "en" ? "低风险" : "Low Risk" },
  };
  const { bg, text, label } = config[level];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${bg} ${text}`}>
      <AlertTriangle className="w-3 h-3" />
      {count} {label}
    </span>
  );
}

function ReasoningPanel({ text, locale }: { text?: string; locale: "zh" | "en" }) {
  if (!text) return null;
  return (
    <div className={`mt-3 p-3 rounded-lg border-l-4 border-yellow-400 ${typeColors.reasoning.bg}`}>
      <div className="flex items-start gap-2">
        <Lightbulb className={`w-4 h-4 mt-0.5 flex-shrink-0 ${typeColors.reasoning.text}`} />
        <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function ResultCard({ data, locale }: { data: Record<string, unknown>; locale: "zh" | "en" }) {
  const score = typeof data.score === "number" ? data.score : 0;
  const grade = String(data.grade || "");
  const status = String(data.status || "");
  const highRisk = typeof data.highRisk === "number" ? data.highRisk : 0;
  const mediumRisk = typeof data.mediumRisk === "number" ? data.mediumRisk : 0;
  const lowRisk = typeof data.lowRisk === "number" ? data.lowRisk : 0;
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations as Array<{ priority: number; action: string; deadline: string }> : [];

  const gradeColors: Record<string, string> = {
    A: "bg-green-100 text-green-700",
    B: "bg-blue-100 text-blue-700",
    C: "bg-amber-100 text-amber-700",
    D: "bg-orange-100 text-orange-700",
    F: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-4">
      {/* Score and Grade */}
      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <div className="text-4xl font-bold text-blaze-red">{score}</div>
          <div className="text-xs text-gray-500 mt-1">{locale === "en" ? "Compliance Score" : "合规评分"}</div>
        </div>
        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${gradeColors[grade] || "bg-gray-100"}`}>
          {grade}
        </div>
      </div>

      {/* Risk Summary */}
      <div className="flex items-center justify-center gap-2">
        <RiskBadge level="high" count={highRisk} locale={locale} />
        <RiskBadge level="medium" count={mediumRisk} locale={locale} />
        <RiskBadge level="low" count={lowRisk} locale={locale} />
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="border-t pt-4">
          <h5 className="text-sm font-medium text-gray-700 mb-2">
            {locale === "en" ? "Recommended Actions" : "建议行动"}
          </h5>
          <div className="space-y-2">
            {recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                  rec.priority === 1 ? "bg-red-100 text-red-600" : rec.priority === 2 ? "bg-amber-100 text-amber-600" : "bg-gray-100 text-gray-600"
                }`}>
                  {rec.priority}
                </span>
                <div className="flex-1">
                  <span className="text-gray-700">{rec.action}</span>
                  <span className="text-gray-400 text-xs ml-2">⏰ {rec.deadline}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MarketNode({ node, locale }: { node: TraceNode; locale: "zh" | "en" }) {
  const data = node.data as { regulations?: number; highRisk?: number; mediumRisk?: number; lowRisk?: number; topMatch?: { title: string; score: number } } | undefined;
  const totalRisks = (data?.highRisk || 0) + (data?.mediumRisk || 0) + (data?.lowRisk || 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">
          {locale === "en" ? "Found" : "找到"} {data?.regulations || 0} {locale === "en" ? "regulations" : "条法规"}
        </span>
        <ConfidenceBadge confidence={node.confidence} />
      </div>
      <div className="flex items-center gap-2">
        <RiskBadge level="high" count={data?.highRisk || 0} locale={locale} />
        <RiskBadge level="medium" count={data?.mediumRisk || 0} locale={locale} />
        <RiskBadge level="low" count={data?.lowRisk || 0} locale={locale} />
      </div>
      {data?.topMatch && (
        <div className="text-xs text-gray-500 mt-2">
          {locale === "en" ? "Top match" : "最高匹配"}: {data.topMatch.title} ({Math.round(data.topMatch.score * 100)}%)
        </div>
      )}
    </div>
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
  const [expanded, setExpanded] = useState(depth <= 1);
  const [showReasoning, setShowReasoning] = useState(false);
  const hasChildren = node.children && node.children.length > 0;
  const colors = typeColors[node.type] || typeColors.input;
  const label = locale === "en" ? node.labelEn : node.label;

  const handleToggle = () => {
    if (hasChildren) {
      setExpanded(!expanded);
    }
  };

  return (
    <div className="relative">
      {/* Connector line */}
      {depth > 0 && (
        <div className="absolute -left-4 top-6 w-4 h-px bg-gray-300" />
      )}

      {/* Node card */}
      <div
        className={`relative rounded-xl border-2 ${colors.bg} ${colors.border} p-4 transition-all duration-200 ${
          depth === 0 ? "" : "hover:shadow-md hover:border-opacity-70"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${colors.light} shadow-sm`}>
              <span className="text-2xl">{node.icon || typeIcons[node.type]}</span>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900">{label}</h4>
              <div className="flex items-center gap-2 mt-0.5">
                {node.duration && (
                  <span className="text-xs text-gray-500 font-mono">{node.duration}</span>
                )}
                <ConfidenceBadge confidence={node.confidence} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StatusIcon status={node.status} />
            {node.reasoning && (
              <button
                onClick={() => setShowReasoning(!showReasoning)}
                className={`p-1.5 rounded-lg transition-colors ${showReasoning ? colors.light : "hover:bg-gray-100"}`}
                title={locale === "en" ? "Toggle reasoning" : "显示推理过程"}
              >
                <Lightbulb className={`w-5 h-5 ${colors.text}`} />
              </button>
            )}
            {hasChildren && (
              <button
                onClick={handleToggle}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
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
        {showReasoning && node.reasoning && (
          <ReasoningPanel text={node.reasoning} locale={locale} />
        )}

        {/* Data content */}
        {node.data && !showReasoning && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            {node.type === "result" && <ResultCard data={node.data} locale={locale} />}
            {node.type === "market" && <MarketNode node={node} locale={locale} />}
          </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="mt-3 ml-6 pl-4 border-l-2 border-dashed border-gray-300 space-y-3">
          {node.children!.map((child, index) => (
            <TraceNodeComponent key={child.id} node={child} locale={locale} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentDecisionTree({ traceData, locale = "zh" }: DecisionTreeProps) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    setAnimated(true);
  }, []);

  const data = traceData || demoTrace;
  const totalTime = data.children?.reduce((acc, child) => {
    const duration = child.duration?.replace("s", "") || "0";
    return acc + parseFloat(duration);
  }, 0) || 0;

  const totalSteps = 1 + (data.children?.length || 0) + (data.children?.reduce((acc, child) => acc + (child.children?.length || 0), 0) || 0);

  return (
    <div className={`w-full transition-opacity duration-500 ${animated ? "opacity-100" : "opacity-0"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-900">
            {locale === "en" ? "AI Agent Decision Tree" : "AI Agent 决策链路"}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {locale === "en" ? "Autonomous compliance analysis process" : "自主合规分析执行过程"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-lg font-mono font-bold text-gray-900">{totalTime}s</div>
            <div className="text-xs text-gray-500">{locale === "en" ? "Total Time" : "总耗时"}</div>
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div className="text-right">
            <div className="text-lg font-mono font-bold text-gray-900">{totalSteps}</div>
            <div className="text-xs text-gray-500">{locale === "en" ? "Steps" : "执行步骤"}</div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(typeColors).map(([type, colors]) => (
          <div
            key={type}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${colors.bg} ${colors.border} border`}
          >
            <span className="text-base">{typeIcons[type]}</span>
            <span className="text-xs font-medium text-gray-700">
              {locale === "en" ? typeLabels[type].en : typeLabels[type].zh}
            </span>
          </div>
        ))}
      </div>

      {/* Tree */}
      <div className="bg-gradient-to-br from-gray-50 to-white rounded-2xl border border-gray-200 p-6 shadow-inner">
        <TraceNodeComponent node={data} locale={locale} />
      </div>

      {/* Footer stats */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="bg-green-50 rounded-lg p-3 border border-green-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">{locale === "en" ? "Analysis Complete" : "分析完成"}</span>
          </div>
          <div className="text-xs text-green-600 mt-1">4 {locale === "en" ? "markets scanned" : "个市场已扫描"}</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-600" />
            <span className="text-sm font-medium text-blue-800">{locale === "en" ? "LangGraph Powered" : "LangGraph 驱动"}</span>
          </div>
          <div className="text-xs text-blue-600 mt-1">FAISS + {locale === "en" ? "Vector Search" : "向量检索"}</div>
        </div>
        <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
          <div className="flex items-center gap-2">
            <FileSearch className="w-5 h-5 text-purple-600" />
            <span className="text-sm font-medium text-purple-800">{locale === "en" ? "Regulations Found" : "检索到法规"}</span>
          </div>
          <div className="text-xs text-purple-600 mt-1">6 {locale === "en" ? "relevant regulations" : "条相关法规"}</div>
        </div>
      </div>
    </div>
  );
}