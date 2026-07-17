import { getSession } from "@/lib/pipeline/session-store";
import { serverT } from "@/lib/server-i18n";
import { ok, fail } from "@/lib/api-response";
import { requireSessionAccess } from "@/app/api/session-access";
import { SessionIdSchema } from "@/lib/schemas";
import type { ComplianceReportResult, ReportPackage } from "@/lib/types";
import { backendAccessTokenFromRequest } from "@/app/api/backend-session-access";
import { getScan, getTrace, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { normalizeV1ScanResult } from "@/lib/rag-client/v1-result-adapter";

export const runtime = "nodejs";

/**
 * Shape of `session.result` fields this route actually consumes. Mirrors
 * `ComplianceReportResult` from lib/types.ts but narrowed to the subset used
 * here so the union with ScanResult (which lacks agentTrace) does not require
 * ad-hoc `as` casts at every read site.
 */
type TraceResult = Pick<
  ComplianceReportResult,
  | "agentTrace"
  | "retrievedChunks"
  | "targetMarkets"
  | "complianceScore"
  | "scoreGrade"
  | "reportPackage"
>;

// Loose entry shape for the heterogeneous agent_trace records. Each entry has
// a `node` name plus optional timing/score fields that vary by node kind —
// kept as a structural type rather than an `unknown`-cast to keep field names
// auditable.
interface AgentTraceEntry {
  node: string;
  status?: string;
  duration_ms?: number;
  duration?: number;
  score?: number;
  docs_retrieved?: number;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;

  if (!SessionIdSchema.safeParse(sessionId).success) {
    return fail(
      { code: "NOT_FOUND", message: serverT("errors.sessionNotFound", "zh") },
      { status: 404 }
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    const accessToken = backendAccessTokenFromRequest(request, sessionId);
    if (!accessToken) {
      return fail({ code: "UNAUTHORIZED", message: "Missing access token" }, { status: 401 });
    }
    try {
      const [trace, upstreamSession] = await Promise.all([
        getTrace({ sessionId, accessToken }),
        getScan({ sessionId, accessToken }),
      ]);
      const normalized = normalizeV1ScanResult(upstreamSession);
      const traceNodes = trace.map((entry, index) => {
        const node = String(entry.node ?? `step-${index + 1}`);
        const durationMs = typeof entry.duration_ms === "number"
          ? entry.duration_ms
          : typeof entry.duration === "number"
            ? entry.duration
            : 0;
        return {
          ..._getNodeLabels(node),
          id: node,
          type: node,
          icon: "📊",
          status: typeof entry.status === "string" ? entry.status.toLowerCase() : "pending",
          duration: `${durationMs / 1000}s`,
          confidence: typeof entry.score === "number" ? entry.score : 0,
        };
      });
      const totalTime = trace.reduce((total, entry) => {
        const duration = typeof entry.duration_ms === "number"
          ? entry.duration_ms
          : typeof entry.duration === "number"
            ? entry.duration
            : 0;
        return total + duration;
      }, 0) / 1000;
      const rawResult = upstreamSession.result ?? {};
      const retrievedChunks = Array.isArray(rawResult.retrievedChunks)
        ? rawResult.retrievedChunks
        : [];
      return ok({
        sessionId,
        totalTime: totalTime.toFixed(1),
        steps: trace.length,
        markets: upstreamSession.markets.length,
        regulations: retrievedChunks.length,
        score: normalized?.complianceScore ?? 0,
        grade: normalized?.scoreGrade ?? "C",
        traceNodes,
        retrievedChunks,
      });
    } catch (error) {
      if (error instanceof V1EnvelopeError) {
        return fail({ code: error.code, message: error.message }, { status: error.httpStatus });
      }
      return fail({ code: "RAG_SERVICE_UNAVAILABLE", message: "RAG service unavailable" }, { status: 502 });
    }
  }

  const denied = requireSessionAccess(request, session);
  if (denied) return denied;

  // Narrow to the field subset this route reads; absence collapses to safe
  // defaults below (no `as` casts needed at read sites).
  const result = session.result as Partial<TraceResult> | undefined;
  if (!result) {
    return fail(
      { code: "NOT_READY", message: serverT("errors.resultNotReady", "zh") },
      { status: 404 }
    );
  }

  // Build trace data from agent_trace
  const agentTrace: AgentTraceEntry[] = (result.agentTrace ?? []) as AgentTraceEntry[];
  const decisionView = _getDecisionView(_getReportPackage(result));

  // Extract execution stats
  const totalTime = agentTrace.reduce((acc, entry) => {
    return acc + (entry.duration_ms ?? entry.duration ?? 0);
  }, 0) / 1000;

  const steps = agentTrace.length;

  // Extract market info from retrievedChunks or use defaults
  const retrievedChunks = result.retrievedChunks ?? [];
  const markets = new Set<string>();
  const regulations = new Set<string>();

  for (const chunk of retrievedChunks) {
    if (chunk.region) markets.add(chunk.region);
    if (chunk.docName) regulations.add(chunk.docName);
  }

  // If no market data, derive from targetMarkets
  const targetMarkets = result.targetMarkets ?? [];
  for (const m of targetMarkets) {
    markets.add(m);
  }

  // Build trace nodes from generated decision content when present,
  // otherwise fall back to raw runtime agent_trace.
  const traceNodes = decisionView?.nodes?.length
    ? _normalizeDecisionNodes(decisionView.nodes)
    : agentTrace.map((entry) => ({
        ..._getNodeLabels(entry.node),
        id: entry.node,
        type: entry.node,
        icon: "📊",
        status: entry.status?.toLowerCase() || "pending",
        duration: `${((entry.duration_ms ?? entry.duration) ?? 0) / 1000}s`,
        confidence: entry.score || 0,
      }));

  return ok({
    sessionId,
    totalTime: totalTime.toFixed(1),
    steps,
    markets: markets.size || 4,
    regulations: regulations.size || 6,
    score: result.complianceScore ?? 85,
    grade: result.scoreGrade ?? "B",
    decisionView,
    traceNodes,
    retrievedChunks,
  });
}

// Agent node labels - API returns both locales so clients do not infer labels.
function _getNodeLabels(node: string): { label: string; labelEn: string } {
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
  return labels[node] || { label: node, labelEn: node };
}

const HAN_TEXT_RE = /\p{Script=Han}/u;

function _englishFallback(value: string | undefined, fallback: string): string {
  if (!value || HAN_TEXT_RE.test(value)) return fallback;
  return value;
}

function _englishOptional(value: string | undefined): string | undefined {
  return value && !HAN_TEXT_RE.test(value) ? value : undefined;
}

function _normalizeDecisionNodes(nodes: unknown[]) {
  return nodes.filter((node): node is Record<string, unknown> => typeof node === "object" && node !== null).map((node, index) => {
    const type = String(node.type ?? "synthesis");
    const label = String(node.label ?? type ?? `Step ${index + 1}`);
    const explicitLabelEn =
      typeof node.labelEn === "string"
        ? node.labelEn
        : typeof node.label_en === "string"
        ? node.label_en
        : undefined;
    const reasoning = typeof node.reasoning === "string" ? node.reasoning : undefined;
    const explicitReasoningEn =
      typeof node.reasoningEn === "string"
        ? node.reasoningEn
        : typeof node.reasoning_en === "string"
        ? node.reasoning_en
        : undefined;

    return {
      id: String(node.id ?? type ?? `node_${index + 1}`),
      type,
      label,
      labelEn: _englishFallback(explicitLabelEn ?? label, type),
      icon: typeof node.icon === "string" ? node.icon : "📊",
      status: typeof node.status === "string" ? node.status.toLowerCase() : "success",
      duration: typeof node.duration === "string" ? node.duration : "0s",
      confidence: typeof node.confidence === "number" ? node.confidence : 0,
      reasoning,
      reasoningEn: explicitReasoningEn ?? _englishOptional(reasoning),
    };
  });
}

function _getReportPackage(result: unknown): ReportPackage | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as { reportPackage?: ReportPackage; report_package?: ReportPackage };
  return record.reportPackage ?? record.report_package;
}

function _getDecisionView(reportPackage: ReportPackage | undefined) {
  return reportPackage?.decisionView ?? reportPackage?.decision_view;
}
