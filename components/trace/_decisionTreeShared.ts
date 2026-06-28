/**
 * _decisionTreeShared.ts — internals split out of AgentDecisionTree.tsx to
 * bring it under the 800-line ceiling. NOT part of the public component API;
 * only AgentDecisionTree + DecisionTreeParts import from here.
 */
import type { TraceNode } from "./AgentDecisionTree";

export type { TraceNode };

export const typeIcons: Record<string, string> = {
  input: "📷",
  vision: "🧠",
  planner: "📋",
  fanout: "⚡",
  market: "🌍",
  synthesis: "📊",
  result: "✅",
};

export const typeColors: Record<string, { bg: string; border: string; text: string; light: string; dark: string }> = {
  input: { bg: "bg-blue-500/15", border: "border-blue-500/40", text: "text-blue-300", light: "bg-blue-500/25", dark: "bg-blue-500" },
  vision: { bg: "bg-purple-500/15", border: "border-purple-500/40", text: "text-purple-300", light: "bg-purple-500/25", dark: "bg-purple-500" },
  planner: { bg: "bg-amber-500/15", border: "border-amber-500/40", text: "text-amber-300", light: "bg-amber-500/25", dark: "bg-amber-500" },
  fanout: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", text: "text-emerald-300", light: "bg-emerald-500/25", dark: "bg-emerald-500" },
  market: { bg: "bg-cyan-500/15", border: "border-cyan-500/40", text: "text-cyan-300", light: "bg-cyan-500/25", dark: "bg-cyan-500" },
  synthesis: { bg: "bg-indigo-500/15", border: "border-indigo-500/40", text: "text-indigo-300", light: "bg-indigo-500/25", dark: "bg-indigo-500" },
  result: { bg: "bg-blaze-red/15", border: "border-blaze-red/40", text: "text-blaze-red", light: "bg-blaze-red/25", dark: "bg-blaze-red" },
};

const HAN_TEXT_RE = /\p{Script=Han}/u;

export function englishFallback(value: string | undefined, fallback: string): string {
  if (!value || HAN_TEXT_RE.test(value)) return fallback;
  return value;
}

export function englishOptional(value: string | undefined): string | undefined {
  return value && !HAN_TEXT_RE.test(value) ? value : undefined;
}

// Convert API response to TraceNode format
export function buildTraceTreeFromApi(nodes: {
  id?: string;
  type?: string;
  label?: string;
  labelEn?: string;
  icon?: string;
  status?: string;
  duration?: string;
  confidence?: number;
  reasoning?: string;
  reasoningEn?: string;
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
    const nodeType = (typeMap[node.type || ""] || "synthesis") as TraceNode["type"];
    const nodeLabel = labelMap[node.type || ""];
    const rawLabel = node.label || nodeLabel?.zh || node.type || "";
    const rawReasoning = node.reasoning;
    return {
      id: node.id || node.type || "node",
      type: nodeType,
      label: rawLabel,
      labelEn: englishFallback(node.labelEn || nodeLabel?.en || node.label, node.type || "Step"),
      icon: iconMap[node.type || ""] || "📊",
      status: (node.status as TraceNode["status"]) || "pending",
      duration: node.duration || "0s",
      confidence: node.confidence || 0,
      reasoning: rawReasoning,
      reasoningEn: node.reasoningEn || englishOptional(rawReasoning),
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
export const demoTrace: TraceNode = {
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
