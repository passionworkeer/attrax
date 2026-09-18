/**
 * app/api/scan/route.ts — POST /api/scan (web BFF)
 *
 * Streams the inbound multipart body straight to FastAPI's
 * /api/v1/scans endpoint so neither the BFF nor Node buffers the full
 * upload into heap (under concurrent scans this used to push pm2 past
 * `max_memory_restart: 768M`). Boundary / category / markets / declared
 * facts are still validated in the BFF, but per-file signature checks are
 * delegated to the upstream `python-multipart` parser — same source of
 * truth as before, no behavioural change.
 *
 * In production the access token is kept only in an HttpOnly cookie. Browser
 * JavaScript receives the session id and poll URL but never the bearer secret.
 * Non-production keeps the token in the JSON payload for existing local tests
 * and debugging clients.
 */
import { NextResponse } from "next/server";
import {
  createScanStream,
  upstreamForwardFrom,
  V1EnvelopeError,
} from "@/lib/rag-client/v1-adapter";
import { ok } from "@/lib/api-response";
import { backendSessionCookie } from "@/app/api/backend-session-access";
import { createDemoScanSession } from "@/lib/pipeline/demo-scan-session";
import { checkRateLimit, resolveClientId } from "@/lib/rate-limit";
import type { Market, ProductCategory } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 50 * 1024 * 1024;
const DEFAULT_MARKETS = ["EU", "US"] as const;
// 2026-09-13 audit P0-5: keep this list in lockstep with the upload page
// (lib/types.ts MARKET_IDS) and the backend allow-list (rag_service/config.py
// ALLOWED_MARKETS). Anything the upload page lets users pick must round-trip
// through the BFF — otherwise the backend silently filters it back to EU/US.
const ALLOWED_MARKETS = new Set([
  "EU",
  "US",
  "UK",
  "CN",
  "AU",
  "SA",
  "AE",
  "JP",
  "KR",
  "CA",
  "SG",
  "MX",
  "BR",
  "DE",
  "FR",
  "IT",
]);
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

// The upload wizard puts its text fields (category / markets / locale /
// declared_facts) before the file parts precisely so this window can see
// them; 8KB covers the text prelude plus the first part headers with room
// to spare. If a client orders files first the peek simply finds nothing
// and the early check is skipped — the upstream parser still sees the
// whole body, so the only cost is losing a cheap pre-rejection.
const MULTIPART_PEEK_BYTES = 8 * 1024;

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

// The upload page sends `markets` as a comma-joined string; keep the same
// allow-list + defaulting the pre-streaming BFF used so the demo session
// renders the user's actual selection.
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

// Multipart boundaries are case-insensitive ASCII tokens of up to 70 chars
// from the RFC 2046 grammar. Quick sniff rejects any Content-Type that
// cannot possibly be a multipart upload before we hand the body to fetch.
const MULTIPART_CONTENT_TYPE = /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;]+))/i;

function validateContentType(request: Request): Response | null {
  const raw = request.headers.get("content-type") ?? "";
  if (!MULTIPART_CONTENT_TYPE.test(raw)) {
    // 400/BAD_INPUT, not 415: the code existed before the streaming rewrite
    // and clients (including the production regression script) match on it.
    return badInputResponse("BAD_INPUT", "请求体无法解析为 multipart/form-data。");
  }
  return null;
}

