/**
 * runScan.ts — Real scan pipeline that calls the rag-service Agentic RAG backend.
 *
 * Flow:
 * 1. Parse images for Vision AI context (basic product info extraction)
 * 2. POST scan request to rag-service (localhost:8000)
 * 3. Poll session until ready
 * 4. Update session store with full report + agent_trace
 */
import { updateSession } from "@/lib/pipeline/session-store";
import type { Market, ProductCategory } from "@/lib/types";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8000";
const RAG_SERVICE_TIMEOUT_MS = 120_000; // 2 min max for full scan
const POLL_INTERVAL_MS = 2_000;         // poll every 2s

export interface RunScanInput {
  images: Array<{
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  }>;
  category: ProductCategory;
  markets: Market[];
  query?: string;
}

interface RagServiceResponse {
  status: "PASS" | "WARN" | "REJECTED" | "UNKNOWN";
  report: string;
  agent_trace: Array<{
    node: string;
    [key: string]: unknown;
  }>;
  loop_count: number;
  documents?: Array<{
    id: string;
    doc_name: string;
    article_no: string;
    region: string;
    score: number;
  }>;
}

/** Build a query string from images + category + markets. */
function buildQuery(
  images: RunScanInput["images"],
  category: ProductCategory,
  markets: Market[]
): string {
  const productMap: Record<ProductCategory, string> = {
    electronics: "电子产品",
    appliance: "家用电器",
    "3c": "3C电子产品",
    toy: "玩具产品",
    home: "家居用品",
    other: "商品",
  };
  const product = productMap[category] ?? "商品";
  const marketStr = markets.join("+");
  return `${product}出口${marketStr}合规要求和认证`;
}

async function pollSessionStatus(sessionId: string): Promise<RagServiceResponse | null> {
  const url = `${RAG_SERVICE_URL}/scan/${sessionId}`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as RagServiceResponse;
  } catch {
    return null;
  }
}

/**
 * Main scan function — runs the full Agentic RAG pipeline via HTTP.
 * Updates session store incrementally so the burning page shows progress.
 */
export async function runScan(sessionId: string, input: RunScanInput) {
  const { images, category, markets } = input;
  const query = input.query ?? buildQuery(images, category, markets);

  // ── Stage 1: Vision analysis (placeholder — fires async) ────────────────
  updateSession(sessionId, {
    progress: 10,
    stageText: "🔍 分析上传图片…",
  });

  // In production: use Claude Sonnet Vision to extract product info from images.
  // For now: use image count as a proxy for progress indicator.
  await sleep(800);
  const imageCount = images.length;
  void imageCount;

  // ── Stage 2: Query planning + retrieval ────────────────────────────────
  updateSession(sessionId, {
    progress: 30,
    stageText: "🧠 规划检索策略…",
  });

  // ── Stage 3: RAG service call ───────────────────────────────────────────
  updateSession(sessionId, {
    progress: 45,
    stageText: "📚 检索合规法规库…",
  });

  let ragResponse: RagServiceResponse;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RAG_SERVICE_TIMEOUT_MS);

    const resp = await fetch(`${RAG_SERVICE_URL}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        product: category,
        category,
        markets,
        vision_result: { image_count: images.length },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "Unknown error");
      throw new Error(`RAG service returned ${resp.status}: ${errorText}`);
    }

    ragResponse = (await resp.json()) as RagServiceResponse;

  } catch (err) {
    const message = err instanceof Error ? err.message : "RAG 服务调用失败";
    updateSession(sessionId, {
      status: "failed",
      progress: 100,
      stageText: "❌ 检索失败",
      error: message,
    });
    return;
  }

  // ── Stage 4: Report generation + verification ───────────────────────────
  updateSession(sessionId, {
    progress: 75,
    stageText: "✍️ 生成合规报告…",
  });

  // ── Stage 5: Done — format and store result ────────────────────────────
  updateSession(sessionId, {
    progress: 90,
    stageText: "✅ 报告生成完成",
  });

  // Map rag-service status to ScanStatus format
  const statusMap: Record<string, "ready" | "failed"> = {
    PASS: "ready",
    WARN: "ready",
    REJECTED: "ready",
    UNKNOWN: "ready",
  };
  const mappedStatus = statusMap[ragResponse.status] ?? "ready";

  // Build the compliance report result in the existing ScanResult shape
  // so the result page stays compatible with existing UI.
  const complianceReport: ComplianceReportResult = {
    sessionId,
    scanTime: new Date().toISOString(),
    productCategory: category,
    productName: input.query ?? undefined,
    targetMarkets: markets,
    // For RAG mode, we use a simplified risk structure
    complianceScore: ragResponse.status === "PASS" ? 85 : ragResponse.status === "WARN" ? 55 : 25,
    scoreGrade: ragResponse.status === "PASS" ? "B" : ragResponse.status === "WARN" ? "C" : "D",
    complianceReport: ragResponse.report,
    complianceStatus: ragResponse.status,
    agentTrace: ragResponse.agent_trace,
    documents: [], // no document assets in pure RAG mode
    loopCount: ragResponse.loop_count,
    retrievedChunks: (ragResponse.documents ?? []).map((d) => ({
      regId: d.id,
      docName: d.doc_name,
      articleNo: d.article_no,
      region: d.region,
      score: d.score,
    })),
    generatedAt: new Date().toISOString(),
    modelInfo: {
      ragProvider: "cohere-anthropic",
      latencyMs: 0,
    },
  };

  updateSession(sessionId, {
    status: mappedStatus,
    progress: 100,
    stageText:
      ragResponse.status === "PASS"
        ? "✅ 合规扫描通过"
        : ragResponse.status === "WARN"
        ? "⚠️ 合规警告，请查看报告"
        : "🔴 合规风险，需关注",
    result: complianceReport as unknown as Parameters<typeof updateSession>[1]["result"],
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Extended result types for RAG compliance ─────────────────────────────────

export interface ComplianceReportResult {
  sessionId: string;
  scanTime: string;
  productCategory: ProductCategory;
  productName?: string;
  targetMarkets: Market[];
  complianceScore: number;
  scoreGrade: "A" | "B" | "C" | "D";
  /** Full markdown compliance report from Claude Sonnet */
  complianceReport: string;
  /** PASS | WARN | REJECTED */
  complianceStatus: "PASS" | "WARN" | "REJECTED" | "UNKNOWN";
  /** Agent execution trace (node name + timing per step) */
  agentTrace: Array<{ node: string; [key: string]: unknown }>;
  /** Loop count (0 = single retrieval, 1-2 = re-retrieval) */
  loopCount: number;
  /** Retrieved regulation chunks */
  retrievedChunks: Array<{
    regId: string;
    docName: string;
    articleNo: string;
    region: string;
    score: number;
  }>;
  images: never[];   // kept for ScanResult compatibility
  documents: Array<{ documentId: string; name: string; size: number; type: "pdf" | "docx" | "html"; mimeType: string; url: string }>;
  riskPoints: never[];  // RAG report uses complianceReport instead
  checklist: never[];
  generatedAt: string;
  modelInfo: { ragProvider: string; latencyMs: number };
}