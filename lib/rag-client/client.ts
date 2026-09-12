/**
 * lib/rag-client/client.ts
 *
 * HTTP client for the scan service (attrax backend, formerly "RAG service").
 * Owns:
 *  - baseURL resolution from `RAG_SERVICE_URL` env (default http://localhost:8001)
 *  - timeout enforcement via AbortController
 *  - X-Internal-Secret header injection when configured
 *  - response Zod validation
 *  - error → RagServiceError mapping
 *
 * No business logic lives here. Callers (typically `lib/pipeline/scan.ts`)
 * decide what to do with the typed response or whether to fall back to mock.
 */
import { RAG_SERVICE_TIMEOUT_MS, PROFIT_REPORT_TIMEOUT_MS } from "@/lib/constants";
import {
  RagServiceError,
  RAG_ERROR_CODES,
  classifyFetchError,
} from "@/lib/rag-client/errors";
import {
  ScanResponseSchema,
  ProfitReportResponseSchema,
  type ScanResponse,
  type ProfitReportResponse,
} from "@/lib/rag-client/response-schemas";

function getRagServiceUrl(): string {
  const value = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("RAG_SERVICE_URL must use http or https");
  }
  return url.origin;
}

const RAG_SERVICE_URL = getRagServiceUrl();

/**
 * Note: per docs/API-CONTRACT.md §2.1, production deployments are expected to
 * require RAG_INTERNAL_SECRET, but the current FastAPI implementation does not
 * yet enforce it. We send the header when configured so future hardening is
 * opt-in on the frontend side.
 */
function buildInternalSecretHeaders(): Record<string, string> {
  const secret = process.env.RAG_INTERNAL_SECRET;
  if (!secret) return {};
  return { "X-Internal-Secret": secret };
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

async function parseJsonResponse<T>(
  url: string,
  resp: Response,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false; error: Error } },
): Promise<T> {
  if (!resp.ok) {
    throw new RagServiceError(
      `${RAG_ERROR_CODES.HTTP_PREFIX}${resp.status}` as RagServiceError["code"],
      `Scan service returned HTTP ${resp.status}`,
      { httpStatus: resp.status },
    );
  }

  let raw: unknown;
  try {
    raw = await resp.json();
  } catch (cause) {
    throw new RagServiceError(
      RAG_ERROR_CODES.INVALID_RESPONSE,
      "Scan service response was not valid JSON",
      { cause },
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new RagServiceError(
      RAG_ERROR_CODES.INVALID_RESPONSE,
      `Scan service response did not match schema: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export interface ScanMultipartInput {
  query: string;
  product: string;
  category: string;
  markets: string[];
  documents: Array<{ name: string; mimeType: string; text: string }>;
  images: Array<{ buffer: Buffer; originalName: string; mimeType: string }>;
  pdfs: Array<{ name: string; buffer: Buffer; mimeType: string }>;
}

export async function scanMultipart(input: ScanMultipartInput): Promise<ScanResponse> {
  const formData = new FormData();
  formData.set("query", input.query);
  formData.set("product", input.product);
  formData.set("category", input.category);
  formData.set("markets", JSON.stringify(input.markets));
  formData.set("documents", JSON.stringify(input.documents));

  for (const img of input.images) {
    formData.append(
      "images",
      new Blob([new Uint8Array(img.buffer)], { type: img.mimeType }),
      img.originalName,
    );
  }
  for (const pdf of input.pdfs) {
    formData.append(
      "pdfs",
      new Blob([new Uint8Array(pdf.buffer)], { type: pdf.mimeType }),
      pdf.name,
    );
  }

  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      `${RAG_SERVICE_URL}/scan-multipart`,
      {
        method: "POST",
        body: formData,
        headers: buildInternalSecretHeaders(),
      },
      RAG_SERVICE_TIMEOUT_MS,
    );
  } catch (err) {
    throw classifyFetchError(err);
  }

  return parseJsonResponse(`${RAG_SERVICE_URL}/scan-multipart`, resp, ScanResponseSchema);
}

export interface ProfitReportInput {
  product: string;
  category: string;
  markets: string[];
}

export async function fetchProfitReport(input: ProfitReportInput): Promise<ProfitReportResponse> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      `${RAG_SERVICE_URL}/profit-report`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildInternalSecretHeaders(),
        },
        body: JSON.stringify(input),
      },
      PROFIT_REPORT_TIMEOUT_MS,
    );
  } catch (err) {
    throw classifyFetchError(err);
  }

  return parseJsonResponse(`${RAG_SERVICE_URL}/profit-report`, resp, ProfitReportResponseSchema);
}

/**
 * Liveness check. Never throws — returns `{ ok, status, payload }`.
 * Use `/ready` (not yet exposed) for dependency-aware readiness.
 */
export interface HealthCheckResult {
  ok: boolean;
  status: number;
  payload: { status: string; version: string; demo_mode: boolean } | null;
}

export async function fetchHealth(): Promise<HealthCheckResult> {
  try {
    const resp = await fetchWithTimeout(
      `${RAG_SERVICE_URL}/health`,
      { method: "GET" },
      5_000,
    );
    const payload = (await resp.json().catch(() => null)) as HealthCheckResult["payload"];
    return { ok: resp.ok, status: resp.status, payload };
  } catch {
    return { ok: false, status: 0, payload: null };
  }
}

export { RAG_SERVICE_URL };
