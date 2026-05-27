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
import {
  createMockComplianceReportResult,
  createMockProfitReport,
  createMockProfitReports,
} from "@/lib/mock/scan-result";
import { RAG_SERVICE_TIMEOUT_MS, PROFIT_REPORT_TIMEOUT_MS } from "@/lib/constants";
import { buildProfitReportFromMarkdown } from "@/lib/pipeline/profit-report";
import { normalizeReportPackage } from "@/lib/pipeline/report-package";
import type {
  Market,
  ProductCategory,
  ComplianceReportResult,
  GeneratedReportPackage,
  ProfitReportResult,
} from "@/lib/types";
import { serverT } from "@/lib/server-i18n";

function getRagServiceUrl(): string {
  const value = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("RAG_SERVICE_URL must use http or https");
  }
  return url.origin;
}

const RAG_SERVICE_URL = getRagServiceUrl();

export { extractCostSummary, parseCostValue } from "@/lib/pipeline/profit-report";
export { normalizeReportPackage } from "@/lib/pipeline/report-package";

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
    buffer: Buffer;
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
  report_package?: GeneratedReportPackage;
  reportPackage?: GeneratedReportPackage;
}

/** Build a query string from images + category + markets. */
function buildQuery(
  images: RunScanInput["images"],
  category: ProductCategory,
  markets: Market[]
): string {
  const productMap: Record<ProductCategory, string> = {
    electronics: serverT("categories.electronics", "zh"),
    appliance: serverT("categories.appliance", "zh"),
    "3c": serverT("categories.digital", "zh"),
    toy: serverT("categories.toy", "zh"),
    home: serverT("categories.home", "zh"),
    other: serverT("categories.other", "zh"),
  };
  const product = productMap[category] ?? serverT("categories.other", "zh");
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
  const stages = {
    analyzingImages: serverT("scanStages.analyzingImages", "zh"),
    planningStrategy: serverT("scanStages.planningStrategy", "zh"),
    retrievingRegulations: serverT("scanStages.retrievingRegulations", "zh"),
    generatingReport: serverT("scanStages.generatingReport", "zh"),
    reportComplete: serverT("scanStages.reportComplete", "zh"),
    backendTimeout: serverT("scanStages.backendTimeout", "zh"),
    backendUnavailable: serverT("scanStages.backendUnavailable", "zh"),
    demoResultGenerated: serverT("scanStages.demoResultGenerated", "zh"),
    scanPassed: serverT("scanStages.scanPassed", "zh"),
    scanWarning: serverT("scanStages.scanWarning", "zh"),
    scanRisk: serverT("scanStages.scanRisk", "zh"),
  };

  // ── Stage 1: Vision analysis ──────────────────────────────────────────────
  updateSession(sessionId, {
    progress: 10,
    stageText: `🔍 ${stages.analyzingImages}…`,
  });

  // ── Stage 2: Query planning + retrieval ──────────────────────────────────
  updateSession(sessionId, {
    progress: 30,
    stageText: `🧠 ${stages.planningStrategy}…`,
  });

  // ── Stage 3: RAG service call ────────────────────────────────────────────
  updateSession(sessionId, {
    progress: 45,
    stageText: `📚 ${stages.retrievingRegulations}…`,
  });

  let ragResponse: RagServiceResponse | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RAG_SERVICE_TIMEOUT_MS);
    let resp: Response;

    try {
      const formData = new FormData();
      formData.set("query", query);
      formData.set("product", category);
      formData.set("category", category);
      formData.set("markets", JSON.stringify(markets));
      formData.set("documents", JSON.stringify(documents ?? []));
      images.forEach((img) => {
        formData.append(
          "images",
          new Blob([new Uint8Array(img.buffer)], { type: img.mimeType }),
          img.originalName
        );
      });
      (pdfs ?? []).forEach((pdf) => {
        formData.append(
          "pdfs",
          new Blob([new Uint8Array(pdf.buffer)], { type: pdf.mimeType }),
          pdf.name
        );
      });

      resp = await fetch(`${RAG_SERVICE_URL}/scan-multipart`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      throw new Error(`RAG_SERVICE_HTTP_${resp.status}`);
    }

    ragResponse = (await resp.json()) as RagServiceResponse;
  } catch (err: unknown) {
    // rag-service unavailable — degrade gracefully to mock
    const isTimeout = err instanceof Error && err.name === "AbortError";
    updateSession(sessionId, {
      progress: 70,
      stageText: isTimeout ? stages.backendTimeout : stages.backendUnavailable,
    });
    updateSession(sessionId, {
      status: "ready",
      progress: 100,
      stageText: stages.demoResultGenerated,
      result: { ...createMockComplianceReportResult(sessionId), source: "fallback" },
      profitReport: createMockProfitReport(sessionId),
      profitReports: createMockProfitReports(sessionId),
      error: isTimeout ? "RAG_SERVICE_TIMEOUT" : "RAG_SERVICE_UNAVAILABLE",
    });
    return;
  }

  // ── Stage 4: Report generation + verification ────────────────────────────
  updateSession(sessionId, {
    progress: 75,
    stageText: `✍️ ${stages.generatingReport}…`,
  });

  // ── Stage 5: Done — format and store result ─────────────────────────────
  updateSession(sessionId, {
    progress: 90,
    stageText: `✅ ${stages.reportComplete}`,
  });

  const statusMap: Record<string, "ready" | "failed"> = {
    PASS: "ready",
    WARN: "ready",
    REJECTED: "ready",
    UNKNOWN: "ready",
  };
  const reportPackage = normalizeReportPackage(ragResponse.report_package ?? ragResponse.reportPackage);
  const packageComplianceReport =
    typeof reportPackage?.complianceReport === "string" && reportPackage.complianceReport.trim()
      ? reportPackage.complianceReport
      : undefined;
  const packageComplianceReportEn =
    typeof reportPackage?.complianceReportEn === "string" && reportPackage.complianceReportEn.trim()
      ? reportPackage.complianceReportEn
      : typeof reportPackage?.compliance_report_en === "string" && reportPackage.compliance_report_en.trim()
      ? reportPackage.compliance_report_en
      : undefined;

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
    complianceReport: packageComplianceReport ?? ragResponse.report,
    complianceReportEn: packageComplianceReportEn,
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
    modelInfo: { ragProvider: "cohere-anthropic", latencyMs: 0 },
    source: "real",
    reportPackage,
  };

  // ── Stage 5: Profit report (included in new report package, legacy fallback otherwise) ──
  let profitReport: ProfitReportResult | undefined;
  let profitReports: ProfitReportResult[] | undefined;
  const packageProfitMarkdown = reportPackage?.profitReport?.markdown;

  if (typeof packageProfitMarkdown === "string" && packageProfitMarkdown.trim()) {
    profitReport = buildProfitReportFromMarkdown(
      sessionId,
      packageProfitMarkdown,
      category,
      markets[0] || "EU",
      reportPackage?.profitReport
    );
    profitReports = [profitReport];
  } else {
    try {
      const controller = new AbortController();
      const profitTimeout = setTimeout(() => controller.abort(), PROFIT_REPORT_TIMEOUT_MS);
      let profitResp: Response;

      try {
        profitResp = await fetch(`${RAG_SERVICE_URL}/profit-report`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product: category,
            category,
            markets,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(profitTimeout);
      }

      if (profitResp.ok) {
        const raw = (await profitResp.json()) as { status: string; report: string; product: string; market: string };
        profitReport = buildProfitReportFromMarkdown(
          sessionId,
          raw.report,
          raw.product || category,
          raw.market || markets[0] || "EU"
        );
        profitReports = [profitReport];
      } else {
        // profit resp not ok — fall back to mock
        console.warn(`Profit report endpoint returned ${profitResp.status}, using mock`);
        profitReport = createMockProfitReport(sessionId);
        profitReports = createMockProfitReports(sessionId);
      }
    } catch {
      // profit report failed — fall back to mock instead of leaving it undefined
      console.warn("Profit report fetch failed, using mock");
      try {
        profitReport = createMockProfitReport(sessionId);
        profitReports = createMockProfitReports(sessionId);
      } catch {
        // mock generation also failed — skip, leave profitReport undefined
      }
    }
  }

  updateSession(sessionId, {
    status: statusMap[ragResponse.status] ?? "ready",
    progress: 100,
    stageText:
      ragResponse.status === "PASS"
        ? stages.scanPassed
        : ragResponse.status === "WARN"
        ? stages.scanWarning
        : stages.scanRisk,
    result: complianceReport as Parameters<typeof updateSession>[1]["result"],
    profitReport,
    profitReports,
  });
}
