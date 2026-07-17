import { fail } from "@/lib/api-response";
import { backendAccessTokenFromRequest } from "@/app/api/backend-session-access";
import { getScanAsset, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { SessionIdSchema } from "@/lib/schemas";

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
    return fail({ code: "UNAUTHORIZED", message: "Missing access token" }, { status: 401 });
  }

  try {
    const asset = await getScanAsset({ sessionId, accessToken, index });
    return new Response(Buffer.from(asset.bytes), {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof V1EnvelopeError) {
      return fail({ code: error.code, message: error.message }, { status: error.httpStatus });
    }
    return fail({ code: "RAG_SERVICE_UNAVAILABLE", message: "RAG service unavailable" }, { status: 502 });
  }
}
