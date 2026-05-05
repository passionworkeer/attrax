import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { createMockScanResult } from "@/lib/mock/scan-result";
import { runScan } from "@/lib/pipeline/scan";
import { createSession, updateSession } from "@/lib/pipeline/session-store";
import { StartScanRequestSchema } from "@/lib/schemas";
import type { Market, ProductCategory } from "@/lib/types";

export const runtime = "nodejs";

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
  setTimeout(() => {
    updateSession(sessionId, {
      progress: 30,
      stageText: "🔍 识别铭牌与认证标识…",
    });
  }, 1000);

  setTimeout(() => {
    updateSession(sessionId, {
      progress: 65,
      stageText: "📚 匹配欧美法规库…",
    });
  }, 2500);

  setTimeout(() => {
    updateSession(sessionId, {
      status: "ready",
      progress: 100,
      stageText: "✅ 烧毁完成，正在生成报告…",
      result: createMockScanResult(sessionId),
    });
  }, 4500);
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: { code: "BAD_INPUT", message: "无效的请求格式" } },
      { status: 400 }
    );
  }

  const imageFiles = formData.getAll("images").filter(isFile);
  const documentFiles = formData.getAll("documents").filter(isFile);

  const parsed = StartScanRequestSchema.safeParse({
    category: formData.get("category") ?? "electronics",
    markets: parseMarkets(formData.get("markets")),
    imageCount: imageFiles.length,
    documentCount: documentFiles.length,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_INPUT",
          message: "请至少上传 1 张图片，并确认 category / markets 合法。",
        },
      },
      { status: 400 }
    );
  }

  if (imageFiles.length === 0) {
    return NextResponse.json(
      { error: { code: "BAD_INPUT", message: "请至少上传 1 张图片。" } },
      { status: 400 }
    );
  }

  if (documentFiles.length > 5) {
    return NextResponse.json(
      { error: { code: "BAD_INPUT", message: "文档数量不能超过 5 个。" } },
      { status: 400 }
    );
  }

  const sessionId = `scan_${ulid()}`;
  createSession(sessionId);

  if (process.env.DEMO_MODE === "true") {
    runDemoSimulation(sessionId);
  } else {
    const images = await Promise.all(
      imageFiles.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
      }))
    );

    // Separate PDFs (sent as base64 for server-side extraction) from text-based docs
    const pdfFiles = documentFiles.filter(
      (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
    );
    const textFiles = documentFiles.filter(
      (f) => f.type !== "application/pdf" && !f.name.endsWith(".pdf")
    );

    const documents = await Promise.all(
      textFiles.map(async (file) => {
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
    );

    // PDFs: send as base64 for backend pdfplumber extraction
    const pdfs = await Promise.all(
      pdfFiles.map(async (file) => ({
        name: file.name,
        buffer: Buffer.from(await file.arrayBuffer()).toString("base64"),
        mimeType: "application/pdf",
      }))
    );

    runScan(sessionId, {
      images,
      documents,
      pdfs,
      category: parsed.data.category as ProductCategory,
      markets: parsed.data.markets,
    }).catch((error) => {
      updateSession(sessionId, {
        status: "failed",
        error: error instanceof Error ? error.message : "扫描失败",
      });
    });
  }

  return NextResponse.json(
    {
      sessionId,
      status: "processing",
      pollUrl: `/api/scan/${sessionId}`,
    },
    { status: 202 }
  );
}
