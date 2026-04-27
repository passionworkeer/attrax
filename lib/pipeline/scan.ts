import { updateSession } from "@/lib/pipeline/session-store";
import type { Market, ProductCategory } from "@/lib/types";

export interface RunScanInput {
  images: Array<{
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  }>;
  category: ProductCategory;
  markets: Market[];
}

export async function runScan(sessionId: string, input: RunScanInput) {
  void input;
  updateSession(sessionId, {
    progress: 20,
    stageText: "真实扫描管线尚未接入，正在回退…",
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));

  updateSession(sessionId, {
    status: "failed",
    progress: 20,
    stageText: "真实扫描暂不可用",
    error: "真实 Vision 管线将在后续 Phase 接入。当前请保持 DEMO_MODE=true。",
  });
}
