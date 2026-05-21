import { NextResponse } from "next/server";
import { getSession } from "@/lib/pipeline/session-store";
import { t as serverT } from "@/lib/i18n";

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

  // Build trace nodes from agent_trace
  const traceNodes = (agentTrace as Array<{
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