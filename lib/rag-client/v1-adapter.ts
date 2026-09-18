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

/**
 * BFF → RAG 的转发上下文（限流分桶 + 跨边界日志关联）。
 *
 * RAG 的 _client_ip 只在 socket peer 属于 trusted_proxies 时读
 * X-Forwarded-For；BFF 从 127.0.0.1（trusted）发起调用但不转发时，所有
 * 用户的写请求共享同一个 127.0.0.1 限流桶（30 req/60s），一个用户就能
 * 把其他所有人的扫描创建打成 429。透传 x-real-ip（nginx $remote_addr
 * 覆写值，BFF 的限流也信任它）恢复按真实客户端分桶。
 */
export interface UpstreamForward {
  clientIp?: string | null;
  requestId?: string | null;
}

/**
 * 从 BFF 入站 Request 提取转发头。只携带真实存在的值（缺省时展开为空
 * 对象），让调用参数保持最小形状。
 * x-real-ip：nginx `proxy_set_header X-Real-IP $remote_addr` 覆写值，
 * 拓扑上 3000 只绑定 loopback、全部流量经 nginx，因此可信（BFF 自身限流
 * 也以它为准，见 lib/rate-limit.ts resolveClientId）。
 * x-request-id：由 middleware.ts 注入到转发请求头。
 */
export function upstreamForwardFrom(request: Request): UpstreamForward {
  const forward: UpstreamForward = {};
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) forward.clientIp = realIp;
  const requestId = request.headers.get("x-request-id")?.trim();
  if (requestId) forward.requestId = requestId;
  return forward;
}

function buildAuthHeaders(
  accessToken: string | null,
  forward?: UpstreamForward,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const secret = getRagInternalSecret();
  if (secret) headers["X-Internal-Secret"] = secret;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (forward?.clientIp) headers["X-Forwarded-For"] = forward.clientIp;
  if (forward?.requestId) headers["X-Request-Id"] = forward.requestId;
  return headers;
}

// Merge the upstream auth/forward headers into an existing header map. Used
// when the BFF forwards the original multipart Content-Type (so the boundary
// matches the streamed body) and we still need to attach our auth chain.
function mergeForwardHeaders(
  base: Record<string, string>,
  accessToken: string | null,
  forward?: UpstreamForward,
): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  const auth = buildAuthHeaders(accessToken, forward);
  for (const [key, value] of Object.entries(auth)) {
    if (value) merged[key] = value;
  }
  return merged;
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

export interface CreateScanInput extends UpstreamForward {
  query: string;
  product?: string;
  category: string;
  markets: string[];
  images: Array<{ buffer: Buffer; originalName: string; mimeType: string }>;
  documents?: Array<{ buffer: Buffer; originalName: string; mimeType: string }>;
  /**
   * J09 (plan §5.4): user-stated product facts collected by the upload
   * wizard's conditional questions, e.g. { battery: "否" }. Forwarded to
   * the backend so conditionally-applicable checks (battery compartment
   * closure when the product has no battery) are closed instead of
   * demanding photos of nonexistent parts.
   */
  declaredFacts?: Record<string, string>;
}

/**
 * Headers supplied by the BFF when it forwards the inbound request's
 * multipart body verbatim (no `await request.formData()`). The BFF must
 * include the original `content-type` so the upstream parser sees the same
 * boundary; everything else is added by the adapter.
 */
export interface StreamedMultipartHeaders {
  contentType: string;
}

export interface CreateScanStreamInput extends UpstreamForward {
  body: ReadableStream<Uint8Array>;
  headers: StreamedMultipartHeaders;
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
  // J09: user-declared facts as a JSON form field (snake_case on the wire
  // matches the backend `declared_facts` Form parameter). Only a bounded
  // string→string object is sent; anything else is dropped.
  if (
    input.declaredFacts &&
    typeof input.declaredFacts === "object" &&
    !Array.isArray(input.declaredFacts)
  ) {
    const bounded: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.declaredFacts).slice(0, 32)) {
      const keyText = String(key).slice(0, 64);
      const valueText = String(value ?? "").slice(0, 200);
      if (keyText && valueText) {
        bounded[keyText] = valueText;
      }
    }
    if (Object.keys(bounded).length > 0) {
      formData.set("declared_facts", JSON.stringify(bounded));
    }
  }

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
      headers: buildAuthHeaders(null, input),
    },
    RAG_SERVICE_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

