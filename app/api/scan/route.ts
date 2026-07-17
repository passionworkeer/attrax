/**
 * app/api/scan/route.ts — POST /api/scan (handoff BFF)
 *
 * The legacy Next.js scan pipeline (lib/pipeline/scan.ts + scan-queue) is no
 * longer used to drive scans. This route is a thin BFF forwarder that:
 *   1. Validates uploads locally (defense in depth; FastAPI also validates)
 *   2. POSTs the multipart form to FastAPI `/api/v1/scans`
 *   3. Returns the wire-shape the upload page already reads
 *      (`{ sessionId, status, pollUrl, accessToken }`)
 *
 * Pages still hit `/api/scan`; the Next.js GET route (see
 * `app/api/scan/[sessionId]/route.ts`) then forwards polls to
 * `/api/v1/scans/{id}` with a Bearer access token.
 */
import { NextResponse } from "next/server";
import { createScan, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { ok } from "@/lib/api-response";
import { backendSessionCookie } from "@/app/api/backend-session-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPTED_DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_FILES = 8;
const MAX_DOCUMENT_FILES = 5;

const DEFAULT_MARKETS = ["EU", "US"] as const;
const DEFAULT_CATEGORY = "electronics";

function isFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value
  );
}

function parseMarkets(input: FormDataEntryValue | null): string[] {
  if (typeof input !== "string" || !input.trim()) {
    return [...DEFAULT_MARKETS];
  }
  // Accept either JSON-stringified array or comma-separated list (upload page
  // uses the comma form; preserved here so the existing client still works).
  if (input.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.map((m) => String(m).trim().toUpperCase()).filter(Boolean);
      }
    } catch {
      /* fall through to CSV */
    }
  }
  return input
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
}

function buildQuery(category: string, markets: string[]): string {
  return `compliance scan for ${category} targeting ${markets.join(", ")}`;
}

function badInputResponse(
  code: string,
  message: string,
  status = 400,
): Response {
  return NextResponse.json(
    { success: false, data: null, error: { code, message } },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badInputResponse("BAD_INPUT", "请求体无法解析为 multipart/form-data。");
  }

  const imageFiles = formData.getAll("images").filter(isFile);
  const documentFiles = formData.getAll("documents").filter(isFile);

  if (imageFiles.length === 0) {
    return badInputResponse("BAD_INPUT", "请至少上传 1 张图片。");
  }
  if (imageFiles.length > MAX_IMAGE_FILES) {
    return badInputResponse("BAD_INPUT", `图片不能超过 ${MAX_IMAGE_FILES} 张。`);
  }
  if (documentFiles.length > MAX_DOCUMENT_FILES) {
    return badInputResponse("BAD_INPUT", `文档不能超过 ${MAX_DOCUMENT_FILES} 个。`);
  }

  for (const f of imageFiles) {
    if (f.type && !ACCEPTED_IMAGE_TYPES.has(f.type)) {
      return badInputResponse(
        "UNSUPPORTED_IMAGE_TYPE",
        `图片 "${f.name || "未命名"}" 格式不支持。`,
      );
    }
    if (f.size > MAX_IMAGE_BYTES) {
      return badInputResponse(
        "IMAGE_TOO_LARGE",
        `图片 "${f.name || "未命名"}" 超过 12MB。`,
      );
    }
  }

  for (const f of documentFiles) {
    if (f.type && !ACCEPTED_DOCUMENT_TYPES.has(f.type)) {
      return badInputResponse(
        "UNSUPPORTED_DOCUMENT_TYPE",
        `文档 "${f.name || "未命名"}" 格式不支持。`,
      );
    }
    if (f.size > MAX_DOCUMENT_BYTES) {
      return badInputResponse(
        "DOCUMENT_TOO_LARGE",
        `文档 "${f.name || "未命名"}" 超过 15MB。`,
      );
    }
  }

  const category = String(formData.get("category") ?? DEFAULT_CATEGORY);
  const markets = parseMarkets(formData.get("markets"));
  const query = String(formData.get("query") ?? buildQuery(category, markets));
  const product = String(formData.get("product") ?? "");

  // Read buffers in parallel. multipart is the contract the v1 endpoint expects.
  const [images, documents] = await Promise.all([
    Promise.all(
      imageFiles.map(async (f) => ({
        buffer: Buffer.from(await f.arrayBuffer()),
        originalName: f.name || "image",
        mimeType: f.type || "application/octet-stream",
      })),
    ),
    Promise.all(
      documentFiles.map(async (f) => ({
        buffer: Buffer.from(await f.arrayBuffer()),
        originalName: f.name || "document",
        mimeType: f.type || "application/octet-stream",
      })),
    ),
  ]);

  try {
    const created = await createScan({
      query,
      product,
      category,
      markets,
      images,
      documents,
    });

    // The upload page reads `sessionId`, `status`, and routes by `pollUrl`.
    // We remap the v1 pollUrl (`/api/v1/scans/{id}`) to the Next.js BFF route
    // (`/api/scan/{id}`) so existing client code keeps working unchanged.
    // `accessToken` is also returned so callers can opt-in to send it as a
    // Bearer header on subsequent polls (see GET route).
    const response = ok(
      {
        sessionId: created.sessionId,
        accessToken: created.accessToken,
        status: created.status,
        pollUrl: `/api/scan/${created.sessionId}`,
      },
      { status: 202 },
    );
    response.headers.append(
      "Set-Cookie",
      backendSessionCookie(created.sessionId, created.accessToken),
    );
    return response;
  } catch (err) {
    if (err instanceof V1EnvelopeError) {
      // Surface envelope-level errors with their original HTTP status when
      // it's a real client-fault (4xx); collapse infra-class faults to 502.
      const httpStatus = err.httpStatus >= 400 && err.httpStatus < 500 ? err.httpStatus : 502;
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: err.code, message: err.message },
        },
        { status: httpStatus },
      );
    }
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: { code: "RAG_SERVICE_UNAVAILABLE", message: "RAG service unavailable" },
      },
      { status: 502 },
    );
  }
}