// Find the value of a multipart/form-data field in the leading bytes of a
// streamed body. Returns null if the boundary isn't reached in the peek —
// the upstream parser will still validate the full body; the peek is only
// used for cheap BFF-side rejection of obviously-malformed submissions.
//
// We deliberately do NOT touch file fields: their signature checks belong
// to the FastAPI `_valid_signature` step so the source of truth stays in
// one place. The upstream's `_read_uploads` enforces file counts, per-file
// type/suffix, magic bytes, and the 50MB total.
async function peekFirstField(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  fieldName: string,
): Promise<string | null> {
  const reader = body.getReader();
  let collected = new Uint8Array(0);
  try {
    while (collected.length < MULTIPART_PEEK_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(collected.length + value.length);
      merged.set(collected, 0);
      merged.set(value, collected.length);
      collected = merged;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream is still attached to the underlying body, so we can
      // ignore double-release attempts.
    }
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(collected);
  // A part is: `--boundary CRLF` (headers, each ending CRLF) CRLF value.
  // Group 1 is the header block, group 2 the first value line. The header
  // block is bounded to 8 lines so a long body cannot make the inner `+`
  // backtrack pathologically.
  const escapedBoundary = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const partRegex = new RegExp(
    `--${escapedBoundary}\\r\\n((?:[^\\r\\n]+\\r\\n){1,8})\\r\\n([^\\r\\n]*)`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = partRegex.exec(text)) !== null) {
    const headersBlock = match[1];
    const nameMatch = headersBlock.match(
      new RegExp(`name="${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "i"),
    );
    if (!nameMatch) continue;
    return match[2].trim();
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  const contentLengthError = validateContentLength(request);
  if (contentLengthError) return contentLengthError;

  const contentTypeError = validateContentType(request);
  if (contentTypeError) return contentTypeError;

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

  // DEMO_MODE:不走 RAG(CI e2e 与无后端本地预览场景)。用纯前端 demo 会话状态机
  // 跑通 upload → burning → result 链路,result 标 source:"demo"。生产关闭
  // DEMO_MODE 时完全不进入此分支,继续走下方真实 v1-adapter 路径。
  //
  // 这里仍然整份解析表单：demo 只在本地/CI 跑，没有并发上传的内存压力，
  // 而 demo 会话的品类/市场/图片数都直接影响 mock 场景，必须拿真值。
  if (process.env.DEMO_MODE === "true") {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return badInputResponse("BAD_INPUT", "请求体无法解析为 multipart/form-data。");
    }
    const demoCategory = String(form.get("category") ?? DEFAULT_CATEGORY).trim();
    if (!ALLOWED_CATEGORIES.has(demoCategory)) {
      return badInputResponse("INVALID_CATEGORY", "Unsupported product category.");
    }
    const demoMarkets = parseMarkets(form.get("markets"));
    const demoImageCount = form.getAll("images").filter((entry) => entry instanceof File).length;
    const created = createDemoScanSession({
      category: demoCategory as ProductCategory,
      markets: demoMarkets,
      imageCount: Math.max(demoImageCount, 1),
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

  // Extract declared text fields by peeking at the streamed body. The body
  // remains a ReadableStream; we do NOT consume it — only the peek copies
  // the leading bytes into a local buffer that we throw away.
  const contentTypeHeader = request.headers.get("content-type") ?? "";
  const boundaryMatch = contentTypeHeader.match(MULTIPART_CONTENT_TYPE);
  const boundary = boundaryMatch
    ? (boundaryMatch[1] ?? boundaryMatch[2] ?? "").trim()
    : "";

  let body: ReadableStream<Uint8Array> | null = request.body;
  if (!body || !boundary) {
    return badInputResponse("BAD_INPUT", "请求体无法解析为 multipart/form-data。");
  }

  // Tear off a tee'd copy of the body so the peek doesn't consume the
  // bytes we are about to forward. We immediately cancel the peek branch
  // once we have what we need, leaving the upstream stream intact.
  const [peekBranch, forwardBranch] = body.tee();
  body = forwardBranch;
  const peeked = await peekFirstField(peekBranch, boundary, "category").catch(
    () => null,
  );
  // Cancel the peek branch — the upstream fetch only sees forwardBranch.
  try {
    await peekBranch.cancel();
  } catch {
    // already drained
  }

  // Early rejection only. The peek reads at most the first 8KB, so a client
  // that orders its parts differently just loses this cheap pre-check: the
  // body is forwarded byte-for-byte either way and the upstream decides.
  // Note the upstream validates markets and declared_facts but NOT category
  // against an allow-list — this check is the only category gate, which is
  // why the upload page is expected to put text fields first.
  const categoryRaw = peeked && peeked.trim().length > 0 ? peeked.trim() : DEFAULT_CATEGORY;
  if (!ALLOWED_CATEGORIES.has(categoryRaw)) {
    // Nothing downstream will read the body — release it rather than leaving
    // the request stream dangling until the connection is torn down.
    await body.cancel().catch(() => undefined);
    return badInputResponse("INVALID_CATEGORY", "Unsupported product category.");
  }

  try {
    const created = await createScanStream({
      body,
      headers: { contentType: contentTypeHeader },
      ...upstreamForwardFrom(request),
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
