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
import { createMockScanResult, createMockProfitReport } from "@/lib/mock/scan-result";
import type { Market, ProductCategory, ProfitReportResult, ComplianceReportResult, CostSummary } from "@/lib/types";
import { getTranslations } from "@/lib/i18n-server";

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL ?? "http://localhost:8001";
const RAG_SERVICE_TIMEOUT_MS = 120_000; // 2 min max for full scan

// ── Precompiled regex patterns for extractCostSummary (avoid re-compilation per line) ──
const RE_S4_HEADER = /盈亏平衡/;
const RE_S5_HEADER = /关键结论/;
const RE_S6_HEADER = /法规引用/;
const RE_S456_HEADER = /盈亏平衡|关键结论|法规引用/;
const RE_CURRENCY = /[,$]/g;
const RE_NUMERIC = /[\d.]+/;
const RE_PREMIUM_PCT = /([\d.]+)%/;
const RE_BREAKEVEN = /盈亏平衡[^：:]*[：:]\s*(.+)/;
const RE_PRICING = /定价策略[：:]\s*(.+)/;
const RE_RISKNOTE = /风险敞口说明/;
const RE_S2 = /### 二/;
const RE_STAR_WRAP = /^\*\*|\*\*$/g;

/** Parse numeric cost values from markdown table cells. */
function parseCostValue(raw: string): number {
  const cleaned = raw.replace(RE_CURRENCY, "");
  const match = cleaned.match(RE_NUMERIC);
  return match ? parseFloat(match[0]) : 0;
}

