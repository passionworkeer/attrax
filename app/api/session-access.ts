import { fail } from "@/lib/api-response";
import { type StoredScanStatus } from "@/lib/pipeline/session-store";
import { tokenFromRequest, verifyAccessToken } from "@/lib/pipeline/session-auth";
import { serverT } from "@/lib/server-i18n";
import type { ScanStatus } from "@/lib/types";

export function requireSessionAccess(
  request: Request,
  session: StoredScanStatus,
): Response | null {
  if (!session.accessTokenHash) {
    // Legacy fixtures remain usable in local development and tests, but a
    // production session without a token hash is malformed and must never be
    // treated as public data.
    if (process.env.NODE_ENV !== "production") return null;
    return fail(
      {
        code: "UNAUTHORIZED",
        message: "This legacy session cannot be accessed safely. Start a new scan.",
      },
      { status: 401 },
    );
  }
  const token = tokenFromRequest(request);
  if (!verifyAccessToken(token ?? "", session.accessTokenHash)) {
    return fail(
      { code: "UNAUTHORIZED", message: serverT("errors.invalidRequest", "zh") },
      { status: 401 },
    );
  }
  return null;
}

export function sessionPayload(session: ScanStatus): ScanStatus {
  const {
    sessionId,
    status,
    progress,
    stageText,
    result,
    profitReport,
    profitReports,
    error,
    degradedReason,
  } = session;
  return {
    sessionId,
    status,
    progress,
    stageText,
    result,
    profitReport,
    profitReports,
    error,
    degradedReason,
  };
}
