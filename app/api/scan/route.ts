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
  const formData = await request.formData();
  const files = formData.getAll("images").filter(isFile);

  const parsed = StartScanRequestSchema.safeParse({
    category: formData.get("category") ?? "electronics",
    markets: parseMarkets(formData.get("markets")),
    imageCount: files.length,
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

  const sessionId = `scan_${ulid()}`;
  createSession(sessionId);

  if (process.env.DEMO_MODE === "true") {
    runDemoSimulation(sessionId);
  } else {
    const images = await Promise.all(
      files.map(async (file) => ({
        buffer: Buffer.from(await file.arrayBuffer()),
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
      }))
    );

    runScan(sessionId, {
      images,
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
