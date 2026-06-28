/**
 * runScan.ts — Real scan pipeline that calls the rag-service Agentic RAG backend.
 *
 * Flow:
 * 1. Parse images for Vision AI context (basic product info extraction)
 * 2. POST scan request to rag-service (RAG_SERVICE_URL env, default localhost:8001)
 * 3. Poll session until ready
 * 4. Update session store with full report + agent_trace
 *
 * Fallback: if rag-service is unreachable, degrades to mock result so the
 * user still sees a valid report instead of a generic error.
 */
import { z } from "zod";
import { updateSession } from "@/lib/pipeline/session-store";
import { logUserActivity } from "@/lib/pipeline/upload-storage";
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

const RagServiceResponseSchema = z.object({
  status: z.enum(["PASS", "WARN", "REJECTED", "UNKNOWN"]),
  report: z.string(),
  agent_trace: z.array(z.record(z.string(), z.unknown())),
  loop_count: z.number(),
  documents: z
    .array(
      z
        .object({
          id: z.string(),
          doc_name: z.string().nullish(),
          article_no: z.string().nullish(),
          region: z.string().nullish(),
          score: z.number().nullish(),
        })
        .passthrough()
    )
    .optional(),
  report_package: z.unknown().optional(),
  reportPackage: z.unknown().optional(),
});

const ProfitReportResponseSchema = z.object({
  status: z.string(),
  report: z.string(),
  product: z.string().optional(),
  market: z.string().optional(),
});

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

      // Shared-secret auth: when RAG_INTERNAL_SECRET is configured (matches
      // the same-named env on the RAG service), send the X-Internal-Secret
      // header so the RAG service authorizes the write. Unset → header
      // omitted, RAG service stays in open (local/dev) mode.
      const internalSecret = process.env.RAG_INTERNAL_SECRET;
      const scanHeaders: Record<string, string> = {};
      if (internalSecret) {
        scanHeaders["X-Internal-Secret"] = internalSecret;
      }

      resp = await fetch(`${RAG_SERVICE_URL}/scan-multipart`, {
        method: "POST",
        body: formData,
        headers: scanHeaders,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      // Normalize to a stable code so downstream consumers (and tests) can
      // pattern-match on RAG_SERVICE_UNAVAILABLE without leaking the upstream
      // HTTP status. The original status is preserved in the error detail.
      throw new Error(`RAG_SERVICE_UNAVAILABLE: HTTP ${resp.status}`);
    }

    const parsed = RagServiceResponseSchema.safeParse(await resp.json());
    if (!parsed.success) {
      throw new Error(`RAG_SERVICE_INVALID_RESPONSE: ${parsed.error.message}`);
    }
    ragResponse = parsed.data as RagServiceResponse;
  } catch (err: unknown) {
    // rag-service unavailable — degrade gracefully to mock. IMPORTANT: we mark
    // the session `degraded` (NOT `ready`) so downstream UI can distinguish a
    // real pass from a fallback. The result field is still populated with demo
    // data so the page renders something, but `result.source === "fallback"`
    // and `degradedReason` carries the error code.
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const detail = err instanceof Error ? err.message : String(err);
    const errorCode = isTimeout
      ? "RAG_SERVICE_TIMEOUT"
      : detail.startsWith("RAG_SERVICE_")
        ? detail.split(":")[0]
        : "RAG_SERVICE_UNAVAILABLE";
    console.error(`[scan ${sessionId}] rag-service call failed: ${detail}`);
    updateSession(sessionId, {
      progress: 70,
      stageText: isTimeout ? stages.backendTimeout : stages.backendUnavailable,
    });
    updateSession(sessionId, {
      status: "degraded",
      degradedReason: errorCode,
      progress: 100,
      stageText: stages.demoResultGenerated,
      result: { ...createMockComplianceReportResult(sessionId), source: "fallback" },
      profitReport: createMockProfitReport(sessionId),
      profitReports: createMockProfitReports(sessionId),
      error: errorCode,
    });
    logUserActivity({
      ts: new Date().toISOString(),
      event: "scan_completed",
      sessionId,
      status: "degraded",
      error: errorCode,
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

  // Pull a real compliance score out of the audit metadata if the RAG backend
  // provided one; otherwise fall back to a status-derived heuristic. The
  // heuristic is NOT the model's actual judgment — callers must not treat it
  // as a calibrated score (see reportPackage.auditMetadata for ground truth).
  const auditMeta = reportPackage?.auditMetadata as Record<string, unknown> | undefined;
  const rawScore =
    typeof auditMeta?.complianceScore === "number"
      ? auditMeta.complianceScore
      : typeof auditMeta?.compliance_score === "number"
        ? auditMeta.compliance_score
        : undefined;
  const rawGrade =
    typeof auditMeta?.scoreGrade === "string"
      ? auditMeta.scoreGrade
      : typeof auditMeta?.score_grade === "string"
        ? auditMeta.score_grade
        : undefined;
  const isGrade = (v: unknown): v is "A" | "B" | "C" | "D" =>
    v === "A" || v === "B" || v === "C" || v === "D";
  // Heuristic fallback — clearly marked; real score comes from RAG auditMetadata.
  const heuristicScore =
    ragResponse.status === "PASS" ? 85 : ragResponse.status === "WARN" ? 55 : 25;
  const heuristicGrade =
    ragResponse.status === "PASS" ? "B" : ragResponse.status === "WARN" ? "C" : "D";
  const complianceScore = rawScore ?? heuristicScore;
  const scoreGrade = isGrade(rawGrade) ? rawGrade : heuristicGrade;

  const complianceReport: ComplianceReportResult = {
    sessionId,
    scanTime: new Date().toISOString(),
    productCategory: category,
    productName: input.query,
    targetMarkets: markets,
    complianceScore,
    scoreGrade,
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
    // ragProvider reflects the actual LLM in use (MiniMax-M3 via Anthropic-
    // compatible endpoint). latencyMs is taken from auditMetadata when present;
    // 0 is a placeholder, not a real measurement.
    modelInfo: {
      ragProvider: "MiniMax-M3",
      latencyMs:
        typeof auditMeta?.latencyMs === "number"
          ? auditMeta.latencyMs
          : typeof auditMeta?.latency_ms === "number"
            ? auditMeta.latency_ms
            : 0,
    },
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
        const profitHeaders: Record<string, string> = {
          "Content-Type": "application/json",
        };
        // Same shared-secret mechanism as the /scan-multipart call above.
        const internalSecret = process.env.RAG_INTERNAL_SECRET;
        if (internalSecret) {
          profitHeaders["X-Internal-Secret"] = internalSecret;
        }
        profitResp = await fetch(`${RAG_SERVICE_URL}/profit-report`, {
          method: "POST",
          headers: profitHeaders,
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
        const rawParsed = ProfitReportResponseSchema.safeParse(await profitResp.json());
        if (!rawParsed.success) {
          console.warn(`Profit report response invalid: ${rawParsed.error.message}, using mock`);
          profitReport = createMockProfitReport(sessionId);
          profitReports = createMockProfitReports(sessionId);
        } else {
          const raw = rawParsed.data;
          profitReport = buildProfitReportFromMarkdown(
            sessionId,
            raw.report,
            raw.product || category,
            raw.market || markets[0] || "EU"
          );
          profitReports = [profitReport];
        }
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
  logUserActivity({
    ts: new Date().toISOString(),
    event: "scan_completed",
    sessionId,
    status: statusMap[ragResponse.status] ?? "ready",
  });
}
