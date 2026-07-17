/**
 * lib/rag-client/v1-adapter.ts
 *
 * Thin client wrapper around the FastAPI `/api/v1/*` backend. This module is
 * the single seam between the Next.js API routes (task #10) and the standalone
 * RAG service. Pages continue to call `/api/scan`; the BFF rewire uses the
 * helpers exported here.
 *
 * Responsibilities:
 *   - Resolve `RAG_SERVICE_URL` / `RAG_INTERNAL_SECRET` from env
 *   - Multipart POST `/api/v1/scans` (create scan)
 *   - Bearer-auth GET `/api/v1/scans/{id}` (poll scan)
 *   - Unwrap the `{ data, error, meta }` envelope to typed values or throw
 *   - Expose `isDemoSession()` so the BFF can short-circuit `sessionId === "demo"`
 *
 * This module deliberately mirrors `client.ts` (the legacy `/scan-multipart`
 * client) but is v1-only — snake↔camel normalization and Zod schemas for the
 * legacy client are intentionally NOT reused here. The v1 contract is the new
 * source of truth (see `rag_service/api/v1.py` + `rag_service/api/models.py`).
 */
import { RAG_SERVICE_TIMEOUT_MS } from "@/lib/constants";

const V1_SCAN_CREATE_PATH = "/api/v1/scans";
const V1_SCAN_GET_TIMEOUT_MS = 30_000;

// --- Types ------------------------------------------------------------------

export type V1SessionStatus = "processing" | "ready" | "degraded" | "failed";

export interface V1SessionData {
  sessionId: string;
  status: V1SessionStatus;
  progress: number; // 0..100
  stageText: string; // "queued" | "processing" | "complete" | "degraded" | "failed"
  category: string;
  markets: string[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  result: Record<string, unknown> | null;
  error: string | null;
  assets?: Array<{
    kind: "image" | "document";
    index: number;
    name: string;
    contentType: string;
    size: number;
  }>;
}

export interface V1Envelope<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta: { requestId: string };
}

// --- Env helpers ------------------------------------------------------------

