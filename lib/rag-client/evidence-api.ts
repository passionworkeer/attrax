/**
 * lib/rag-client/evidence-api.ts — Client for the evidence supplementation
 * + revision endpoints (plan 2026-09-14 §5.3, J10).
 *
 * Backend routes (rag_service/api/v1.py):
 *   POST /api/v1/scans/{id}/evidence    — attach photos/documents to a
 *                                         completed scan (idempotent via key)
 *   POST /api/v1/scans/{id}/revisions   — idempotently queue a revision
 *                                         re-run over the session's evidence
 *
 * The BFF proxies these under /api/scan/{id}/... with the session bearer
 * token attached, mirroring the existing poll/asset routes.
 */

export type EvidenceAppendStatus = "stored" | "already_applied";
export type RevisionQueueStatus = "queued" | "already_queued";

export interface EvidenceAppendResponse {
  status: EvidenceAppendStatus;
  storedCount: number;
  uploads?: Array<{ uploadId: string; kind: string; name: string; size: number }>;
}

export interface RevisionQueueResponse {
  status: RevisionQueueStatus;
  revision: number;
  jobId?: string;
}

export interface SupplementalFile {
  /** Browser File handle from an <input type="file">. */
  file: File;
}

function readStoredAccessToken(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(`scan-token:${sessionId}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Build a stable idempotency key for one supplement action so a retry after
 * a network failure does not double-store files (plan §5.3: 幂等 key).
 * The key is derived from the file fingerprints + a coarse time bucket the
 * page controls, so "same files submitted again within the same intent"
 * deduplicates while a genuinely new attempt gets a fresh key.
 */
export function evidenceIdempotencyKey(
  sessionId: string,
  files: Array<{ name: string; size: number; lastModified: number }>,
  intent: string,
): string {
  const fingerprint = files
    .map((f) => `${f.name}:${f.size}:${f.lastModified}`)
    .sort()
    .join("|");
  return `${sessionId}:${intent}:${fingerprint}`;
}

export async function appendEvidence(
  sessionId: string,
  files: Array<SupplementalFile>,
  intent: string,
): Promise<EvidenceAppendResponse> {
  const token = readStoredAccessToken(sessionId);
  const form = new FormData();
  form.set("idempotency_key", evidenceIdempotencyKey(
    sessionId,
    files.map((entry) => entry.file),
    intent,
  ));
  let imageCount = 0;
  let documentCount = 0;
  for (const { file } of files) {
    if (file.type.startsWith("image/")) {
      form.append("images", file);
      imageCount += 1;
    } else {
      form.append("documents", file);
      documentCount += 1;
    }
  }
  if (imageCount === 0 && documentCount === 0) {
    throw new Error("NO_FILES");
  }

  const response = await fetch(`/api/scan/${sessionId}/evidence`, {
    method: "POST",
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    // The CODE is the client contract (callers switch on it and localize);
    // the human-readable message stays server-side.
    throw new Error(body?.error?.code ?? `HTTP_${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: EvidenceAppendResponse;
  };
  if (!payload?.data) throw new Error("INVALID_RESPONSE");
  return payload.data;
}

export async function requestRevision(sessionId: string, intentKey?: string): Promise<RevisionQueueResponse> {
  const token = readStoredAccessToken(sessionId);
  const idempotencyKey = intentKey ? `${sessionId}:revision:${intentKey}` : `${sessionId}:revision`;
  const response = await fetch(`/api/scan/${sessionId}/revisions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ idempotencyKey }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: string } }
      | null;
    // Same contract as appendEvidence: throw the machine-readable code and
    // let the caller localize it.
    throw new Error(body?.error?.code ?? `HTTP_${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: RevisionQueueResponse;
  };
  if (!payload?.data) throw new Error("INVALID_RESPONSE");
  return payload.data;
}
