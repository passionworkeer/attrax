import { getSession } from "@/lib/pipeline/session-store";
import { serverT } from "@/lib/server-i18n";
import { ok, fail } from "@/lib/api-response";
import { requireSessionAccess } from "@/app/api/session-access";
import { SessionIdSchema } from "@/lib/schemas";
import { backendAccessTokenFromRequest } from "@/app/api/backend-session-access";
import { getScan, getTrace, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";

export const runtime = "nodejs";

interface AgentTraceEntry {
  node?: unknown;
  status?: unknown;
  duration_ms?: unknown;
  durationMs?: unknown;
  duration?: unknown;
  score?: unknown;
  docs_retrieved?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function durationMs(entry: AgentTraceEntry): number {
  for (const value of [entry.durationMs, entry.duration_ms, entry.duration]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return 0;
}

function nodeLabels(node: string): { label: string; labelEn: string } {
  const labels: Record<string, { label: string; labelEn: string }> = {
    vision: { label: "视觉识别", labelEn: "Vision Analysis" },
    query_planner: { label: "查询规划", labelEn: "Query Planning" },
    retriever: { label: "文档检索", labelEn: "Document Retrieval" },
    synthesis: { label: "综合分析", labelEn: "Synthesis" },
    generate: { label: "报告生成", labelEn: "Report Generation" },
    verify: { label: "验证审核", labelEn: "Verification" },
    refine: { label: "优化迭代", labelEn: "Refinement" },
    fan_out: { label: "并行检索", labelEn: "Parallel Retrieval" },
  };
  return labels[node] ?? { label: node, labelEn: node };
}

function traceResponse(
  sessionId: string,
  entries: AgentTraceEntry[],
  rawResult: Record<string, unknown>,
  fallbackMarkets: string[] = [],
) {
  if (!entries.length) {
    return fail(
      { code: "NOT_FOUND", message: "Execution trace not available" },
      { status: 404 },
    );
  }

  const retrievedChunks = array(
    rawResult.retrievedChunks ?? rawResult.retrieved_chunks,
  ).map(record);
  const targetMarkets = array(
    rawResult.targetMarkets ?? rawResult.target_markets,
  )
    .map(String)
    .filter(Boolean);
  const markets = new Set(targetMarkets.length ? targetMarkets : fallbackMarkets);
  const regulations = new Set<string>();
  for (const chunk of retrievedChunks) {
    const region = chunk.region;
    const document = chunk.docName ?? chunk.doc_name ?? chunk.sourceId ?? chunk.source_id;
    if (typeof region === "string" && region) markets.add(region);
    if (typeof document === "string" && document) regulations.add(document);
  }

  const traceNodes = entries.map((entry, index) => {
    const node =
      typeof entry.node === "string" && entry.node
        ? entry.node
        : `step-${index + 1}`;
    const elapsed = durationMs(entry);
    return {
      ...nodeLabels(node),
      id: `${node}-${index + 1}`,
      type: node,
      icon: "📊",
      status:
        typeof entry.status === "string"
          ? entry.status.toLowerCase()
          : "unknown",
      duration: `${(elapsed / 1000).toFixed(3)}s`,
      confidence:
        typeof entry.score === "number" && Number.isFinite(entry.score)
          ? entry.score
          : 0,
    };
  });

  const scoreValue = rawResult.complianceScore ?? rawResult.compliance_score;
  const gradeValue = rawResult.scoreGrade ?? rawResult.score_grade;
  const totalTime =
    entries.reduce((total, entry) => total + durationMs(entry), 0) / 1000;

  return ok({
    sessionId,
    totalTime: totalTime.toFixed(3),
    steps: entries.length,
    markets: markets.size,
    regulations: regulations.size,
    score:
      typeof scoreValue === "number" && Number.isFinite(scoreValue)
        ? scoreValue
        : 0,
    grade: typeof gradeValue === "string" ? gradeValue : "UNKNOWN",
    traceNodes,
    retrievedChunks,
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  if (!SessionIdSchema.safeParse(sessionId).success) {
    return fail(
      { code: "NOT_FOUND", message: serverT("errors.sessionNotFound", "zh") },
      { status: 404 },
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    const accessToken = backendAccessTokenFromRequest(request, sessionId);
    if (!accessToken) {
      return fail(
        { code: "UNAUTHORIZED", message: "Missing access token" },
        { status: 401 },
      );
    }
    try {
      const [trace, upstream] = await Promise.all([
        getTrace({ sessionId, accessToken }),
        getScan({ sessionId, accessToken }),
      ]);
      return traceResponse(
        sessionId,
        trace as AgentTraceEntry[],
        record(upstream.result),
        upstream.markets,
      );
    } catch (error) {
      if (error instanceof V1EnvelopeError) {
        return fail(
          { code: error.code, message: error.message },
          { status: error.httpStatus },
        );
      }
      return fail(
        { code: "SCAN_SERVICE_UNAVAILABLE", message: "Scan service unavailable" },
        { status: 502 },
      );
    }
  }

  const denied = requireSessionAccess(request, session);
  if (denied) return denied;
  const rawResult = record(session.result);
  const entries = array(
    rawResult.agentTrace ?? rawResult.agent_trace,
  ) as AgentTraceEntry[];
  return traceResponse(sessionId, entries, rawResult);
}
