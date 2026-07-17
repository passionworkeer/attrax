/**
 * app/api/scan/[sessionId]/route.ts — GET /api/scan/[sessionId] (handoff BFF)
 *
 * Polls the FastAPI v1 backend for scan status. Pages call `/api/scan/{id}`;
 * this route forwards to `/api/v1/scans/{id}` with a Bearer access token.
 *
 * Auth: token is required for real sessions. Accepted sources (in priority
 * order):
 *   1. `Authorization: Bearer <token>` header (preferred — never logged)
 *   2. `?token=<token>` query param (opt-in fallback for clients that can't
 *      send custom headers; flagged in the handoff report as a known
 *      convenience that should be removed once the upload page persists
 *      the token and sends it as a header)
 *
 * `sessionId === "demo"` short-circuits to the legacy mock — preserves the
 * QA / design-preview flow that pages rely on.
 *
 * Response shape: uses `ok()` from `lib/api-response` so legacy callers that
 * read `body.sessionId` / `body.status` at the top level (upload/burning/
 * result pages and existing tests) keep working unchanged.
 */
import {
  getScan,
  isDemoSession,
  V1EnvelopeError,
} from "@/lib/rag-client/v1-adapter";
import { ok, fail } from "@/lib/api-response";
import { createMockComplianceReportResult } from "@/lib/mock/scan-result";
import type { ScanStatus } from "@/lib/types";

export const runtime = "nodejs";

function extractAccessToken(request: Request): string | null {
  // 1) Bearer header — the preferred path.
  const auth = request.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m && m[1].trim()) return m[1].trim();
  }
  // 2) ?token= query param — opt-in fallback for callers that can't set
  //    custom headers. Documented risk: query strings are commonly logged;
  //    this is a BFF-internal trust boundary so the token was already
  //    issued by us, but pages SHOULD migrate to Bearer headers as soon as
  //    they persist the token.
  try {
    const url = new URL(request.url);
    const t = url.searchParams.get("token");
    if (t && t.trim()) return t.trim();
  } catch {
    /* unparseable URL — ignore */
  }
  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await context.params;

  // Demo short-circuit: no auth, returns the legacy mock. Keeps the design
  // QA flow working without needing a real RAG session.
  if (isDemoSession(sessionId)) {
    const mockResult = createMockComplianceReportResult("demo");
    const demoStatus: ScanStatus = {
      sessionId: "demo",
      status: "ready",
      progress: 100,
      stageText: "完成",
      stageKey: "done",
      result: { ...mockResult, source: "demo" },
    };
    return ok(demoStatus);
  }

  const accessToken = extractAccessToken(request);
  if (!accessToken) {
    return fail(
      { code: "UNAUTHORIZED", message: "Missing access token" },
      { status: 401 },
    );
  }

  try {
    const data = await getScan({ sessionId, accessToken });

    // The v1 adapter returns camelCase session fields. Map them onto the
    // legacy ScanStatus shape that the upload/burning/result pages expect.
    // Page-level fields like `complianceScore`, `riskPoints`, etc. live
    // inside `result` (the backend's report package), not at the top level.
    const payload: ScanStatus = {
      sessionId: data.sessionId,
      status: data.status,
      progress: data.progress,
      stageText: data.stageText,
      stageKey: inferStageKey(data.stageText, data.status),
      result: (data.result as unknown as ScanStatus["result"]) ?? undefined,
      error: data.error ?? undefined,
    };
    return ok(payload);
  } catch (err) {
    if (err instanceof V1EnvelopeError) {
      return fail(
        { code: err.code, message: err.message },
        { status: err.httpStatus },
      );
    }
    return fail(
      { code: "RAG_SERVICE_UNAVAILABLE", message: "RAG service unavailable" },
      { status: 502 },
    );
  }
}

/**
 * Translate the v1 backend's free-form `stageText` into the legacy `stageKey`
 * the burning page already understands. The key is consumed by the page for
 * localized stage labels; unknown keys fall back to the raw text via the
 * page's `localizeStageText()` helper.
 */
function inferStageKey(
  stageText: string,
  status: string,
): ScanStatus["stageKey"] {
  if (status === "ready") return "done";
  if (status === "failed") return "failed";
  const text = stageText.toLowerCase();
  if (text.includes("vision") || text.includes("identify")) return "vision";
  if (text.includes("retriev") || text.includes("match")) return "retrieval";
  if (text.includes("generat") || text.includes("report")) return "report";
  return "queued";
}