/** Extract CostSummary and extended fields from markdown profit report. */
function extractCostSummary(markdown: string): {
  barebone: CostSummary;
  compliant: CostSummary;
  keyConclusion: string;
  premiumPct: string;
  breakevenUnits: string;
  pricingStrategy: string;
  riskNote: string;
  conclusions: string;
  references: string;
  bareboneGpm: number;
  compliantGpm: number;
} {
  const lines = markdown.split("\n");

  const bareboneInit = { bom: 0, packaging: 0, cert: 0, epr: 0, logistics: 0, asp: 0, gp: 0, warranty: 0, total: 0 };
  const compliantInit = { ...bareboneInit };

  const result = {
    barebone: bareboneInit as CostSummary,
    compliant: compliantInit as CostSummary,
    keyConclusion: "",
    premiumPct: "",
    breakevenUnits: "",
    pricingStrategy: "",
    riskNote: "",
    conclusions: "",
    references: "",
    bareboneGpm: 0,
    compliantGpm: 0,
  };

  let mode: "idle" | "cost" | "revenue" = "idle";
  let inSection4 = false;
  let inSection5 = false;
  let inSection6 = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // ── Section detection ────────────────────────────────────────────────────
    if (trimmed.startsWith("### 四") || RE_S4_HEADER.test(trimmed)) {
      inSection4 = true; inSection5 = false; inSection6 = false;
    } else if (trimmed.startsWith("### 五") || RE_S5_HEADER.test(trimmed)) {
      inSection4 = false; inSection5 = true; inSection6 = false;
    } else if (trimmed.startsWith("### 六") || RE_S6_HEADER.test(trimmed)) {
      inSection4 = false; inSection5 = false; inSection6 = true;
    } else if (trimmed.startsWith("#") && !RE_S456_HEADER.test(trimmed)) {
      inSection4 = false; inSection5 = false; inSection6 = false;
    }

    // ── Section 4: 盈亏平衡分析 ─────────────────────────────────────────────
    if (inSection4 && trimmed) {
      if (/合规溢价/.test(trimmed)) {
        const m = trimmed.match(RE_PREMIUM_PCT);
        result.premiumPct = m ? `${m[1]}%` : `${parseCostValue(trimmed)}%`;
      } else if (/盈亏平衡/.test(trimmed)) {
        const m = trimmed.match(RE_BREAKEVEN);
        result.breakevenUnits = m ? m[1].trim() : trimmed;
      } else if (/定价策略/.test(trimmed)) {
        const m = trimmed.match(RE_PRICING);
        result.pricingStrategy = m ? m[1].trim() : trimmed;
      }
      continue;
    }

    // ── Section 5: 关键结论 ─────────────────────────────────────────────────
    if (inSection5 && trimmed) {
      if (result.conclusions) result.conclusions += "\n" + trimmed;
      else result.conclusions = trimmed;
      continue;
    }

    // ── Section 6: 法规引用 ────────────────────────────────────────────────
    if (inSection6 && trimmed) {
      if (result.references) result.references += "\n" + trimmed;
      else result.references = trimmed;
      continue;
    }

    // ── Markdown tables (cost & revenue) ───────────────────────────────────
    if (!trimmed.startsWith("|")) {
      mode = "idle";
      continue;
    }

    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (!cells.length) continue;

    const first = cells[0] ?? "";

    if (first.includes("---") || first === "") continue;

    if (first.includes("BOM")) {
      result.barebone.bom = parseCostValue(cells[1] ?? "");
      result.compliant.bom = parseCostValue(cells[2] ?? "");
    } else if (first === "成本项") {
      mode = "cost";
      continue;
    } else if (first === "收益项" || RE_S2.test(trimmed) || first.includes("收益对比")) {
      mode = "revenue";
      continue;
    } else if (first.includes("总直接成本") || first.includes("总成本")) {
      result.barebone.total = parseCostValue(cells[1] ?? "");
      result.compliant.total = parseCostValue(cells[2] ?? "");
      mode = "idle";
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
      } else if (first.includes("毛利率")) {
        result.bareboneGpm = parseCostValue(b);
        result.compliantGpm = parseCostValue(c);
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
        result.barebone.warranty = parseCostValue(b);
        result.compliant.warranty = parseCostValue(c);
      } else if (first.includes("物流")) {
        result.barebone.logistics = parseCostValue(b);
        result.compliant.logistics = parseCostValue(c);
      }
      continue;
    }

    // ── riskNote detection (outside tables) ──────────────────────────────────
    if (RE_RISKNOTE.test(trimmed)) {
      result.riskNote = trimmed.replace(/^[^：:]*[：:]\s*/, "").trim();
    }

    // ── keyConclusion fallback ───────────────────────────────────────────────
    if (mode === "idle" && first.startsWith("**") && !result.keyConclusion && !inSection5) {
      result.keyConclusion = first.replace(RE_STAR_WRAP, "").trim();
    }
  }

  // ── Fallback total if not found in table ─────────────────────────────────
  const computeTotal = (c: CostSummary) =>
    c.total || (c.bom + c.packaging + c.cert + c.epr + c.warranty + c.logistics);
  result.barebone.total = computeTotal(result.barebone);
  result.compliant.total = computeTotal(result.compliant);

  // ── Fallback GPM from ASP & GP ───────────────────────────────────────────
  if (result.barebone.asp > 0) {
    result.bareboneGpm = result.bareboneGpm || (result.barebone.gp / result.barebone.asp) * 100;
    result.compliantGpm = result.compliantGpm || (result.compliant.gp / result.compliant.asp) * 100;
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
  const tx = getTranslations("zh");
  const productMap: Record<ProductCategory, string> = {
    electronics: tx.categories.electronics,
    appliance: tx.categories.appliances,
    "3c": tx.categories.digital,
    toy: tx.categories.toys,
    home: tx.categories.home,
    other: tx.categories.other,
  };
  const product = productMap[category] ?? tx.categories.other;
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
  const tx = getTranslations("zh");
  const stages = tx.scanStages;

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
      result: createMockScanResult(sessionId),
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
    const controller = new AbortController();
    const profitTimeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout for profit report

    const profitResp = await fetch(`${RAG_SERVICE_URL}/profit-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: category,
        category,
        markets,
      }),
      signal: controller.signal,
    });

    clearTimeout(profitTimeout);

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
        premiumPct: extracted.premiumPct,
        breakevenUnits: extracted.breakevenUnits,
        pricingStrategy: extracted.pricingStrategy,
        riskNote: extracted.riskNote,
        conclusions: extracted.conclusions,
        references: extracted.references,
        bareboneGpm: extracted.bareboneGpm,
        compliantGpm: extracted.compliantGpm,
      };
    } else {
      // profit resp not ok — fall back to mock
      console.warn(`Profit report endpoint returned ${profitResp.status}, using mock`);
      profitReport = createMockProfitReport(sessionId);
    }
  } catch {
    // profit report failed — fall back to mock instead of leaving it undefined
    console.warn("Profit report fetch failed, using mock");
    try {
      profitReport = createMockProfitReport(sessionId);
    } catch {
      // mock generation also failed — skip, leave profitReport undefined
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
  });
}
