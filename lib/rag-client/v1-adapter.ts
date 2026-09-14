/** Thin typed client for the standalone FastAPI `/api/v1/*` contract. */
import { RAG_SERVICE_TIMEOUT_MS } from "@/lib/constants";

const V1_SCAN_CREATE_PATH = "/api/v1/scans";
const V1_SCAN_GET_TIMEOUT_MS = 30_000;

export type V1SessionStatus = "processing" | "ready" | "degraded" | "failed";

export interface V1SessionData {
  sessionId: string;
  status: V1SessionStatus;
  progress: number;
  stageText: string;
  category: string;
  markets: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  result: Record<string, unknown> | null;
  /**
   * Explicit "result payload addressable" flag from the backend (plan §4.1).
   * `ready`/`degraded` without a persisted result must not be treated as
   * complete by the burning page's progress state machine.
   */
  resultReady?: boolean;
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
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("RAG_SERVICE_URL must not contain credentials, query, or fragment");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function getRagInternalSecret(): string | null {
  const secret = process.env.RAG_INTERNAL_SECRET?.trim();
  return secret || null;
}

export class V1EnvelopeError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly requestId: string | null;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    requestId: string | null,
  ) {
    super(message);
    this.name = "V1EnvelopeError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.requestId = requestId;
  }
}

export function unwrapV1Envelope<T>(
  payload: V1Envelope<T>,
  httpStatus = 200,
): T {
  const requestId = payload.meta?.requestId ?? null;
  if (payload.error) {
    throw new V1EnvelopeError(
      payload.error.code,
      payload.error.message,
      httpStatus,
      requestId,
    );
  }
  if (payload.data === null || payload.data === undefined) {
    throw new V1EnvelopeError("EMPTY_RESPONSE", "Empty response", 502, requestId);
  }
  return payload.data;
}

