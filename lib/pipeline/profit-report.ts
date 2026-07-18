import type { CostSummary, GeneratedReportPackage, ProfitReportResult, ScanResult } from "@/lib/types";
import type { FinancialSummary } from "@/lib/types.blaze-hawks";

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

export function parseCostValue(raw: string): number {
  const cleaned = raw.replace(RE_CURRENCY, "");
  const match = cleaned.match(RE_NUMERIC);
  return match ? parseFloat(match[0]) : 0;
}

export function extractCostSummary(markdown: string): {
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

    if (trimmed.startsWith("### 四") || RE_S4_HEADER.test(trimmed)) {
      inSection4 = true; inSection5 = false; inSection6 = false;
    } else if (trimmed.startsWith("### 五") || RE_S5_HEADER.test(trimmed)) {
      inSection4 = false; inSection5 = true; inSection6 = false;
    } else if (trimmed.startsWith("### 六") || RE_S6_HEADER.test(trimmed)) {
      inSection4 = false; inSection5 = false; inSection6 = true;
    } else if (trimmed.startsWith("#") && !RE_S456_HEADER.test(trimmed)) {
      inSection4 = false; inSection5 = false; inSection6 = false;
    }

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

    if (inSection5 && trimmed) {
      result.conclusions = result.conclusions ? `${result.conclusions}\n${trimmed}` : trimmed;
      continue;
    }

    if (inSection6 && trimmed) {
      result.references = result.references ? `${result.references}\n${trimmed}` : trimmed;
      continue;
    }

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

    if (RE_RISKNOTE.test(trimmed)) {
      result.riskNote = trimmed.replace(/^[^：:]*[：:]\s*/, "").trim();
    }

    if (mode === "idle" && first.startsWith("**") && !result.keyConclusion && !inSection5) {
      result.keyConclusion = first.replace(RE_STAR_WRAP, "").trim();
    }
  }

  const computeTotal = (c: CostSummary) =>
    c.total || (c.bom + c.packaging + c.cert + c.epr + c.warranty + c.logistics);
  result.barebone.total = computeTotal(result.barebone);
  result.compliant.total = computeTotal(result.compliant);

  if (result.barebone.asp > 0) {
    result.bareboneGpm = result.bareboneGpm || (result.barebone.gp / result.barebone.asp) * 100;
    result.compliantGpm = result.compliantGpm || (result.compliant.gp / result.compliant.asp) * 100;
  }

  return result;
}

/**
 * Apply optional `structuredFields` from the RAG `profitReport` payload.
 * When present, these override the values extracted by regex from the
 * markdown. The RAG generator does not yet emit structuredFields
 * (P0-15, see docs/MOCK-REAL-MAPPING.md §5), but the contract is in
 * place so the frontend can adopt it without a breaking change.
 *
 * Expected shape (free-form, validated by `isStructuredProfitFields`):
 *   {
 *     costComparison: {
 *       barebone: Partial<CostSummary>,
 *       compliant: Partial<CostSummary>,
 *     },
 *     breakeven: { units: string | number, currency?: string },
 *     pricing:   { strategy?: string, premiumPct?: string },
 *     risk:      { bareboneExposure?: number, compliantExposure?: number },
 *   }
 */
