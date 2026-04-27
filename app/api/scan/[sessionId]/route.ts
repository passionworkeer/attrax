import { NextResponse } from "next/server";
import { createMockScanResult } from "@/lib/mock/scan-result";
import { getSession } from "@/lib/pipeline/session-store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;

  if (sessionId === "demo") {
    return NextResponse.json({
      sessionId: "demo",
      status: "ready",
      progress: 100,
      stageText: "完成",
      result: createMockScanResult("demo"),
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "未找到对应扫描会话。",
        },
      },
      { status: 404 }
    );
  }

  return NextResponse.json(session);
}
