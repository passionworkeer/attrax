import { getSession } from "@/lib/pipeline/session-store";
import { serverT } from "@/lib/server-i18n";
import { ok, fail } from "@/lib/api-response";
import { requireSessionAccess } from "@/app/api/session-access";
import { SessionIdSchema } from "@/lib/schemas";
import { backendAccessTokenFromRequest } from "@/app/api/backend-session-access";
import { getRoadmap, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";

export const runtime = "nodejs";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  const validTypes = new Set(["apply", "test", "certify", "complete"]);
  const validStatuses = new Set(["pending", "in-progress", "completed"]);
  return value
    .filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null,
    )
    .map((item, index) => {
      const title =
        typeof item.title === "string" && item.title.trim()
          ? item.title.trim()
          : null;
      const titleEn =
        typeof item.titleEn === "string"
          ? item.titleEn
          : typeof item.title_en === "string"
            ? item.title_en
            : null;
      if (!title && !titleEn) return null;
      return {
        id: String(item.id ?? index + 1),
        date: typeof item.date === "string" ? item.date : null,
        title: title ?? titleEn,
        titleEn,
        description:
          typeof item.description === "string" ? item.description : "",
        descriptionEn:
          typeof item.descriptionEn === "string"
            ? item.descriptionEn
            : typeof item.description_en === "string"
              ? item.description_en
              : "",
        type: validTypes.has(String(item.type)) ? item.type : "apply",
        status: validStatuses.has(String(item.status))
          ? item.status
          : "pending",
        estimatedDays:
          typeof item.estimatedDays === "number"
            ? item.estimatedDays
            : typeof item.estimated_days === "number"
              ? item.estimated_days
              : null,
        cost: typeof item.cost === "string" ? item.cost : null,
        documents: Array.isArray(item.documents)
          ? item.documents.map(String)
          : [],
        documentsEn: Array.isArray(item.documentsEn)
          ? item.documentsEn.map(String)
          : Array.isArray(item.documents_en)
            ? item.documents_en.map(String)
            : [],
      };
    })
    .filter(Boolean);
}

function localRoadmap(sessionId: string, resultValue: unknown) {
  const result = record(resultValue);
  const reportPackage = record(
    result.reportPackage ?? result.report_package,
  );
  const roadmap = record(reportPackage.roadmap);
  const items = normalizeItems(roadmap.items);
  if (!items.length) {
    return fail(
      { code: "NOT_FOUND", message: "Roadmap not available" },
      { status: 404 },
    );
  }

  const score = result.complianceScore ?? result.compliance_score;
  const markets = result.targetMarkets ?? result.target_markets;
  // Audit P1-I: surface the backend's decisionView verdict so the roadmap
  // page's PDF/DOCX export reflects reality ("PASS" / "WARN" / "REJECTED")
  // instead of hard-coding REJECTED whenever any real roadmap exists.
  const decisionView = record(reportPackage.decisionView);
  const decisionVerdict =
    typeof (decisionView.verdict ?? decisionView.verdict) === "string"
      ? (decisionView.verdict ?? decisionView.verdict)
      : null;
  const decisionRiskLevel =
    typeof (decisionView.riskLevel ?? decisionView.risk_level) === "string"
      ? (decisionView.riskLevel ?? decisionView.risk_level)
      : null;
  return ok({
    sessionId,
    product:
      result.productName ??
      result.product_name ??
      result.product ??
      null,
    productEn:
      result.productNameEn ??
      result.product_name_en ??
      null,
    markets: Array.isArray(markets) ? markets.map(String) : [],
    complianceScore:
      typeof score === "number" && Number.isFinite(score) ? score : null,
    complianceStatus:
      typeof (result.complianceStatus ?? result.compliance_status) === "string"
        ? result.complianceStatus ?? result.compliance_status
        : "UNKNOWN",
    verdict: decisionVerdict,
    riskLevel: decisionRiskLevel,
    totalDays:
      typeof (roadmap.totalDays ?? roadmap.total_days) === "number"
        ? roadmap.totalDays ?? roadmap.total_days
        : null,
    progress:
      typeof roadmap.progress === "number" ? roadmap.progress : null,
    totalCost:
      typeof (roadmap.totalCost ?? roadmap.total_cost) === "string"
        ? roadmap.totalCost ?? roadmap.total_cost
        : null,
    items,
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
      const roadmap = await getRoadmap({ sessionId, accessToken });
      const items = normalizeItems(roadmap.items);
      if (!items.length) {
        return fail(
          { code: "NOT_FOUND", message: "Roadmap not available" },
          { status: 404 },
        );
      }
      return ok({ sessionId, ...roadmap, items });
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
  if (!session.result) {
    return fail(
      { code: "NOT_READY", message: serverT("errors.resultNotReady", "zh") },
      { status: 409 },
    );
  }
  return localRoadmap(sessionId, session.result);
}