function apiUrl(path: string): string {
  return `${getRagServiceUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildAuthHeaders(accessToken: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  const secret = getRagInternalSecret();
  if (secret) headers["X-Internal-Secret"] = secret;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
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

async function parseEnvelope<T>(response: Response): Promise<V1Envelope<T>> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new V1EnvelopeError(
      "INVALID_RESPONSE",
      "Response was not valid JSON",
      response.status,
      requestIdFromResponse(response),
    );
  }
  if (!raw || typeof raw !== "object") {
    throw new V1EnvelopeError(
      "INVALID_RESPONSE",
      "Response is not an object",
      response.status,
      requestIdFromResponse(response),
    );
  }
  const candidate = raw as Partial<V1Envelope<T>>;
  if (!("data" in candidate) || !("error" in candidate) || !("meta" in candidate)) {
    throw new V1EnvelopeError(
      "INVALID_RESPONSE",
      "Response missing envelope fields",
      response.status,
      requestIdFromResponse(response),
    );
  }
  return candidate as V1Envelope<T>;
}

function requestIdFromResponse(response: Response): string | null {
  const value = response.headers.get("x-request-id");
  return value && value.length > 0 ? value : null;
}

function stableCodeForStatus(status: number, fallbackCode: string): string {
  if (status === 400) return "INVALID_REQUEST";
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "NOT_READY";
  if (status === 413) return "REQUEST_TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  if (status === 504) return "SCAN_SERVICE_TIMEOUT";
  return fallbackCode;
}

async function throwResponseError(
  response: Response,
  fallbackCode: string,
): Promise<never> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const envelope = await parseEnvelope<never>(response);
      if (envelope.error) {
        throw new V1EnvelopeError(
          envelope.error.code,
          envelope.error.message,
          response.status,
          envelope.meta?.requestId ?? requestIdFromResponse(response),
        );
      }
    } catch (error) {
      if (error instanceof V1EnvelopeError && error.code !== "INVALID_RESPONSE") {
        throw error;
      }
    }
  }
  throw new V1EnvelopeError(
    stableCodeForStatus(response.status, fallbackCode),
    `HTTP ${response.status}`,
    response.status,
    requestIdFromResponse(response),
  );
}

async function requestEnvelope<T>(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fallbackCode: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchWithTimeout(apiUrl(path), init, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new V1EnvelopeError(
        "SCAN_SERVICE_TIMEOUT",
        "Scan service request timed out",
        504,
        null,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new V1EnvelopeError(
      "SCAN_SERVICE_UNAVAILABLE",
      message || "Scan service unreachable",
      502,
      null,
    );
  }
  if (!response.ok) {
    await throwResponseError(response, fallbackCode);
  }
  const envelope = await parseEnvelope<T>(response);
  return unwrapV1Envelope(envelope, response.status);
}

export interface CreateScanInput {
  query: string;
  product?: string;
  category: string;
  markets: string[];
  images: Array<{ buffer: Buffer; originalName: string; mimeType: string }>;
  documents?: Array<{ buffer: Buffer; originalName: string; mimeType: string }>;
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

  for (const image of input.images) {
    formData.append(
      "images",
      new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
      image.originalName,
    );
  }
  for (const document of input.documents ?? []) {
    formData.append(
      "documents",
      new Blob([new Uint8Array(document.buffer)], { type: document.mimeType }),
      document.originalName,
    );
  }

  return requestEnvelope<CreatedScanData>(
    V1_SCAN_CREATE_PATH,
    {
      method: "POST",
      body: formData,
      headers: buildAuthHeaders(null),
    },
    RAG_SERVICE_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

export interface GetScanInput {
  sessionId: string;
  accessToken: string;
}

export async function getScan(input: GetScanInput): Promise<V1SessionData> {
  return requestEnvelope<V1SessionData>(
    `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}`,
    {
      method: "GET",
      headers: buildAuthHeaders(input.accessToken),
    },
    V1_SCAN_GET_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

export interface SessionResourceInput {
  sessionId: string;
  accessToken: string;
}

async function getSessionResource<T>(
  input: SessionResourceInput,
  suffix: string,
): Promise<T> {
  return requestEnvelope<T>(
    `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/${suffix}`,
    {
      method: "GET",
      headers: buildAuthHeaders(input.accessToken),
    },
    V1_SCAN_GET_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

export function getRoadmap(
  input: SessionResourceInput,
): Promise<Record<string, unknown>> {
  return getSessionResource(input, "roadmap");
}

export function getTrace(
  input: SessionResourceInput,
): Promise<Array<Record<string, unknown>>> {
  return getSessionResource(input, "trace");
}

// ── Evidence supplementation + revision re-run (plan 2026-09-14 §5.3, J10) ──

export interface AppendEvidenceInput extends SessionResourceInput {
  files: Array<{ buffer: Buffer; originalName: string; mimeType: string }>;
  idempotencyKey?: string;
}

export interface AppendEvidenceData {
  status: "stored" | "already_applied";
  storedCount: number;
  uploads?: Array<{ uploadId: string; kind: string; name: string; size: number }>;
}

export async function appendEvidence(input: AppendEvidenceInput): Promise<AppendEvidenceData> {
  const formData = new FormData();
  formData.set("idempotency_key", input.idempotencyKey ?? "");
  for (const file of input.files) {
    const field = file.mimeType.startsWith("image/") ? "images" : "documents";
    formData.append(
      field,
      new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
      file.originalName,
    );
  }
  return requestEnvelope<AppendEvidenceData>(
    `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/evidence`,
    {
      method: "POST",
      body: formData,
      headers: buildAuthHeaders(input.accessToken),
    },
    RAG_SERVICE_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

export interface RevisionQueueData {
  status: "queued" | "already_queued";
  revision: number;
  jobId?: string;
}

export async function requestRevision(input: SessionResourceInput): Promise<RevisionQueueData> {
  return requestEnvelope<RevisionQueueData>(
    `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/revisions`,
    {
      method: "POST",
      headers: {
        ...buildAuthHeaders(input.accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idempotencyKey: `${input.sessionId}:revision` }),
    },
    RAG_SERVICE_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
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
  let response: Response;
  try {
    response = await fetchWithTimeout(
      apiUrl(
        `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/assets/${input.index}`,
      ),
      { method: "GET", headers: buildAuthHeaders(input.accessToken) },
      V1_SCAN_GET_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new V1EnvelopeError(
        "SCAN_SERVICE_TIMEOUT",
        "Scan service request timed out",
        504,
        null,
      );
    }
    throw new V1EnvelopeError(
      "SCAN_SERVICE_UNAVAILABLE",
      "Scan service unreachable",
      502,
      null,
    );
  }
  if (!response.ok) {
    await throwResponseError(response, "SCAN_SERVICE_UNAVAILABLE");
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

export function isDemoSession(sessionId: string): boolean {
  return sessionId === "demo";
}
