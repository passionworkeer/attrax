import { ulid } from "ulid";
import { createMockComplianceReportResult, createMockProfitReport, createMockProfitReports } from "@/lib/mock/scan-result";
import { createSession, updateSession } from "@/lib/pipeline/session-store";
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
  | "RATE_LIMITED";

const SCAN_ERROR_KEYS: Record<ScanErrorReason, string> = {
  INVALID_REQUEST: "errors.invalidRequest",
  UPLOAD_AT_LEAST_ONE_IMAGE: "errors.uploadAtLeastOne",
  TOO_MANY_DOCUMENTS: "errors.tooManyDocuments",
  TOO_MANY_IMAGES: "errors.invalidRequest",
  IMAGE_TOO_LARGE: "errors.invalidRequest",
  DOCUMENT_TOO_LARGE: "errors.invalidRequest",
  UNSUPPORTED_IMAGE_TYPE: "errors.invalidRequest",
  UNSUPPORTED_DOCUMENT_TYPE: "errors.invalidRequest",
  INVALID_FILE_SIGNATURE: "errors.invalidRequest",
  RATE_LIMITED: "errors.invalidRequest",
};

function scanBadInput(reason: ScanErrorReason, status = 400) {
  const key = SCAN_ERROR_KEYS[reason];
  return fail(
    {
      code: status === 429 ? "RATE_LIMITED" : "BAD_INPUT",
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
  if (!checkRateLimit(`scan:${clientIp(request)}`, API_SCAN_RATE_LIMIT, API_RATE_LIMIT_WINDOW_MS)) {
    return scanBadInput("RATE_LIMITED", 429);
  }

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

  const sessionId = `scan_${ulid()}`;
  const accessToken = createAccessToken();
  const ip = clientIp(request);
  createSession(sessionId);
  updateSession(sessionId, { accessTokenHash: hashAccessToken(accessToken) });

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

  enqueueScan(sessionId, {
    images: imageData,
    documents,
    pdfs,
    category: parsed.data.category as ProductCategory,
    markets: parsed.data.markets,
  });

  // ── Audit trail ────────────────────────────────────────────────────────
  // Save the original uploads to disk so admins can review what each user
  // submitted after the fact. The buffers above are only kept in memory until
  // the pipeline finishes; without this step the originals are lost.
  const savedUploads = saveUploadsForSession(
    sessionId,
    imageData.map((img) => ({
      buffer: img.buffer,
      originalName: img.originalName,
      mimeType: img.mimeType,
      kind: "image" as const,
    }))
  );
  for (const doc of documents) {
    // text-only docs have no on-disk buffer to archive; record the metadata so
    // admins at least see what was attached by filename and size estimate.
    savedUploads.push({
      originalName: doc.name,
      savedAs: "",
      savedPath: "",
      size: doc.text.length,
      mimeType: doc.mimeType,
      sha256: "",
      kind: "document" as const,
    });
  }
  for (const pdf of pdfs) {
    const [saved] = saveUploadsForSession(sessionId, [
      {
        buffer: pdf.buffer,
        originalName: pdf.name,
        mimeType: pdf.mimeType,
        kind: "document" as const,
      },
    ]);
    if (saved) savedUploads.push(saved);
  }
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