// Forward the original multipart body byte-for-byte to the RAG service so
// neither the BFF nor Node buffers the full upload into heap. FastAPI's
// `python-multipart` parses the streamed body as it arrives, identical to
// the previous buffered path. The BFF is responsible for content-length and
// boundary sanity (validateContentLength on the inbound request + a small
// `peek` of the body when the inbound header is missing). The `duplex`
// option is required by Node's undici fetch when streaming a request body.
export async function createScanStream(input: CreateScanStreamInput): Promise<CreatedScanData> {
  return requestEnvelope<CreatedScanData>(
    V1_SCAN_CREATE_PATH,
    {
      method: "POST",
      body: input.body,
      headers: mergeForwardHeaders(
        { "Content-Type": input.headers.contentType },
        null,
        input,
      ),
      // @ts-expect-error duplex is supported by Node's fetch but missing from
      // the DOM RequestInit type. See: https://nodejs.org/api/globals.html#fetch
      duplex: "half",
    },
    RAG_SERVICE_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

export interface GetScanInput extends UpstreamForward {
  sessionId: string;
  accessToken: string;
}

export async function getScan(input: GetScanInput): Promise<V1SessionData> {
  return requestEnvelope<V1SessionData>(
    `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}`,
    {
      method: "GET",
      headers: buildAuthHeaders(input.accessToken, input),
    },
    V1_SCAN_GET_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

export interface SessionResourceInput extends UpstreamForward {
  sessionId: string;
  accessToken: string;
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
      headers: buildAuthHeaders(input.accessToken, input),
    },
    RAG_SERVICE_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

export interface AppendEvidenceStreamInput extends SessionResourceInput {
  body: ReadableStream<Uint8Array>;
  headers: StreamedMultipartHeaders;
}

export async function appendEvidenceStream(
  input: AppendEvidenceStreamInput,
): Promise<AppendEvidenceData> {
  return requestEnvelope<AppendEvidenceData>(
    `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/evidence`,
    {
      method: "POST",
      body: input.body,
      headers: mergeForwardHeaders(
        { "Content-Type": input.headers.contentType },
        input.accessToken,
        input,
      ),
      // @ts-expect-error duplex is supported by Node's fetch but missing from
      // the DOM RequestInit type. See: https://nodejs.org/api/globals.html#fetch
      duplex: "half",
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

export interface RequestRevisionInput extends SessionResourceInput {
  /** Client-supplied intent key. Two clicks that mean the same re-run share
   * it (deduped by the backend); a genuinely new re-run after more evidence
   * arrives carries a fresh one. Defaults to the session-level key so a
   * caller that does not care still gets retry-safety. */
  idempotencyKey?: string;
}

export async function requestRevision(input: RequestRevisionInput): Promise<RevisionQueueData> {
  return requestEnvelope<RevisionQueueData>(
    `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/revisions`,
    {
      method: "POST",
      headers: {
        ...buildAuthHeaders(input.accessToken, input),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotencyKey: input.idempotencyKey ?? `${input.sessionId}:revision`,
      }),
    },
    RAG_SERVICE_TIMEOUT_MS,
    "SCAN_SERVICE_UNAVAILABLE",
  );
}

export interface GetScanAssetInput extends SessionResourceInput {
  index: number;
}

/**
 * Fetch a session asset and hand back the upstream `Response` unread, so the
 * BFF can pipe `response.body` straight to the browser. Buffering here used
 * to pin a full copy of every image in the Node heap — the result page loads
 * its carousel concurrently, so that multiplied out to tens of MB per page
 * view. The timeout covers the upstream headers only, exactly as the
 * buffered version did.
 */
export async function streamScanAsset(input: GetScanAssetInput): Promise<Response> {
  if (!Number.isInteger(input.index) || input.index < 0) {
    throw new V1EnvelopeError("NOT_FOUND", "Invalid asset index", 404, null);
  }
  let response: Response;
  try {
    response = await fetchWithTimeout(
      apiUrl(
        `${V1_SCAN_CREATE_PATH}/${encodeURIComponent(input.sessionId)}/assets/${input.index}`,
      ),
      { method: "GET", headers: buildAuthHeaders(input.accessToken, input) },
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
  return response;
}

export function isDemoSession(sessionId: string): boolean {
  return sessionId === "demo";
}
