import { fail } from "@/lib/api-response";
import { backendAccessTokenFromRequest, withClearedSessionCookie } from "@/app/api/backend-session-access";
import { getScanAsset, upstreamForwardFrom, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { z } from "zod";

// session_id = "scan_" + 1..50 chars of [0-9A-Za-z_-]（RAG service 构造，
// FileBackend._SAFE_ID regex 与 application/scans.py:230 一致）。
const SessionIdSchema = z
  .string()
  .min(6)
  .max(64)
  .regex(/^scan_[0-9A-Za-z_-]{1,50}$/);

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string; index: string }> },
): Promise<Response> {
  const { sessionId, index: rawIndex } = await context.params;
  const index = Number(rawIndex);
  if (!SessionIdSchema.safeParse(sessionId).success || !Number.isInteger(index) || index < 0) {
    return fail({ code: "NOT_FOUND", message: "Scan asset not found" }, { status: 404 });
  }

  const accessToken = backendAccessTokenFromRequest(request, sessionId);
  if (!accessToken) {
    return withClearedSessionCookie(
      fail({ code: "UNAUTHORIZED", message: "Missing access token" }, { status: 401 }),
      sessionId,
    );
  }

  try {
    const asset = await getScanAsset({
      sessionId,
      accessToken,
      index,
      ...upstreamForwardFrom(request),
    });
    return new Response(Buffer.from(asset.bytes), {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof V1EnvelopeError) {
      const response = fail({ code: error.code, message: error.message }, { status: error.httpStatus });
      return error.httpStatus === 401 || error.httpStatus === 403
        ? withClearedSessionCookie(response, sessionId)
        : response;
    }
    return fail({ code: "SCAN_SERVICE_UNAVAILABLE", message: "Scan service unavailable" }, { status: 502 });
  }
}
