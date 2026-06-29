import { ulid } from "ulid";
import { createHash } from "crypto";
import { createMockComplianceReportResult, createMockProfitReport, createMockProfitReports } from "@/lib/mock/scan-result";
import { createSession, deleteSession, updateSession } from "@/lib/pipeline/session-store";
import { enqueueScan } from "@/lib/pipeline/scan-queue";
import { logUserActivity, saveUploadsForSession } from "@/lib/pipeline/upload-storage";
import { ok, fail } from "@/lib/api-response";
import type { ComplianceReportResult } from "@/lib/types";
import { createAccessToken, hashAccessToken } from "@/lib/pipeline/session-auth";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  API_RATE_LIMIT_WINDOW_MS,
  API_SCAN_RATE_LIMIT,
  MAX_DOCUMENT_FILES,
  MAX_IMAGE_FILES,
} from "@/lib/constants";
import { validateUploadFile } from "@/lib/upload-validation";
import { StartScanRequestSchema } from "@/lib/schemas";
import { SCAN_STAGE_TEXT, serverT } from "@/lib/server-i18n";
import type { Market, ProductCategory } from "@/lib/types";

export const runtime = "nodejs";

/** Per-IP-per-day free scan cap. Defaults to 3 (see CLAUDE.md). Set to 0 to
 *  disable the daily cap (e.g. internal deployments). */
function getDailyFreeScanLimit(): number {
  const raw = Number.parseInt(process.env.DAILY_FREE_SCAN_LIMIT ?? "3", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 3;
}

/** Milliseconds until local-midnight — used as the TTL for daily counters so a
 *  cap resets at the start of each day in server-local time. */
function msUntilMidnight(now: Date = new Date()): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1, midnight.getTime() - now.getTime());
}

type ScanErrorReason =
  | "INVALID_REQUEST"
  | "UPLOAD_AT_LEAST_ONE_IMAGE"
  | "TOO_MANY_DOCUMENTS"
  | "TOO_MANY_IMAGES"
  | "IMAGE_TOO_LARGE"
  | "DOCUMENT_TOO_LARGE"
  | "UNSUPPORTED_IMAGE_TYPE"
  | "UNSUPPORTED_DOCUMENT_TYPE"
  | "INVALID_FILE_SIGNATURE"
  | "RATE_LIMITED"
  | "DAILY_LIMIT_REACHED";

// Each reason maps to its own i18n key so the UI can render a specific,
// actionable message instead of a generic "invalid request".
const SCAN_ERROR_KEYS: Record<ScanErrorReason, string> = {
  INVALID_REQUEST: "errors.invalidRequest",
  UPLOAD_AT_LEAST_ONE_IMAGE: "errors.uploadAtLeastOne",
  TOO_MANY_DOCUMENTS: "errors.tooManyDocuments",
  TOO_MANY_IMAGES: "errors.tooManyImages",
  IMAGE_TOO_LARGE: "errors.imageTooLarge",
  DOCUMENT_TOO_LARGE: "errors.documentTooLarge",
  UNSUPPORTED_IMAGE_TYPE: "errors.unsupportedImageType",
  UNSUPPORTED_DOCUMENT_TYPE: "errors.unsupportedDocumentType",
  INVALID_FILE_SIGNATURE: "errors.invalidFileSignature",
  RATE_LIMITED: "errors.rateLimited",
  DAILY_LIMIT_REACHED: "errors.dailyLimitReached",
};

function scanBadInput(reason: ScanErrorReason, status = 400) {
  const key = SCAN_ERROR_KEYS[reason];
  const code = status === 429 ? "RATE_LIMITED" : "BAD_INPUT";
  return fail(
    {
      code,
      reason,
      message: serverT(key, "zh"),
      messageEn: serverT(key, "en"),
    },
    { status }
  );
}

function isFile(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value
  );
}

function parseMarkets(input: FormDataEntryValue | null): Market[] {
  if (typeof input !== "string" || !input.trim()) {
    return ["EU", "US"];
  }

  return input
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean) as Market[];
}

