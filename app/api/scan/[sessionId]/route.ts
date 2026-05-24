import { createMockScanResult } from "@/lib/mock/scan-result";
import { getSession } from "@/lib/pipeline/session-store";
import { serverT } from "@/lib/server-i18n";
import { ok, fail } from "@/lib/api-response";
import { requireSessionAccess, sessionPayload } from "@/app/api/session-access";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;

  if (sessionId === "demo") {
    return ok({
      sessionId: "demo",
      status: "ready" as const,
      progress: 100,
      stageText: "完成",
      result: { ...createMockScanResult("demo"), source: "demo" as const },
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return fail(
      {
        code: "NOT_FOUND",
        message: serverT("errors.sessionNotFound", "zh"),
      },
      { status: 404 }
    );
  }

  const denied = requireSessionAccess(request, session);
  if (denied) return denied;

  return ok(sessionPayload(session));
}
