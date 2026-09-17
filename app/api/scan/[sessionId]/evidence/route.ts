/**
 * app/api/scan/[sessionId]/evidence/route.ts — POST /api/scan/[sessionId]/evidence
 * (BFF proxy for the evidence-supplementation endpoint, plan §5.3 / J10).
 *
 * Forwards multipart evidence files to the FastAPI v1 backend with the
 * session bearer token. Response passthrough keeps the backend envelope
 * ({status: stored|already_applied, storedCount, uploads}) intact.
 */
import { appendEvidence, upstreamForwardFrom, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { fail, ok } from "@/lib/api-response";
import { backendAccessTokenFromRequest, withClearedSessionCookie } from "@/app/api/backend-session-access";

export const runtime = "nodejs";

const MAX_FILES = 8;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(
      { code: "INVALID_REQUEST", message: "Multipart form data required" },
      { status: 400 },
    );
  }

  const idempotencyKey = String(form.get("idempotency_key") ?? "");
  const files: Array<{ buffer: Buffer; originalName: string; mimeType: string }> = [];
  let totalBytes = 0;
  for (const field of ["images", "documents"] as const) {
    for (const entry of form.getAll(field)) {
      if (!(entry instanceof File)) continue;
      if (files.length >= MAX_FILES) {
        return fail(
          { code: "INVALID_REQUEST", message: "Too many evidence files" },
          { status: 400 },
        );
      }
      const buffer = Buffer.from(await entry.arrayBuffer());
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        return fail(
          { code: "INVALID_REQUEST", message: "Evidence upload too large" },
          { status: 413 },
        );
      }
      files.push({
        buffer,
        originalName: entry.name,
        mimeType: entry.type || "application/octet-stream",
      });
    }
  }
  if (files.length === 0) {
    return fail(
      { code: "INVALID_REQUEST", message: "At least one file is required" },
      { status: 400 },
    );
  }

  try {
    const data = await appendEvidence({
      sessionId,
      accessToken,
      files,
      idempotencyKey: idempotencyKey.trim() || undefined,
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