function runDemoSimulation(sessionId: string) {
  const stages = SCAN_STAGE_TEXT.zh;

  setTimeout(() => {
    updateSession(sessionId, {
      progress: 30,
      stageText: `🔍 ${stages.identifyingLabels}…`,
    });
  }, 1000);

  setTimeout(() => {
    updateSession(sessionId, {
      progress: 65,
      stageText: `📚 ${stages.matchingRegulations}…`,
    });
  }, 2500);

  setTimeout(() => {
    updateSession(sessionId, {
      status: "ready",
      progress: 100,
      stageText: `✅ ${stages.reportComplete}`,
      result: { ...createMockComplianceReportResult(sessionId) as unknown as ComplianceReportResult, source: "demo" as const },
      profitReport: createMockProfitReport(sessionId),
      profitReports: createMockProfitReports(sessionId),
    });
  }, 4500);
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return scanBadInput("INVALID_REQUEST");
  }

  const imageFiles = formData.getAll("images").filter(isFile);
  const documentFiles = formData.getAll("documents").filter(isFile);

  if (imageFiles.length === 0) {
    return scanBadInput("UPLOAD_AT_LEAST_ONE_IMAGE");
  }

  if (imageFiles.length > MAX_IMAGE_FILES) {
    return scanBadInput("TOO_MANY_IMAGES");
  }

  if (documentFiles.length > MAX_DOCUMENT_FILES) {
    return scanBadInput("TOO_MANY_DOCUMENTS");
  }

  for (const file of imageFiles) {
    const error = await validateUploadFile(file, "image");
    if (error) return scanBadInput(error);
  }

  for (const file of documentFiles) {
    const error = await validateUploadFile(file, "document");
    if (error) return scanBadInput(error);
  }

  const parsed = StartScanRequestSchema.safeParse({
    category: formData.get("category") ?? "electronics",
    markets: parseMarkets(formData.get("markets")),
    imageCount: imageFiles.length,
    documentCount: documentFiles.length,
  });

  if (!parsed.success) {
    return scanBadInput("INVALID_REQUEST");
  }

  // Rate-limit AFTER schema/validation: a request that fails Zod or upload
  // checks returns 400 without burning a daily or short-window slot. This
  // stops a bad-input flood from locking legitimate users out of their
  // allotment. Both checks still run before any session is created.
  if (!checkRateLimit(`scan:${clientIp(request)}`, API_SCAN_RATE_LIMIT, API_RATE_LIMIT_WINDOW_MS)) {
    return scanBadInput("RATE_LIMITED", 429);
  }

  // Daily free-scan cap, keyed per client-per-local-day. TTL rolls over at
  // local midnight so each user gets a fresh allotment at the start of their
  // day. CLAUDE.md advertises DAILY_FREE_SCAN_LIMIT=3; set to 0 to disable.
  const ip = clientIp(request);
  const dailyLimit = getDailyFreeScanLimit();
  if (dailyLimit > 0) {
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (!checkRateLimit(`daily:${ip}:${dateKey}`, dailyLimit, msUntilMidnight(today))) {
      return scanBadInput("DAILY_LIMIT_REACHED", 429);
    }
  }

  const sessionId = `scan_${ulid()}`;
  const accessToken = createAccessToken();
  // Atomically create the session WITH its access-token hash. The previous
  // createSession()+updateSession() pair left a window where a concurrent
  // poller could read a session with no hash before it was written — closing
  // it by passing the hash into createSession, which already supports it.
  createSession(sessionId, hashAccessToken(accessToken));

  if (process.env.DEMO_MODE === "true") {
    runDemoSimulation(sessionId);
    return ok(
      { sessionId, accessToken, status: "processing", pollUrl: `/api/scan/${sessionId}` },
      { status: 202 }
    );
  }

  // Parallelize: read all images + parse all text-based docs at once
  const [imageData, pdfFiles, docxFiles, rawTextFiles] = await Promise.all([
    Promise.all(
      imageFiles.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
      }))
    ),
    Promise.resolve(
      documentFiles.filter(
        (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
      )
    ),
    Promise.resolve(
      documentFiles.filter(
        (f) =>
          f.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          f.name.endsWith(".docx")
      )
    ),
    Promise.resolve(
      documentFiles.filter(
        (f) =>
          f.type !== "application/pdf" &&
          !f.name.endsWith(".pdf") &&
          f.type !==
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
          !f.name.endsWith(".docx")
      )
    ),
  ]);

  // Parse text docs and DOCX in parallel — mammoth loaded once, shared via cache
  const [textDocs, docxDocs] = await Promise.all([
    Promise.all(
      rawTextFiles.map(async (file) => {
        let text = "";
        try {
          text = await file.text();
        } catch { /* ignore */ }
        return {
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          text: text.slice(0, 5000),
        };
      })
    ),
    (async () => {
      if (docxFiles.length === 0) return [];
      const mammoth = await import("mammoth");
      return Promise.all(
        docxFiles.map(async (file) => {
          let text = "";
          try {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(new Uint8Array(arrayBuffer));
            const result = await mammoth.extractRawText({ buffer });
            text = result.value;
          } catch (e) {
            console.warn(`mammoth extraction failed for ${file.name}:`, e);
          }
          return {
            name: file.name,
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            text: text.slice(0, 5000),
          };
        })
      );
    })(),
  ]);

  const documents = [...textDocs, ...docxDocs];

  // PDFs: send as base64 for backend pdfplumber extraction
  const pdfs = await Promise.all(
    pdfFiles.map(async (file) => ({
      name: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: "application/pdf",
    }))
  );

  // Enqueue + rollback: enqueueScan writes a job file to data/scan-queue and
  // then drainQueue picks it up. If the write fails (quota exceeded, disk
  // full, EPERM), the session would be orphaned: a poller would keep seeing
  // status:"processing" forever because no worker is running the job. Roll
  // back the session entirely and return 503 so the client surfaces a real
  // error instead of hanging.
  try {
    enqueueScan(sessionId, {
      images: imageData,
      documents,
      pdfs,
      category: parsed.data.category as ProductCategory,
      markets: parsed.data.markets,
    });
  } catch (error) {
    console.error(`[scan] enqueueScan failed for ${sessionId}, rolling back session`, error);
    deleteSession(sessionId);
    return fail(
      {
        code: "SCAN_QUEUE_UNAVAILABLE",
        reason: "SCAN_QUEUE_UNAVAILABLE",
        message: "扫描队列暂时不可用，请稍后重试。",
        messageEn: "Scan queue is temporarily unavailable. Please retry later.",
      },
      { status: 503 }
    );
  }

  // ── Audit trail ────────────────────────────────────────────────────────
  // Save the original uploads to disk so admins can review what each user
  // submitted after the fact. The buffers above are only kept in memory until
  // the pipeline finishes; without this step the originals are lost.
  //
  // Immutable accumulation: each step produces a NEW array instead of pushing
  // into the returned array (which would mutate `saveUploadsForSession`'s
  // output and violate the immutability rule).
  const imageUploads = saveUploadsForSession(
    sessionId,
    imageData.map((img) => ({
      buffer: img.buffer,
      originalName: img.originalName,
      mimeType: img.mimeType,
      kind: "image" as const,
    }))
  );
  // text-only docs have no on-disk buffer to archive; record real metadata +
  // a content-derived sha256 so admins have an integrity fingerprint even
  // without a saved file.
  const textDocUploads = documents.map((doc) => ({
    originalName: doc.name,
    savedAs: "",
    savedPath: "",
    size: doc.text.length,
    mimeType: doc.mimeType,
    sha256: createHash("sha256").update(doc.text).digest("hex"),
    kind: "document" as const,
  }));
  const pdfUploads = pdfs
    .map((pdf) => {
      const [saved] = saveUploadsForSession(sessionId, [
        {
          buffer: pdf.buffer,
          originalName: pdf.name,
          mimeType: pdf.mimeType,
          kind: "document" as const,
        },
      ]);
      return saved;
    })
    .filter((u): u is NonNullable<typeof u> => Boolean(u));
  const savedUploads = [...imageUploads, ...textDocUploads, ...pdfUploads];
  updateSession(sessionId, { uploads: savedUploads });

  logUserActivity({
    ts: new Date().toISOString(),
    event: "scan_started",
    ip,
    sessionId,
    category: parsed.data.category,
    markets: parsed.data.markets,
    fileCount: savedUploads.length,
    totalBytes: savedUploads.reduce((sum, u) => sum + u.size, 0),
    files: savedUploads.map((u) => ({
      originalName: u.originalName,
      size: u.size,
      kind: u.kind,
      sha256: u.sha256,
    })),
  });

  return ok(
    { sessionId, accessToken, status: "processing", pollUrl: `/api/scan/${sessionId}` },
    { status: 202 }
  );
}
