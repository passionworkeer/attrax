/**
 * runScan.ts — Real scan pipeline that calls the rag-service Agentic RAG backend.
 *
 * Flow:
 * 1. Parse images for Vision AI context (basic product info extraction)
 * 2. POST scan request to rag-service (localhost:8000)
 * 3. Poll session until ready
 * 4. Update session store with full report + agent_trace
 *
 * Fallback: if rag-service is unreachable, degrades to mock result so the
 * user still sees a valid report instead of a generic error.
 */
import { updateSession } from "@/lib/pipeline/session-store";
import { createMockScanResult } from "@/lib/mock/scan-result";
import type { Market, ProductCategory, ProfitReportResult, ComplianceReportResult, CostSummary } from "@/lib/types";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
const RAG_SERVICE_TIMEOUT_MS = 120_000; // 2 min max for full scan

/** Parse numeric cost values from markdown table cells. */
function parseCostValue(raw: string): number {
  const match = raw.replace(/[,$]/g, "").match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 0;
}

/** Extract CostSummary from markdown profit report tables. */
function extractCostSummary(markdown: string): { barebone: CostSummary; compliant: CostSummary; keyConclusion: string } {
  const lines = markdown.split("\n");

  const result = {
    barebone: { bom: 0, packaging: 0, cert: 0, epr: 0, logistics: 0, asp: 0, gp: 0 } as CostSummary,
    compliant: { bom: 0, packaging: 0, cert: 0, epr: 0, logistics: 0, asp: 0, gp: 0 } as CostSummary,
    keyConclusion: "",
  };

  let mode: "idle" | "cost" | "revenue" = "idle";

  for (const line of lines) {
    if (!line.startsWith("|")) {
      mode = "idle";
      continue;
    }

    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;

    const first = cells[0] ?? "";

    // BOM check must come before "成本" to avoid overshadowing
    if (first.includes("BOM")) {
      result.barebone.bom = parseCostValue(cells[1] ?? "");
      result.compliant.bom = parseCostValue(cells[2] ?? "");
    } else if (first === "收益项" || first.includes("收益")) {
      mode = "revenue";
      continue;
    } else if (first === "成本项") {
      mode = "cost";
      continue;
    } else if (first.includes("---") || !first) {
      continue;
    }

    if (mode === "revenue") {
      const b = cells[1] ?? "";
      const c = cells[2] ?? "";
      if (first.includes("平均售价") || first.includes("ASP")) {
        result.barebone.asp = parseCostValue(b);
        result.compliant.asp = parseCostValue(c);
      } else if (first.includes("毛利润") && first.includes("单台")) {
        result.barebone.gp = parseCostValue(b);
        result.compliant.gp = parseCostValue(c);
      }
      continue;
    }

    if (mode === "cost") {
      const b = cells[1] ?? "";
      const c = cells[2] ?? "";
      if (first.includes("包装")) {
        result.barebone.packaging = parseCostValue(b);
        result.compliant.packaging = parseCostValue(c);
      } else if (first.includes("认证")) {
        result.barebone.cert = parseCostValue(b);
        result.compliant.cert = parseCostValue(c);
      } else if (first.includes("EPR")) {
        result.barebone.epr = parseCostValue(b);
        result.compliant.epr = parseCostValue(c);
      } else if (first.includes("售后") || first.includes("保修") || first.includes("预留")) {
        result.barebone.gp = parseCostValue(b);
        result.compliant.gp = parseCostValue(c);
      } else if (first.includes("物流")) {
        result.barebone.logistics = parseCostValue(b);
        result.compliant.logistics = parseCostValue(c);
      }

      if (first.includes("总直接成本") || first.includes("总成本")) {
        mode = "idle";
      }
      continue;
    }

    if (mode === "idle" && first.startsWith("**") && !result.keyConclusion) {
      result.keyConclusion = first.replace(/^\*\*|\*\*$/g, "").trim();
    }
  }

  return result;
}

