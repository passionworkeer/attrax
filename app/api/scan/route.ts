import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { createMockScanResult, createMockProfitReport } from "@/lib/mock/scan-result";
import { runScan } from "@/lib/pipeline/scan";
import { createSession, updateSession } from "@/lib/pipeline/session-store";
import {
  MAX_DOCUMENT_FILES,
  MAX_DOCUMENT_SIZE_BYTES,
  MAX_IMAGE_FILES,
  MAX_IMAGE_SIZE_BYTES,
} from "@/lib/constants";
import { StartScanRequestSchema } from "@/lib/schemas";
import { getTranslations, t as serverT } from "@/lib/i18n";
import type { Market, ProductCategory } from "@/lib/types";

export const runtime = "nodejs";

type ScanErrorReason =
  | "INVALID_REQUEST"
  | "UPLOAD_AT_LEAST_ONE_IMAGE"
  | "TOO_MANY_DOCUMENTS"
  | "TOO_MANY_IMAGES"
  | "IMAGE_TOO_LARGE"
  | "DOCUMENT_TOO_LARGE";

const SCAN_ERROR_KEYS: Record<ScanErrorReason, string> = {
  INVALID_REQUEST: "errors.invalidRequest",
  UPLOAD_AT_LEAST_ONE_IMAGE: "errors.uploadAtLeastOne",
  TOO_MANY_DOCUMENTS: "errors.tooManyDocuments",
  TOO_MANY_IMAGES: "errors.invalidRequest",
  IMAGE_TOO_LARGE: "errors.invalidRequest",
  DOCUMENT_TOO_LARGE: "errors.invalidRequest",
};

function scanBadInput(reason: ScanErrorReason) {
  const key = SCAN_ERROR_KEYS[reason];
  return NextResponse.json(
    {
      error: {
        code: "BAD_INPUT",
        reason,
        message: serverT(key, "zh"),
        messageEn: serverT(key, "en"),
      },
    },
    { status: 400 }
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
  const tx = getTranslations("zh");
  const stages = tx.scanStages;

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
      result: createMockScanResult(sessionId),
      profitReport: createMockProfitReport(sessionId),
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

  if (imageFiles.some((file) => file.size > MAX_IMAGE_SIZE_BYTES)) {
    return scanBadInput("IMAGE_TOO_LARGE");
  }

  if (documentFiles.some((file) => file.size > MAX_DOCUMENT_SIZE_BYTES)) {
    return scanBadInput("DOCUMENT_TOO_LARGE");
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
  createSession(sessionId);

  if (process.env.DEMO_MODE === "true") {
    runDemoSimulation(sessionId);
    return NextResponse.json(
      { sessionId, status: "processing", pollUrl: `/api/scan/${sessionId}` },
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
  const pdfs = pdfFiles.map((file) => ({
    name: file.name,
    file,
    mimeType: "application/pdf",
  }));

  void runScan(sessionId, {
    images: imageData,
    documents,
    pdfs,
    category: parsed.data.category as ProductCategory,
    markets: parsed.data.markets,
  }).catch((error) => {
    updateSession(sessionId, {
      status: "failed",
      error: error instanceof Error ? error.message : "SCAN_FAILED",
    });
  });

  return NextResponse.json(
    { sessionId, status: "processing", pollUrl: `/api/scan/${sessionId}` },
    { status: 202 }
  );
}
