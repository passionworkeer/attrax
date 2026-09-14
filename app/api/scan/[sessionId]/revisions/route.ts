/**
 * app/api/scan/[sessionId]/revisions/route.ts — POST /api/scan/[sessionId]/revisions
 * (BFF proxy for the revision re-run endpoint, plan §5.3 / J10).
 *
 * Idempotently queues a revision re-run over the session's (possibly
 * extended) evidence set. The backend derives the idempotency key from the
 * session, so retries are no-ops.
 */
import { requestRevision, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { fail, ok } from "@/lib/api-response";
import { backendAccessTokenFromRequest } from "@/app/api/backend-session-access";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await context.params;
  const accessToken = backendAccessTokenFromRequest(request, sessionId);
  if (!accessToken) {
    return fail(
      { code: "UNAUTHORIZED", message: "Missing access token" },
      { status: 401 },
    );
  }

  try {
    const data = await requestRevision({ sessionId, accessToken });
    return ok(data, { status: 202 });
  } catch (err) {
    if (err instanceof V1EnvelopeError) {
      return fail(
        { code: err.code, message: err.message },
        { status: err.httpStatus },
      );
    }
    return fail(
      { code: "SCAN_SERVICE_UNAVAILABLE", message: "Scan service unavailable" },
      { status: 502 },
    );
  }
}
