/**
 * lib/rag-client/errors.ts
 *
 * Typed errors raised by the scan service client. The frontend maps these
 * to `degradedReason` values shown in the DegradedBanner and persisted on
 * the session as `error`.
 *
 * Architecture note: the attrax backend has been De-RAG'd (2026-09-11) and
 * now runs a Knowledge-Anchored pipeline at `/api/v1/*`. The error code
 * namespace is `SCAN_SERVICE_*` to stay accurate; legacy `RAG_SERVICE_*`
 * codes are no longer emitted by the client. Internal env var
 * `RAG_INTERNAL_SECRET` and the `RAGServiceError` class name are kept
 * unchanged to avoid breaking the auth header contract and external
 * consumers.
 *
 * Error code mapping:
 *   SCAN_SERVICE_TIMEOUT          — fetch() AbortError (timeout)
 *   SCAN_SERVICE_UNAVAILABLE      — fetch() failed (network/DNS/CORS)
 *   SCAN_SERVICE_HTTP_<status>    — non-2xx HTTP response
 *   SCAN_SERVICE_INVALID_RESPONSE — Zod schema validation failed
 */

export const RAG_ERROR_CODES = {
  TIMEOUT: "SCAN_SERVICE_TIMEOUT",
  UNAVAILABLE: "SCAN_SERVICE_UNAVAILABLE",
  HTTP_PREFIX: "SCAN_SERVICE_HTTP_",
  INVALID_RESPONSE: "SCAN_SERVICE_INVALID_RESPONSE",
} as const;

export type RagErrorCode =
  | typeof RAG_ERROR_CODES.TIMEOUT
  | typeof RAG_ERROR_CODES.UNAVAILABLE
  | typeof RAG_ERROR_CODES.INVALID_RESPONSE
  | `${typeof RAG_ERROR_CODES.HTTP_PREFIX}${number}`;

export class RagServiceError extends Error {
  readonly code: RagErrorCode;
  readonly httpStatus?: number;
  readonly cause?: unknown;

  constructor(code: RagErrorCode, message: string, options: { httpStatus?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "RagServiceError";
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.cause = options.cause;
  }
}

/**
 * Classify a thrown value from a fetch() call.
 * Exported separately so callers (e.g. tests) can build a stable mapping
 * without re-implementing the logic.
 */
export function classifyFetchError(err: unknown): RagServiceError {
  if (err instanceof RagServiceError) return err;

  if (err instanceof Error && err.name === "AbortError") {
    return new RagServiceError(RAG_ERROR_CODES.TIMEOUT, "Scan service request timed out", { cause: err });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new RagServiceError(RAG_ERROR_CODES.UNAVAILABLE, message || "Scan service unreachable", { cause: err });
}