export function getRagServiceUrl(): string {
  const value = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`RAG_SERVICE_URL is not a valid URL: ${value}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("RAG_SERVICE_URL must use http or https");
  }
  return parsed.origin;
}

export function getRagInternalSecret(): string | null {
  const secret = process.env.RAG_INTERNAL_SECRET;
  if (!secret || secret.length === 0) return null;
  return secret;
}

// --- Envelope ---------------------------------------------------------------

export class V1EnvelopeError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly requestId: string | null;

  constructor(code: string, message: string, httpStatus: number, requestId: string | null) {
    super(message);
    this.name = "V1EnvelopeError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.requestId = requestId;
  }
}

export function unwrapV1Envelope<T>(payload: V1Envelope<T>): T {
  const requestId = payload.meta?.requestId ?? null;
  if (payload.error) {
    throw new V1EnvelopeError(
      payload.error.code,
      payload.error.message,
      200, // envelope-level errors arrive at HTTP 2xx; status is implicit
      requestId,
    );
  }
  if (payload.data === null || payload.data === undefined) {
    throw new V1EnvelopeError("EMPTY_RESPONSE", "Empty response", 502, requestId);
  }
  return payload.data;
}

// --- Internal helpers -------------------------------------------------------

function buildAuthHeaders(accessToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  const secret = getRagInternalSecret();
  if (secret) headers["X-Internal-Secret"] = secret;
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  return headers;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseEnvelope<T>(resp: Response): Promise<V1Envelope<T>> {
  let raw: unknown;
  try {
    raw = await resp.json();
  } catch {
    throw new V1EnvelopeError("INVALID_RESPONSE", "Response was not valid JSON", resp.status, null);
  }
  if (!raw || typeof raw !== "object") {
    throw new V1EnvelopeError("INVALID_RESPONSE", "Response is not an object", resp.status, null);
  }
  const candidate = raw as V1Envelope<T>;
  if (!("data" in candidate) || !("error" in candidate) || !("meta" in candidate)) {
    throw new V1EnvelopeError("INVALID_RESPONSE", "Response missing envelope fields", resp.status, null);
  }
  return candidate;
}

function requestIdFromResponse(resp: Response): string | null {
  const value = resp.headers.get("x-request-id");
  return value && value.length > 0 ? value : null;
}

// --- POST /api/v1/scans -----------------------------------------------------

export interface CreateScanInput {
  query: string;
  product?: string;
  category: string;
  markets: string[]; // uppercase, validated
  images: Array<{ buffer: Buffer; originalName: string; mimeType: string }>;
  documents?: Array<{ buffer: Buffer; originalName: string; mimeType: string }>;
  /** Reserved for future use; POST `/api/v1/scans` does not require auth today. */
  accessToken?: string;
}

export interface CreatedScanData {
  sessionId: string;
  accessToken: string;
  status: "processing";
  pollUrl: string;
}

export async function createScan(input: CreateScanInput): Promise<CreatedScanData> {
  const formData = new FormData();
  formData.set("query", input.query);
  formData.set("product", input.product ?? "");
  formData.set("category", input.category);
  formData.set("markets", JSON.stringify(input.markets));

  for (const img of input.images) {
    formData.append(
      "images",
      new Blob([new Uint8Array(img.buffer)], { type: img.mimeType }),
      img.originalName,
    );
  }
  for (const doc of input.documents ?? []) {
    formData.append(
      "documents",
      new Blob([new Uint8Array(doc.buffer)], { type: doc.mimeType }),
      doc.originalName,
    );
  }

  const baseUrl = getRagServiceUrl();
  const url = `${baseUrl}${V1_SCAN_CREATE_PATH}`;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        body: formData,
        headers: buildAuthHeaders(null),
      },
      RAG_SERVICE_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new V1EnvelopeError(
        "RAG_SERVICE_TIMEOUT",
        "RAG service request timed out",
        504,
        null,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new V1EnvelopeError("RAG_SERVICE_UNAVAILABLE", message || "RAG service unreachable", 502, null);
  }

  if (!resp.ok) {
    throw new V1EnvelopeError(
      "RAG_SERVICE_UNAVAILABLE",
      `HTTP ${resp.status}`,
      resp.status,
      requestIdFromResponse(resp),
    );
  }

  const envelope = await parseEnvelope<CreatedScanData>(resp);
  return unwrapV1Envelope(envelope);
}

// --- GET /api/v1/scans/{id} -------------------------------------------------

export interface GetScanInput {
  sessionId: string;
  accessToken: string; // REQUIRED for GET
}

export async function getScan(input: GetScanInput): Promise<V1SessionData> {
  const baseUrl = getRagServiceUrl();
  const url = `${baseUrl}${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}`;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: buildAuthHeaders(input.accessToken),
      },
      V1_SCAN_GET_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new V1EnvelopeError(
        "RAG_SERVICE_TIMEOUT",
        "RAG service request timed out",
        504,
        null,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new V1EnvelopeError("RAG_SERVICE_UNAVAILABLE", message || "RAG service unreachable", 502, null);
  }

  if (!resp.ok) {
    // Map well-known statuses to stable codes so the BFF can branch on them
    // (e.g. surface 401/404 as access-token / session-not-found instead of
    // generic HTTP failures). Other statuses keep the legacy `RAG_SERVICE_HTTP_<n>`
    // code shape.
    let code: string;
    if (resp.status === 401) code = "UNAUTHORIZED";
    else if (resp.status === 404) code = "NOT_FOUND";
    else code = `RAG_SERVICE_HTTP_${resp.status}`;
    throw new V1EnvelopeError(code, `HTTP ${resp.status}`, resp.status, requestIdFromResponse(resp));
  }

  const envelope = await parseEnvelope<V1SessionData>(resp);
  return unwrapV1Envelope(envelope);
}

export interface SessionResourceInput {
  sessionId: string;
  accessToken: string;
}

async function getSessionResource<T>(
  input: SessionResourceInput,
  suffix: string,
): Promise<T> {
  const baseUrl = getRagServiceUrl();
  const url = `${baseUrl}${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/${suffix}`;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      url,
      { method: "GET", headers: buildAuthHeaders(input.accessToken) },
      V1_SCAN_GET_TIMEOUT_MS,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new V1EnvelopeError(
      err instanceof Error && err.name === "AbortError" ? "RAG_SERVICE_TIMEOUT" : "RAG_SERVICE_UNAVAILABLE",
      message || "RAG service unreachable",
      err instanceof Error && err.name === "AbortError" ? 504 : 502,
      null,
    );
  }
  if (!resp.ok) {
    const code = resp.status === 401 ? "UNAUTHORIZED" : resp.status === 404 ? "NOT_FOUND" : `RAG_SERVICE_HTTP_${resp.status}`;
    throw new V1EnvelopeError(code, `HTTP ${resp.status}`, resp.status, requestIdFromResponse(resp));
  }
  return unwrapV1Envelope(await parseEnvelope<T>(resp));
}

export function getRoadmap(input: SessionResourceInput): Promise<Record<string, unknown>> {
  return getSessionResource(input, "roadmap");
}

export function getTrace(input: SessionResourceInput): Promise<Array<Record<string, unknown>>> {
  return getSessionResource(input, "trace");
}

export interface GetScanAssetInput extends SessionResourceInput {
  index: number;
}

export async function getScanAsset(
  input: GetScanAssetInput,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (!Number.isInteger(input.index) || input.index < 0) {
    throw new V1EnvelopeError("NOT_FOUND", "Invalid asset index", 404, null);
  }
  const baseUrl = getRagServiceUrl();
  const url = `${baseUrl}${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/assets/${input.index}`;
  const resp = await fetchWithTimeout(
    url,
    { method: "GET", headers: buildAuthHeaders(input.accessToken) },
    V1_SCAN_GET_TIMEOUT_MS,
  );
  if (!resp.ok) {
    const code = resp.status === 401 ? "UNAUTHORIZED" : resp.status === 404 ? "NOT_FOUND" : `RAG_SERVICE_HTTP_${resp.status}`;
    throw new V1EnvelopeError(code, `HTTP ${resp.status}`, resp.status, requestIdFromResponse(resp));
  }
  return {
    bytes: new Uint8Array(await resp.arrayBuffer()),
    contentType: resp.headers.get("content-type") || "application/octet-stream",
  };
}

// --- Demo short-circuit -----------------------------------------------------

export function isDemoSession(sessionId: string): boolean {
  return sessionId === "demo";
}
