import { fail } from "@/lib/api-response";
import { type StoredScanStatus } from "@/lib/pipeline/session-store";
import { tokenFromRequest, verifyAccessToken } from "@/lib/pipeline/session-auth";
import { serverT } from "@/lib/server-i18n";
import type { ScanStatus } from "@/lib/types";

export function requireSessionAccess(request: Request, session: StoredScanStatus): Response | null {
  if (!session.accessTokenHash) return null;
  const token = tokenFromRequest(request);
  if (!verifyAccessToken(token ?? "", session.accessTokenHash)) {
    return fail(
      { code: "UNAUTHORIZED", message: serverT("errors.invalidRequest", "zh") },
      { status: 401 }
    );
  }
  return null;
}

// P0-1: whitelist must surface degradation evidence so the client can render
// the unmissable warning banner. `degradedReason` carries the RAG error code;
// `result.source` (already on the whitelisted `result`) tags fallback/demo.
// Stripping either hides a fallback report behind a normal-looking score.
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
