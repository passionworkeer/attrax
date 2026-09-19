/**
 * app/api/scan/[sessionId]/revisions/route.ts — POST /api/scan/[sessionId]/revisions
 * (BFF proxy for the revision re-run endpoint, plan §5.3 / J10).
 *
 * Idempotently queues a revision re-run over the session's (possibly
 * extended) evidence set. The caller supplies an `idempotencyKey` naming the
 * intent: retries of the same click collide and become a no-op, while a
 * genuinely new re-run (more evidence arrived since) carries a fresh key and
 * does queue. Without a key the session-level default keeps plain retries
 * safe.
 */
import { requestRevision, upstreamForwardFrom, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, resolveClientId } from "@/lib/rate-limit";
import { backendAccessTokenFromRequest, withClearedSessionCookie } from "@/app/api/backend-session-access";

export const runtime = "nodejs";

// The only thing the body carries is the intent key; anything larger than
// this is not a legitimate revision request.
const MAX_BODY_BYTES = 2 * 1024;
const MAX_KEY_LENGTH = 200;
// Each accepted revision queues a full LLM re-run, so the budget is half
// the scan-create one — a user fixes a report a few times, not ten.
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

async function readIntentKey(request: Request): Promise<string | undefined> {
  const raw = await request.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const key = (parsed as Record<string, unknown>).idempotencyKey;
    if (typeof key !== "string") return undefined;
    const trimmed = key.trim();
    return trimmed && trimmed.length <= MAX_KEY_LENGTH ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

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

  // Same ordering as the scan/evidence routes: authenticate first, then
  // spend the caller's rate budget.
  const clientId = resolveClientId(request);
  if (!checkRateLimit(`revision:${clientId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return fail(
      { code: "RATE_LIMITED", message: "Too many revision requests. Try again shortly." },
      { status: 429 },
    );
  }

  const idempotencyKey = await readIntentKey(request);

  try {
    const data = await requestRevision({
      sessionId,
      accessToken,
      idempotencyKey,
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