export interface RunScanInput {
  images: Array<{
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  }>;
  documents?: Array<{
    name: string;
    mimeType: string;
    text: string;
  }>;
  pdfs?: Array<{
    name: string;
    buffer: string; // base64
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

/**
 * Main scan function — runs the full Agentic RAG pipeline via HTTP.
 * Updates session store incrementally so the burning page shows progress.
 *
 * If rag-service is unavailable, degrades gracefully to mock data so the
 * end-to-end user flow still works.
 */
export async function runScan(sessionId: string, input: RunScanInput) {
  const { images, documents, pdfs, category, markets } = input;
  const query = input.query ?? buildQuery(images, category, markets);

  // ── Stage 1: Vision analysis ──────────────────────────────────────────────
  updateSession(sessionId, {
    progress: 10,
    stageText: "🔍 分析上传图片…",
  });

  // ── Stage 2: Query planning + retrieval ──────────────────────────────────
  updateSession(sessionId, {
    progress: 30,
    stageText: "🧠 规划检索策略…",
  });

  // ── Stage 3: RAG service call ────────────────────────────────────────────
  updateSession(sessionId, {
    progress: 45,
    stageText: "📚 检索合规法规库…",
  });

  let ragResponse: RagServiceResponse | null = null;

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
        images: images.map((img) => ({
          buffer: img.buffer.toString("base64"),
          mime_type: img.mimeType,
          name: img.originalName,
        })),
        documents: documents ?? [],
        pdfs: pdfs ?? [],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "Unknown error");
      throw new Error(`RAG service returned ${resp.status}: ${errorText}`);
    }

    ragResponse = (await resp.json()) as RagServiceResponse;
  } catch {
    // rag-service unavailable — degrade gracefully to mock
    updateSession(sessionId, {
      progress: 70,
      stageText: "⚠️ 后端服务不可用，降级到演示模式…",
    });
    updateSession(sessionId, {
      status: "ready",
      progress: 100,
      stageText: "✅ 演示结果已生成",
      result: createMockScanResult(sessionId),
    });
    return;
  }

  // ── Stage 4: Report generation + verification ────────────────────────────
  updateSession(sessionId, {
    progress: 75,
    stageText: "✍️ 生成合规报告…",
  });

  // ── Stage 5: Done — format and store result ─────────────────────────────
  updateSession(sessionId, {
    progress: 90,
    stageText: "✅ 报告生成完成",
  });

  const statusMap: Record<string, "ready" | "failed"> = {
    PASS: "ready",
    WARN: "ready",
    REJECTED: "ready",
    UNKNOWN: "ready",
  };

  const complianceReport: ComplianceReportResult = {
    sessionId,
    scanTime: new Date().toISOString(),
    productCategory: category,
    productName: input.query,
    targetMarkets: markets,
    complianceScore:
      ragResponse.status === "PASS" ? 85 : ragResponse.status === "WARN" ? 55 : 25,
    scoreGrade:
      ragResponse.status === "PASS" ? "B" : ragResponse.status === "WARN" ? "C" : "D",
    complianceReport: ragResponse.report,
    complianceStatus: ragResponse.status,
    agentTrace: ragResponse.agent_trace,
    loopCount: ragResponse.loop_count,
    retrievedChunks: (ragResponse.documents ?? []).map((d) => ({
      regId: d.id,
      docName: d.doc_name,
      articleNo: d.article_no,
      region: d.region,
      score: d.score,
    })),
    images: undefined,
    documents: [],
    riskPoints: undefined,
    checklist: undefined,
    generatedAt: new Date().toISOString(),
    modelInfo: { ragProvider: "mimotalk", latencyMs: 0 },
  };

  // ── Stage 5: Fetch profit report (best-effort, does not block main flow) ──
  let profitReport: ProfitReportResult | undefined;

  try {
    const profitResp = await fetch(`${RAG_SERVICE_URL}/profit-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: category,
        category,
        markets,
      }),
    });
    if (profitResp.ok) {
      const raw = (await profitResp.json()) as { status: string; report: string; product: string; market: string };
      const extracted = extractCostSummary(raw.report);
      profitReport = {
        sessionId,
        productType: raw.product || category,
        market: raw.market || markets[0] || "EU",
        report: raw.report,
        barebone: extracted.barebone,
        compliant: extracted.compliant,
        bareboneRiskExposure: extracted.barebone.asp > 0 ? extracted.barebone.asp * 100 : 0,
        compliantRiskExposure: extracted.compliant.asp > 0 ? extracted.compliant.asp * 5 : 0,
        keyConclusion: extracted.keyConclusion,
        generatedAt: new Date().toISOString(),
      };
    } else {
      // profit resp not ok — skip, keep profitReport undefined
    }
  } catch {
    // profit report is best-effort — do not block the main flow
  }

  updateSession(sessionId, {
    status: statusMap[ragResponse.status] ?? "ready",
    progress: 100,
    stageText:
      ragResponse.status === "PASS"
        ? "✅ 合规扫描通过"
        : ragResponse.status === "WARN"
        ? "⚠️ 合规警告，请查看报告"
        : "🔴 合规风险，需关注",
    result: complianceReport as Parameters<typeof updateSession>[1]["result"],
    profitReport,
  });
  
  }
