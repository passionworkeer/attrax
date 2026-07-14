/**
 * lib/rag-client/errors.ts
 *
 * Typed errors raised by the RAG client. The frontend maps these to
 * `degradedReason` values shown in the DegradedBanner and persisted on
 * the session as `error`.
 *
 * Error code mapping (matches the contract in docs/API-CONTRACT.md §6):
 *   RAG_SERVICE_TIMEOUT          — fetch() AbortError (timeout)
 *   RAG_SERVICE_UNAVAILABLE      — fetch() failed (network/DNS/CORS)
 *   RAG_SERVICE_HTTP_<status>    — non-2xx HTTP response
 *   RAG_SERVICE_INVALID_RESPONSE — Zod schema validation failed
 */

export const RAG_ERROR_CODES = {
  TIMEOUT: "RAG_SERVICE_TIMEOUT",
  UNAVAILABLE: "RAG_SERVICE_UNAVAILABLE",
  HTTP_PREFIX: "RAG_SERVICE_HTTP_",
  INVALID_RESPONSE: "RAG_SERVICE_INVALID_RESPONSE",
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
    return new RagServiceError(RAG_ERROR_CODES.TIMEOUT, "RAG service request timed out", { cause: err });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new RagServiceError(RAG_ERROR_CODES.UNAVAILABLE, message || "RAG service unreachable", { cause: err });
}