export interface StructuredProfitFields {
  costComparison?: {
    barebone?: Partial<CostSummary>;
    compliant?: Partial<CostSummary>;
  };
  breakeven?: { units?: string | number; currency?: string };
  pricing?: { strategy?: string; premiumPct?: string };
  risk?: { bareboneExposure?: number; compliantExposure?: number };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isStructuredProfitFields(v: unknown): v is StructuredProfitFields {
  return isRecord(v);
}

function numFromStringOrNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[, $¥€£]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function applyStructuredProfitFields(
  base: ProfitReportResult,
  fields: StructuredProfitFields | undefined,
): ProfitReportResult {
  if (!fields) return base;

  const cc = fields.costComparison;
  const barebone = cc?.barebone ? { ...base.barebone, ...cc.barebone } : base.barebone;
  const compliant = cc?.compliant ? { ...base.compliant, ...cc.compliant } : base.compliant;

  const breakevenUnits =
    fields.breakeven?.units !== undefined
      ? String(fields.breakeven.units)
      : base.breakevenUnits;
  const pricingStrategy = fields.pricing?.strategy ?? base.pricingStrategy;
  const premiumPct = fields.pricing?.premiumPct ?? base.premiumPct;
  const bareboneRiskExposure =
    fields.risk?.bareboneExposure ?? base.bareboneRiskExposure;
  const compliantRiskExposure =
    fields.risk?.compliantExposure ?? base.compliantRiskExposure;

  return {
    ...base,
    barebone,
    compliant,
    breakevenUnits,
    pricingStrategy,
    premiumPct,
    bareboneRiskExposure,
    compliantRiskExposure,
  };
}

export function buildProfitReportFromMarkdown(
  sessionId: string,
  markdown: string,
  productType: string,
  market: string,
  overrides?: GeneratedReportPackage["profitReport"]
): ProfitReportResult {
  const extracted = extractCostSummary(markdown);
  const base: ProfitReportResult = {
    sessionId,
    productType,
    market,
    report: markdown,
    barebone: extracted.barebone,
    compliant: extracted.compliant,
    bareboneRiskExposure: extracted.barebone.asp > 0 ? extracted.barebone.asp * 100 : 0,
    compliantRiskExposure: extracted.compliant.asp > 0 ? extracted.compliant.asp * 5 : 0,
    keyConclusion: overrides?.keyConclusion || extracted.keyConclusion,
    generatedAt: new Date().toISOString(),
    premiumPct: overrides?.premiumPct || extracted.premiumPct,
    breakevenUnits: overrides?.breakevenUnits || extracted.breakevenUnits,
    pricingStrategy: overrides?.pricingStrategy || extracted.pricingStrategy,
    riskNote: overrides?.riskNote || extracted.riskNote,
    conclusions: overrides?.conclusions || extracted.conclusions,
    references: overrides?.references || extracted.references,
    bareboneGpm: extracted.bareboneGpm,
    compliantGpm: extracted.compliantGpm,
  };
  return applyStructuredProfitFields(base, overrides?.structuredFields);
}

/**
 * 把客户端拿到的 ScanResult(可能是 demo 或真实扫描)适配成下游 PDF/DOCX 导出器
 * 需要的完整 ProfitReportResult。
 *
 * 数据源优先级(在 ProfitExportPanel / ResultExportButton 里用):
 *   1. `result.reportPackage.profitReport.markdown` (走 buildProfitReportFromMarkdown
 *      反推成完整结构,后端真实扫描时给)
 *   2. `result.financialSummary` + `costBreakdown` (handoff 设计稿 demo 数据)
 *   3. 都缺 → 返回 null(调用方应禁用下载按钮)
 *
 * 注: `result.profitReport`(完整 ProfitReportResult) 是在 `ScanStatus` 顶层,
 * 不是 ScanResult 字段,所以这里不看。
 */
export function buildProfitReportFromScanResult(
  result: ScanResult,
  locale: "zh" | "en" = "zh",
): ProfitReportResult | null {
  // 1) Markdown + 字段覆盖
  const rpOverrides = result.reportPackage?.profitReport;
  if (rpOverrides?.markdown) {
    return buildProfitReportFromMarkdown(
      result.sessionId,
      rpOverrides.markdown,
      result.productName ?? (locale === "zh" ? "产品" : "Product"),
      result.targetMarkets[0] ?? (locale === "zh" ? "目标市场" : "Target market"),
      rpOverrides,
    );
  }

  // 2) FinancialSummary(只有字符串 amount,转 CostSummary 全 0 兜底)
  if (result.financialSummary) {
    return buildProfitReportFromFinancialSummary(
      result.sessionId,
      result.financialSummary,
      result.productName ?? (locale === "zh" ? "产品" : "Product"),
      result.targetMarkets[0] ?? (locale === "zh" ? "目标市场" : "Target market"),
    );
  }

  return null;
}

/**
 * 把 handoff 设计稿页的 `FinancialSummary` (字符串金额) 兜底成 `ProfitReportResult`。
 *
 * FinancialSummary 的 amount 字段是 "¥0.71" / "$7.46" 这种格式 — `parseCostValue` 已经在
 * 本文件定义,可复用。它只覆盖 `barebone` / `compliant` 成本项里能从 costBreakdown
 * 标签匹配上的部分(BOM / 包装 / 认证 / EPR / 物流 / 保修 / 总直接成本)。匹配不上
 * 的字段保持 0,但 PDF 仍能生成,只是部分数字显示为 0。
 */
function buildProfitReportFromFinancialSummary(
  sessionId: string,
  summary: FinancialSummary,
  productType: string,
  market: string,
): ProfitReportResult {
  const lookup = (key: RegExp, fallback = 0): number => {
    const row = summary.costBreakdown.find((c) => key.test(c.label) || key.test(c.labelEn ?? ""));
    if (!row) return fallback;
    return parseCostValue(row.amount);
  };
  const barebone: CostSummary = {
    bom: lookup(/BOM|material|材料/i),
    packaging: lookup(/packag|包装/i),
    cert: lookup(/cert|认证/i),
    epr: lookup(/EPR|环保/i),
    logistics: lookup(/logistic|物流/i),
    asp: lookup(/ASP|price|售价/i),
    gp: lookup(/heroic|神勇|hero/i, lookup(/BOM/i)),
    warranty: lookup(/warranty|保修|after.?sales|售后/i),
    total: lookup(/total|总直接成本/i),
  };
  // "compliant" 列在 FinancialSummary 里没有单独字段,粗略用 barebone + 1.3x 当
  // 占位(模拟合规后成本上扬)。用户可读即可,不是核心数据。
  const compliant: CostSummary = {
    ...barebone,
    cert: barebone.cert > 0 ? barebone.cert : 12,
    epr: barebone.epr > 0 ? barebone.epr : 4,
    warranty: barebone.warranty > 0 ? barebone.warranty : 3,
    total: barebone.total > 0 ? barebone.total * 1.3 : 0,
  };
  const heroNum = parseCostValue(summary.estimatedHeroicProfit);
  const netNum = parseCostValue(summary.trueNetProfit);
  const complianceNum = parseCostValue(summary.complianceCost);
  return {
    sessionId,
    productType,
    market,
    currency: "USD",
    report: "",
    barebone,
    compliant,
    bareboneRiskExposure: heroNum,
    compliantRiskExposure: 0,
    keyConclusion: summary.targetVolumeLabel,
    generatedAt: new Date().toISOString(),
    premiumPct: heroNum > 0 && netNum > 0 ? `${Math.round((1 - netNum / heroNum) * 100)}%` : "—",
    breakevenUnits: "—",
    pricingStrategy: summary.monthlyNetProfit,
    riskNote: summary.riskExposureItems.join("; "),
    conclusions: "",
    references: "",
    bareboneGpm: barebone.asp > 0 ? (barebone.gp / barebone.asp) * 100 : 0,
    compliantGpm: compliant.asp > 0 ? (compliant.gp / compliant.asp) * 100 : 0,
  };
}
