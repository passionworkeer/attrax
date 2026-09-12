/**
 * app/api/scan/route.ts — POST /api/scan (web BFF)
 *
 * In production the access token is kept only in an HttpOnly cookie. Browser
 * JavaScript receives the session id and poll URL but never the bearer secret.
 * Non-production keeps the token in the JSON payload for existing local tests
 * and debugging clients.
 */
import { NextResponse } from "next/server";
import { createScan, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { ok } from "@/lib/api-response";
import { backendSessionCookie } from "@/app/api/backend-session-access";
import { validateUploadFile } from "@/lib/upload-validation";
import {
  MAX_DOCUMENT_FILES,
  MAX_IMAGE_FILES,
} from "@/lib/constants";
import { createDemoScanSession } from "@/lib/pipeline/demo-scan-session";
import { checkRateLimit, resolveClientId } from "@/lib/rate-limit";
import type { Market, ProductCategory } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const DEFAULT_MARKETS = ["EU", "US"] as const;
const ALLOWED_MARKETS = new Set(["EU", "US", "UK", "CN", "AU", "SA", "AE", "JP"]);
const ALLOWED_CATEGORIES = new Set([
  "electronics",
  "appliance",
  "3c",
  "toy",
  "toys",
  "home",
  "battery",
  "batteries",
  "textile",
  "textiles",
  "cosmetics",
  "cosmetic",
  "food_contact",
  "other",
]);
const DEFAULT_CATEGORY = "electronics";

function isFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value;
}

function badInputResponse(
  code: string,
  message: string,
  status = 400,
): Response {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

function parseMarkets(value: FormDataEntryValue | null): Market[] {
  if (typeof value !== "string") {
    return [...DEFAULT_MARKETS];
  }
  const parts = value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => ALLOWED_MARKETS.has(item));

  const unique = Array.from(new Set(parts)) as Market[];
  return unique.length ? unique : [...DEFAULT_MARKETS];
}

function buildQuery(category: string, markets: Market[]): string {
  return `评估 ${category} 类产品在 ${markets.join("/")} 市场的合规风险`;
}

function validateContentLength(request: Request): Response | null {
  const raw = request.headers.get("content-length");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return badInputResponse("BAD_CONTENT_LENGTH", "Invalid Content-Length header.");
  }
  if (value > MAX_REQUEST_BYTES) {
    return badInputResponse("REQUEST_TOO_LARGE", "Upload request exceeds 50MB.", 413);
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const contentLengthError = validateContentLength(request);
  if (contentLengthError) return contentLengthError;

  // Origin check for CSRF defense on simple multipart requests
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return badInputResponse("CROSS_ORIGIN_FORBIDDEN", "Cross-origin scan submission forbidden.", 403);
      }
    } catch {
      // Ignore invalid URL formatting
    }
  }

  // Rate limiting defense against quota exhaustion
  const clientId = resolveClientId(request);
  if (!checkRateLimit(`scan:${clientId}`, 10, 60_000)) {
    return badInputResponse("RATE_LIMITED", "请求过于频繁，请稍候再试。", 429);
  }

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

  for (const file of imageFiles) {
    const error = await validateUploadFile(file, "image");
    if (error) {
      return badInputResponse(error, `图片 “${file.name || "未命名"}” 校验失败。`);
    }
  }
  for (const file of documentFiles) {
    const error = await validateUploadFile(file, "document");
    if (error) {
      return badInputResponse(error, `文档 “${file.name || "未命名"}” 校验失败。`);
    }
  }

  const category = String(formData.get("category") ?? DEFAULT_CATEGORY).trim();
  if (!ALLOWED_CATEGORIES.has(category)) {
    return badInputResponse("INVALID_CATEGORY", "Unsupported product category.");
  }
  const markets = parseMarkets(formData.get("markets"));
  if (!markets.length) {
    return badInputResponse("INVALID_MARKETS", "Use one to five supported markets.");
  }
  const query = String(formData.get("query") ?? buildQuery(category, markets)).trim();
  const product = String(formData.get("product") ?? "").trim();
  if (!query || query.length > 2_000 || product.length > 500) {
    return badInputResponse("INVALID_REQUEST", "Invalid scan fields.");
  }

  const [images, documents] = await Promise.all([
    Promise.all(
      imageFiles.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        originalName: file.name || "image",
        mimeType: file.type || "application/octet-stream",
      })),
    ),
    Promise.all(
      documentFiles.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        originalName: file.name || "document",
        mimeType: file.type || "application/octet-stream",
      })),
    ),
  ]);

  try {
    // DEMO_MODE:不走 RAG(CI e2e 与无后端本地预览场景)。用纯前端 demo 会话状态机
    // 跑通 upload → burning → result 链路,result 标 source:"demo"。生产关闭
    // DEMO_MODE 时完全不进入此分支,继续走下方真实 v1-adapter 路径。
    if (process.env.DEMO_MODE === "true") {
      const created = createDemoScanSession({
        category: category as ProductCategory,
        markets: markets as Market[],
        imageCount: images.length,
      });
      const demoPayload: {
        sessionId: string;
        status: "processing";
        pollUrl: string;
        accessToken?: string;
      } = {
        sessionId: created.sessionId,
        status: created.status,
        pollUrl: created.pollUrl,
      };
      if (process.env.NODE_ENV !== "production") {
        demoPayload.accessToken = created.accessToken;
      }
      const demoResponse = ok(demoPayload, { status: 202 });
      demoResponse.headers.append(
        "Set-Cookie",
        backendSessionCookie(created.sessionId, created.accessToken),
      );
      return demoResponse;
    }

    const created = await createScan({
      query,
      product,
      category,
      markets,
      images,
      documents,
    });

    const payload: {
      sessionId: string;
      status: "processing";
      pollUrl: string;
      accessToken?: string;
    } = {
      sessionId: created.sessionId,
      status: created.status,
      pollUrl: `/api/scan/${created.sessionId}`,
    };
    // 审计 3.4：改为显式 opt-in，避免 NODE_ENV 误配（如容器未设 production）
    // 导致访问令牌经响应体泄露。默认关闭。
    if (process.env.ATTRAX_DEBUG_TOKEN === "1") {
      payload.accessToken = created.accessToken;
    }

    const response = ok(payload, { status: 202 });
    response.headers.append(
      "Set-Cookie",
      backendSessionCookie(created.sessionId, created.accessToken),
    );
    return response;
  } catch (err) {
    if (err instanceof V1EnvelopeError) {
      const httpStatus =
        err.httpStatus >= 400 && err.httpStatus < 500 ? err.httpStatus : 502;
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
        error: {
          code: "SCAN_SERVICE_UNAVAILABLE",
          message: "Scan service unavailable",
        },
      },
      { status: 502 },
    );
  }
}
