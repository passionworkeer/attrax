import { NextResponse } from "next/server";
import { getSession } from "@/lib/pipeline/session-store";
import { t as serverT } from "@/lib/i18n";
import type { ReportPackage } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: serverT("errors.sessionNotFound", "zh") } },
      { status: 404 }
    );
  }

  const result = session.result;
  if (!result) {
    return NextResponse.json(
      { error: { code: "NOT_READY", message: serverT("errors.resultNotReady", "zh") } },
      { status: 404 }
    );
  }

  // Build trace data from agent_trace
  const agentTrace = (result as { agentTrace?: unknown[] }).agentTrace || [];
  const decisionView = _getDecisionView(_getReportPackage(result));

  // Extract execution stats
  const totalTime = (agentTrace as Array<{ duration_ms?: number; duration?: number }>).reduce((acc, entry) => {
    return acc + (entry.duration_ms || entry.duration || 0);
  }, 0) / 1000;

  const steps = agentTrace.length;

  // Extract market info from retrievedChunks or use defaults
  const retrievedChunks = (result as { retrievedChunks?: Array<{ region?: string; docName?: string }> }).retrievedChunks || [];
  const markets = new Set<string>();
  const regulations = new Set<string>();

  for (const chunk of retrievedChunks) {
    if (chunk.region) markets.add(chunk.region);
    if (chunk.docName) regulations.add(chunk.docName);
  }

  // If no market data, derive from targetMarkets
  const targetMarkets = (result as { targetMarkets?: string[] }).targetMarkets || [];
  for (const m of targetMarkets) {
    markets.add(m);
  }

  // Build trace nodes from generated decision content when present,
  // otherwise fall back to raw runtime agent_trace.
  const traceNodes = decisionView?.nodes?.length
    ? _normalizeDecisionNodes(decisionView.nodes)
    : (agentTrace as Array<{
        node: string;
        status?: string;
        duration_ms?: number;
        duration?: number;
        score?: number;
        docs_retrieved?: number;
      }>).map((entry) => ({
        id: entry.node,
        type: entry.node,
        label: _getNodeLabel(entry.node),
    icon: "📊",
        status: entry.status?.toLowerCase() || "pending",
        duration: `${((entry.duration_ms || entry.duration) || 0) / 1000}s`,
        confidence: entry.score || 0,
      }));

  return NextResponse.json({
    sessionId,
    totalTime: totalTime.toFixed(1),
    steps,
    markets: markets.size || 4,
    regulations: regulations.size || 6,
    score: (result as { complianceScore?: number }).complianceScore || 85,
    grade: (result as { scoreGrade?: string }).scoreGrade || "B",
    decisionView,
    traceNodes,
    retrievedChunks,
  });
}

// Agent node labels - kept as technical identifiers in the default locale
function _getNodeLabel(node: string): string {
  const labels: Record<string, string> = {
    vision: "视觉识别",
    query_planner: "查询规划",
    retriever: "文档检索",
    synthesis: "综合分析",
    generate: "报告生成",
    verify: "验证审核",
    refine: "优化迭代",
    fan_out: "并行检索",
  };
  return labels[node] || node;
}

function _normalizeDecisionNodes(nodes: unknown[]) {
  return nodes.filter((node): node is Record<string, unknown> => typeof node === "object" && node !== null).map((node, index) => ({
    id: String(node.id ?? node.type ?? `node_${index + 1}`),
    type: String(node.type ?? "synthesis"),
    label: String(node.label ?? node.type ?? `Step ${index + 1}`),
    labelEn: typeof node.labelEn === "string" ? node.labelEn : typeof node.label_en === "string" ? node.label_en : undefined,
    icon: typeof node.icon === "string" ? node.icon : "馃搳",
    status: typeof node.status === "string" ? node.status.toLowerCase() : "success",
    duration: typeof node.duration === "string" ? node.duration : "0s",
    confidence: typeof node.confidence === "number" ? node.confidence : 0,
    reasoning: typeof node.reasoning === "string" ? node.reasoning : undefined,
    reasoningEn:
      typeof node.reasoningEn === "string"
        ? node.reasoningEn
        : typeof node.reasoning_en === "string"
        ? node.reasoning_en
        : undefined,
  }));
}

function _getReportPackage(result: unknown): ReportPackage | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as { reportPackage?: ReportPackage; report_package?: ReportPackage };
  return record.reportPackage ?? record.report_package;
}

function _getDecisionView(reportPackage: ReportPackage | undefined) {
  return reportPackage?.decisionView ?? reportPackage?.decision_view;
}
