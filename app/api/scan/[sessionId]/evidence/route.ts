/**
 * app/api/scan/[sessionId]/evidence/route.ts — POST /api/scan/[sessionId]/evidence
 * (BFF proxy for the evidence-supplementation endpoint, plan §5.3 / J10).
 *
 * Streams the inbound multipart body to the FastAPI v1 backend so neither
 * the BFF nor Node buffers up to 50MB of evidence files into heap on the
 * supplement path. Per-file signature checks belong to the FastAPI
 * `_valid_signature` step — same source of truth, no behaviour change.
 */
import { appendEvidenceStream, upstreamForwardFrom, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, resolveClientId } from "@/lib/rate-limit";
import { backendAccessTokenFromRequest, withClearedSessionCookie } from "@/app/api/backend-session-access";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
// Same budget as the scan-create route: an evidence upload is the same
// class of write (up to 50MB of files) and must not be a cheaper way to
// hammer the RAG service than POST /api/scan.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const MULTIPART_CONTENT_TYPE = /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await context.params;
  const accessToken = backendAccessTokenFromRequest(request, sessionId);
  if (!accessToken) {
    return withClearedSessionCookie(
      fail({ code: "UNAUTHORIZED", message: "Missing access token" }, { status: 401 }),
      sessionId,
    );
  }

  // Rate-limit AFTER auth so anonymous traffic cannot exhaust the bucket of
  // the session owner (same ordering as POST /api/scan).
  const clientId = resolveClientId(request);
  if (!checkRateLimit(`evidence:${clientId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return fail(
      { code: "RATE_LIMITED", message: "Too many evidence uploads. Try again shortly." },
      { status: 429 },
    );
  }

  const contentTypeHeader = request.headers.get("content-type") ?? "";
  if (!MULTIPART_CONTENT_TYPE.test(contentTypeHeader)) {
    // 400/INVALID_REQUEST, not 415: this is the code the buffered
    // implementation returned when `request.formData()` could not parse the
    // body, and callers match on it.
    return fail(
      { code: "INVALID_REQUEST", message: "Multipart form data required" },
      { status: 400 },
    );
  }

  const contentLengthRaw = request.headers.get("content-length");
  if (contentLengthRaw) {
    const value = Number(contentLengthRaw);
    if (Number.isFinite(value) && value > MAX_REQUEST_BYTES) {
      return fail(
        { code: "REQUEST_TOO_LARGE", message: "Evidence upload too large" },
        { status: 413 },
      );
    }
  }

  const body = request.body;
  if (!body) {
    return fail(
      { code: "INVALID_REQUEST", message: "Multipart form data required" },
      { status: 400 },
    );
  }

  try {
    const data = await appendEvidenceStream({
      sessionId,
      accessToken,
      body,
      headers: { contentType: contentTypeHeader },
      ...upstreamForwardFrom(request),
    });
    return ok(data, { status: 202 });
  } catch (err) {
    if (err instanceof V1EnvelopeError) {
      const response = fail(
        { code: err.code, message: err.message },
        { status: err.httpStatus },
      );
      return err.httpStatus === 401 || err.httpStatus === 403
        ? withClearedSessionCookie(response, sessionId)
        : response;
    }
    return fail(
      { code: "SCAN_SERVICE_UNAVAILABLE", message: "Scan service unavailable" },
      { status: 502 },
    );
  }
}
