import type { CostSummary, GeneratedReportPackage, ProfitReportResult, ScanResult } from "@/lib/types";
import type { FinancialSummary } from "@/lib/types.blaze-hawks";
import {
  buildProfitRenderModel,
  type ProfitRenderModel,
} from "@/lib/report-export-modules/profit-render-model";

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
  currency?: string;
  costComparison?: {
    barebone?: Partial<CostSummary>;
    compliant?: Partial<CostSummary>;
  };
  breakeven?: { units?: string | number; currency?: string };
  pricing?: { strategy?: string; premiumPct?: string };
  risk?: { bareboneExposure?: number; compliantExposure?: number };
  /**
   * Plan 2026-09-13 §10.2 — provenance. "quoted" means a real source backs
   * the numbers (supplier list, uploaded doc); "estimated" marks model
   * guesses; "unknown" is the legacy default. The synthesizer renders
   * non-quoted values with an 估算 marker so they can't read as quotes.
   */
  sourceStatus?: "quoted" | "estimated" | "unknown";
  asOf?: string;
  sourceRefs?: string[];
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

const FINANCE_TOLERANCE = 0.01;
const FINANCE_COST_KEYS = ["bom", "packaging", "cert", "epr", "logistics", "warranty", "asp", "total", "gp"] as const;
// Audit 2026-09-13 §10.2: gp is a profit, not a cost — it may legitimately
// be negative (selling at a loss). Mirrors the backend Pydantic split.
const FINANCE_PROFIT_KEYS = new Set(["gp"]);

type CompleteCostSummary = CostSummary;

function isCompleteCostSummary(value: unknown): value is CompleteCostSummary {
  if (!isRecord(value)) return false;
  for (const key of FINANCE_COST_KEYS) {
    const amount = value[key];
    if (typeof amount !== "number" || !Number.isFinite(amount)) return false;
    if (amount < 0 && !FINANCE_PROFIT_KEYS.has(key)) return false;
  }
  const summary = value as unknown as CompleteCostSummary;
  return Math.abs((summary.asp - summary.total) - summary.gp) <= FINANCE_TOLERANCE;
}

function currencySymbol(currency: string): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  return "¥";
}

function formatCurrency(value: number, currency: string): string {
  return `${currencySymbol(currency)}${value.toFixed(2)}`;
}

function financeRowsFromCostSummary(cost: CompleteCostSummary, currency: string, locale: "zh" | "en") {
  const isEnglish = locale === "en";
  const label = (zh: string, en: string) => (isEnglish ? en : zh);
  const known = cost.bom + cost.packaging + cost.cert + cost.epr + cost.logistics + cost.warranty;
  const residual = cost.total - known;
  if (residual < -FINANCE_TOLERANCE) return null;
  const amount = (n: number) => formatCurrency(n, currency);
  return [
    { itemId: "bom", label: label("采购 BOM", "Procurement BOM"), labelEn: "Procurement BOM", amount: amount(cost.bom), detail: label("后端已验证的物料成本", "Validated materials cost"), detailEn: "Validated materials cost" },
    { itemId: "packaging", label: label("包装与标签", "Packaging and labels"), labelEn: "Packaging and labels", amount: amount(cost.packaging), detail: label("后端已验证的包装与标签成本", "Validated packaging and label cost"), detailEn: "Validated packaging and label cost" },
    { itemId: "compliance", label: label("认证与 EPR", "Certification and EPR"), labelEn: "Certification and EPR", amount: amount(cost.cert + cost.epr), detail: label("后端已验证的认证和生产者责任成本", "Validated certification and producer-responsibility cost"), detailEn: "Validated certification and producer-responsibility cost" },
    { itemId: "logistics", label: label("物流", "Logistics"), labelEn: "Logistics", amount: amount(cost.logistics), detail: label("后端已验证的物流成本", "Validated logistics cost"), detailEn: "Validated logistics cost" },
    { itemId: "warranty", label: label("售后与保修", "After-sales and warranty"), labelEn: "After-sales and warranty", amount: amount(cost.warranty), detail: label("后端已验证的售后预留", "Validated after-sales reserve"), detailEn: "Validated after-sales reserve" },
    { itemId: "residual", label: label("其他已报告运营成本", "Other reported operating cost"), labelEn: "Other reported operating cost", amount: amount(Math.max(residual, 0)), detail: label("总成本扣除已分类项目后的剩余项；不按类别推断", "Residual after specified components; not attributed to a category"), detailEn: "Residual after specified components; not attributed to a category" },
  ];
}

function financialSummaryFromValidatedFields(
  result: ScanResult,
  fields: StructuredProfitFields,
  locale: "zh" | "en",
): FinancialSummary | null {
  const comparison = fields.costComparison;
  const currency = fields.currency?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency) || !isCompleteCostSummary(comparison?.barebone) || !isCompleteCostSummary(comparison?.compliant)) {
    return null;
  }
  // Audit 2026-09-13 §10.2: the model fills unknown finance values with
  // zero, and an all-zero comparison passes every numeric check above —
  // the page then showed "$0.00" as if it were a real quote while the
  // report text said 待询价. An all-zero comparison carries no
  // information (free products don't exist at this granularity); treat
  // it as "no data" so the fallback renders 待询价/"—" instead.
  const isAllZero = (summary: CompleteCostSummary) =>
    FINANCE_COST_KEYS.every((key) => summary[key] === 0);
  if (isAllZero(comparison.barebone) && isAllZero(comparison.compliant)) {
    return null;
  }
  const bareRows = financeRowsFromCostSummary(comparison.barebone, currency, locale);
  const compliantRows = financeRowsFromCostSummary(comparison.compliant, currency, locale);
  if (!bareRows || !compliantRows) return null;
  const complianceCost = comparison.compliant.cert + comparison.compliant.epr;
  const t = (zh: string, en: string) => (locale === "zh" ? zh : en);
  // §10.2: numbers without a "quoted" source are model guesses — label
  // them as estimates instead of letting them read as real quotes.
  const isQuoted = fields.sourceStatus === "quoted";
  const mark = (value: string) =>
    isQuoted ? value : `${value}${t("（估）", " (est.)")}`;
  const summary: FinancialSummary = {
    provenance: "validated-backend",
    currency,
    retailBaseline: comparison.compliant.asp,
    bareRetailBaseline: comparison.barebone.asp,
    bareCostBreakdown: bareRows,
    estimatedHeroicProfit: mark(formatCurrency(comparison.barebone.gp, currency)),
    trueNetProfit: mark(formatCurrency(comparison.compliant.gp, currency)),
    complianceCost: mark(formatCurrency(complianceCost, currency)),
    monthlyNetProfit: t("后端未提供月度销量假设", "Monthly volume assumption not provided"),
    targetVolumeLabel: t("后端未提供销量基准", "Volume baseline not provided"),
    riskExposureItems: [],
    costBreakdown: compliantRows,
  };
  const markdown = result.reportPackage?.profitReport?.markdown;
  if (markdown) {
    (summary as FinancialSummary & { _backendMarkdown?: string })._backendMarkdown = markdown;
    (summary as FinancialSummary & { __includeBackendMarkdown?: boolean }).__includeBackendMarkdown = true;
  }
  return summary;
}

function normalizeDemoFinancialSummary(summary: FinancialSummary): FinancialSummary {
  const compliantCost = summary.costBreakdown.reduce((sum, row) => sum + parseCostValue(row.amount), 0);
  const compliantNet = parseCostValue(summary.trueNetProfit);
  const retailBaseline = Number((compliantCost + compliantNet).toFixed(2));
  const bareNet = parseCostValue(summary.estimatedHeroicProfit);
  const symbol = summary.trueNetProfit.match(/[¥$€£]/)?.[0] ?? "¥";
  return {
    ...summary,
    provenance: "demo",
    currency: summary.currency ?? (symbol === "$" ? "USD" : symbol === "€" ? "EUR" : symbol === "£" ? "GBP" : "CNY"),
    retailBaseline,
    bareRetailBaseline: retailBaseline,
    bareCostBreakdown: [{
      itemId: "demo_bare_operating_cost",
      label: "演示用非合规运营成本",
      labelEn: "Demo bare operating cost",
      amount: `${symbol}${Math.max(retailBaseline - bareNet, 0).toFixed(2)}`,
      detail: "演示数据：为保证展示算术一致而汇总，不代表实际成本分类。",
      detailEn: "Demo-only aggregate used to keep the presentation arithmetically consistent.",
    }],
  };
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
  // Demo "65W 充电宝" 用的是 FinancialSummary.costBreakdown 但其标签是
  // "采购 BOM / 物流头程 / 平台抽佣 / 合规成本 / 广告与营销 / 退货与售后"
  // —— 跟通用 CostSummary(BOM / 包装 / 认证 / EPR / 物流 / 保修 / ASP)的
  // 关键标签不是一一对应的。两条映射路径:
  //
  // 1. **itemId 锚定**(demo 65W 走的):cost_01=BOM, cost_02=物流,
  //    cost_03=平台抽佣(不进 CostSummary 落到 total 兜底),
  //    cost_04=合规成本(认证+EPR 总和), cost_05=广告(不进),
  //    cost_06=保修兜底
  // 2. **正则 fallback**(生产 RAG / 其他 demo):用 label 关键词匹配
  const costById: Record<string, (b: number) => Partial<CostSummary>> = {
    cost_01: (n) => ({ bom: n }),
    cost_02: (n) => ({ logistics: n }),
    cost_03: (_n) => ({}), // 平台抽佣不进 CostSummary, 落到 total 兜底
    cost_04: (_n) => ({}), // 合规成本:认证/EPR/包装整改在 compliant 列上单独加,不在 barebone 里再合
    cost_05: (_n) => ({}),
    cost_06: (n) => ({ warranty: n }),
  };
  const bareboneInit: CostSummary = { bom: 0, packaging: 0, cert: 0, epr: 0, logistics: 0, asp: 0, gp: 0, warranty: 0, total: 0 };
  const barebone: CostSummary = { ...bareboneInit };
  const platformCommission = parseCostValue(
    summary.costBreakdown.find((c) => c.itemId === "cost_03")?.amount ?? "",
  );
  for (const row of summary.costBreakdown) {
    const apply = costById[row.itemId];
    if (!apply) continue;
    const n = parseCostValue(row.amount);
    const partial = apply(n);
    Object.assign(barebone, partial);
  }
  // ASP 在 FinancialSummary 不直接给出 -> 用 complianceCost + estimatedHeroicProfit 估值
  // 这条只在没真实 ASP 时走兜底,避免裸机 total = 0 让 PDF 出现 NaN
  const asp =
    parseCostValue(summary.complianceCost) +
    parseCostValue(summary.estimatedHeroicProfit) +
    barebone.bom +
    barebone.logistics +
    platformCommission +
    barebone.warranty;
  barebone.asp = asp > 0 ? asp : 180; // 65W 充电器公开 ASP 兜底
  barebone.gp = parseCostValue(summary.estimatedHeroicProfit);
  barebone.total =
    barebone.bom + barebone.packaging + barebone.cert + barebone.epr +
    barebone.logistics + barebone.warranty + platformCommission;
  // "compliant" 列:认证 / EPR / 包装 / 保修 全部转正
  const compliant: CostSummary = {
    ...barebone,
    cert: barebone.cert > 0 ? barebone.cert : 18,
    epr: barebone.epr > 0 ? barebone.epr : 4,
    packaging: barebone.packaging > 0 ? barebone.packaging : 5.5,
    warranty: barebone.warranty > 0 ? barebone.warranty : 7.5,
    total:
      barebone.bom + 5.5 + 18 + 4 +
      barebone.logistics + 7.5 + platformCommission + 25,
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
    compliantRiskExposure: complianceNum,
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

/**
 * 把 `ProfitReportResult`(后端 LLM 利润分析 + 客户端解析后)适配成 `/profit/[sessionId]`
 * 页面用的 `FinancialSummary` 形态。
 *
 * 真实后端 RAG 扫描只产出 `reportPackage.profitReport.markdown`,
 * 不填 `result.financialSummary` — 之前页面看到这种情况会显示"利润页没有使用
 * 演示数据替代"降级面板(`/profit/[sessionId]/page.tsx` 历史 `05539cf`),
 * 但 LLM 已经给出了完整数据。把 markdown 反推成 `ProfitReportResult`
 * (`buildProfitReportFromScanResult`) 后,再用本函数把它映射为页面需要的
 * `FinancialSummary` 字段,以恢复真实利润页的结构化渲染。
 *
 * 关键设计:走 `Locale="zh" | "en"` 是页面侧的 `useBlazeLocale()` 取的,
 * 这里默认中文;调用方应在 mount 后再传 `locale`。返回的 `costBreakdown`
 * 顺序、risk items 文案都与原 FinancialSummary 一致,只多一个
 * `_backendMarkdown` 字段供页面把完整 LLM markdown 一起渲染(避免
 * "看到数字却看不到叙述")。
 */
export function financialSummaryFromProfitReport(
  profit: ProfitReportResult,
  locale: "zh" | "en" = "zh",
  options: { backendMarkdown?: string } = {},
): FinancialSummary {
  const isEnglish = locale === "en";
  const t = (zh: string, en: string) => (isEnglish ? en : zh);

  const bare = profit.barebone;
  const comp = profit.compliant;

  const fmtAmount = (n: number, currencyHint?: string) => {
    if (!Number.isFinite(n) || n === 0) return t("—", "—");
    const symbol =
      currencyHint === "USD" ? "$" :
      currencyHint === "EUR" ? "€" :
      currencyHint === "GBP" ? "£" :
      t("¥", "¥");
    const abs = Math.abs(n);
    return `${symbol}${abs.toFixed(2)}`;
  };

  // 把 CostSummary(bom/packaging/cert/epr/logistics/warranty + total)
  // 拆成前端 costBreakdown 用的「成本项」列表。
  const costRows = [
    { itemId: "cost_01", label: t("采购 BOM（壳料 + PCB + 电池）", "BOM (shell + PCB + battery)"), amount: fmtAmount(bare.bom), detail: t("壳料 + PCB + 电池等原材料采购", "Shell, PCB, battery procurement") },
    { itemId: "cost_02", label: t("物流头程 + 尾程", "Logistics (lead + last mile)"), amount: fmtAmount(bare.logistics), detail: t("头程海运/空运 + 尾程派送", "Lead sea/air freight + last mile") },
    { itemId: "cost_03", label: t("平台抽佣", "Platform commission"), amount: "—", detail: t("亚马逊 / 主流平台抽佣(已折入 total)", "Marketplace commission (folded into total)") },
    { itemId: "cost_04", label: t("合规成本", "Compliance cost"), amount: fmtAmount(comp.cert + comp.epr), detail: t("认证 + EPR + 标签整改一次性费用摊销", "Cert + EPR + label remediation amortization") },
    { itemId: "cost_05", label: t("广告与营销", "Advertising & marketing"), amount: "—", detail: t("品牌投放 + 站内推广(已折入 total)", "Brand ads + marketplace boost (folded into total)") },
    { itemId: "cost_06", label: t("退货与售后预留", "Returns & warranty reserve"), amount: fmtAmount(comp.warranty), detail: t("退货 + 售后保修预留", "Returns + warranty reserve") },
  ];

  return {
    estimatedHeroicProfit: profit.premiumPct ? fmtAmount(bare.asp - bare.total) : t("—", "—"),
    trueNetProfit: fmtAmount(comp.gp),
    complianceCost: fmtAmount(comp.cert + comp.epr + (comp.packaging - bare.packaging > 0 ? comp.packaging - bare.packaging : 0)),
    monthlyNetProfit: profit.pricingStrategy || t("由利润率 × 销量基准估算", "Estimated from margin × monthly volume"),
    targetVolumeLabel: t(`销量基准 3,000 台 / 月`, `Baseline volume 3,000 units / month`),
    riskExposureItems: [
      t("单日最高罚款 ¥180 万", "Daily maximum fine ¥1.8M"),
      t("全店永久封停", "Permanent store suspension"),
      t("货物强制扣毁", "Mandatory cargo seizure / destruction"),
      t("跨境集体诉讼", "Cross-border class action"),
    ],
    costBreakdown: costRows,
  };
}

/**
 * 给 `ScanResult` 在没有 `financialSummary` 但有后端 LLM
 * `reportPackage.profitReport.markdown` 时,合成一份页面能用的
 * `FinancialSummary`。
 *
 * 行为契约:
 *   - 已有 `financialSummary` → 原样返回(不覆盖)
 *   - markdown 能反推出至少 1 个 cost value(asp/bom/cert 任意非零),
 *     或 markdown 内容本身非空 → 走 `financialSummaryFromProfitReport`,
 *     返回合成的 FinancialSummary(标 `__synthesizedFromBackend: true` 私有 flag)
 *   - 都没有 → 返回 `null`,调用方应进入降级面板
 *
 * 这是 2026-07-21 修复回归用的兜底:commit `05539cf` 加了"利润页没有使用演示
 * 数据替代"诚实降级,但忽略了后端 LLM 已经写出完整利润 markdown 这条路。
 * 现在把它接上,真实扫描(`/profit/<id>` 真实 sessionId)不再被降级到
 * "数据不完整"面板。
 */
export function synthesizeFinancialSummaryIfMissing(
  result: ScanResult,
  locale: "zh" | "en" = "zh",
): FinancialSummary | null {
  if (result.financialSummary && (result.source === "demo" || result.modelInfo?.visionProvider === "mock")) {
    return normalizeDemoFinancialSummary(result.financialSummary);
  }
  // Markdown remains a reviewable narrative. A real scan cannot become a
  // detailed financial board through regex parsing or a borrowed demo value.
  const structuredFields = result.reportPackage?.profitReport?.structuredFields;
  return structuredFields
    ? financialSummaryFromValidatedFields(result, structuredFields, locale)
    : null;

  /* Legacy markdown synthesis intentionally left below for source history;
   * the early return above makes it unreachable for every active scan path.
  const profitMd = result.reportPackage?.profitReport?.markdown!;
  if (!profitMd || !profitMd.trim()) return null;

  const profit = buildProfitReportFromScanResult(result, locale)!;
  if (!profit) return null;

  // sanity: LLM markdown 解析后所有数字都 0 的情况就是「没数据」— 别假装合成
  const bare = profit.barebone;
  const comp = profit.compliant;
  const hasAnyValue =
    bare.asp > 0 ||
    bare.bom > 0 ||
    bare.total > 0 ||
    comp.asp > 0 ||
    comp.cert > 0 ||
    comp.epr > 0 ||
    (profit.premiumPct && profit.premiumPct.length > 0 && profit.premiumPct !== "—");
  if (!hasAnyValue) return null;

  const fs = financialSummaryFromProfitReport(profit, locale, { backendMarkdown: profitMd });
  // 私有 flag,告诉调用方(页面 / 导出器)这是从后端 LLM markdown 合成出来的,
  // 应当把完整 markdown 当作「后端真实输出」段落一起渲染,而不是仅展示数字。
  (fs as FinancialSummary & { _backendMarkdown?: string })._backendMarkdown = profitMd;
  (fs as FinancialSummary & { __includeBackendMarkdown?: boolean }).__includeBackendMarkdown = true;
  return fs;
  */
}

/**
 * Adapt a `ProfitReportResult` (the legacy result-page export payload — barebone
 * / compliant CostSummary fields + bareboneRiskExposure + pricingStrategy + etc.)
 * into the unified `ProfitRenderModel` consumed by both `/profit/[sessionId]` and
 * the `/result/[sessionId]` "成本利润说明" export buttons.
 *
 * Why this exists: before this fix, `downloadProfitReportAsPdf/Docx(pr)` was
 * rebuilding a *synthetic* FinancialSummary that ignored `result.financialSummary`,
 * so the two export entry points produced different numbers for the same session
 * (¥11.48 vs ¥0.71, ¥23.97 vs ¥7.46, …). Now both flows converge on the same
 * RenderModel so the exported PDF/DOCX matches the on-screen profit page byte-for-byte.
 *
 * The synthetic FinancialSummary here preserves the field semantics used by the
 * page (estimatedHeroicProfit = barebone.gp, trueNetProfit = compliant.gp,
 * complianceCost = compliant.cert + compliant.epr + packaging delta, …) so the
 * resulting render model is identical to one built from a real FinancialSummary.
 */
export function buildProfitRenderModelFromProfitReport(
  pr: ProfitReportResult,
  locale: "zh" | "en" = "zh",
): ProfitRenderModel {
  const isEnglish = locale === "en";
  const bare = pr.barebone;
  const comp = pr.compliant;
  const sym = (() => {
    const c = pr.currency?.toUpperCase();
    if (c === "USD") return "$";
    if (c === "EUR") return "€";
    if (c === "GBP") return "£";
    if (c === "CNY" || c === "JPY") return "¥";
    return isEnglish ? "$" : "¥";
  })();
  const fmt = (n: number): string => {
    if (!Number.isFinite(n) || n === 0) return isEnglish ? "—" : "—";
    return `${sym}${n.toFixed(2)}`;
  };
  const fmtInt = (n: number): string => {
    if (!Number.isFinite(n) || n === 0) return isEnglish ? "—" : "—";
    return `${sym}${n.toFixed(0)}`;
  };
  const complianceCostNum = comp.cert + comp.epr + Math.max(comp.packaging - bare.packaging, 0);

  const labels = isEnglish
    ? {
        targetVolume: "Baseline volume 3,000 units / month",
        risk: [
          "Daily maximum fine ¥1.8M",
          "Permanent store suspension",
          "Mandatory cargo seizure",
          "Cross-border class action",
        ],
        bomLabel: "BOM (shell + PCB + battery)",
        bomDetail: "Shell, PCB, battery procurement",
        logisticsLabel: "Logistics (lead + last mile)",
        logisticsDetail: "Lead sea/air freight + last mile",
        platformLabel: "Platform commission",
        platformDetail: "Marketplace commission (folded into total)",
        complianceLabel: "Compliance cost",
        complianceDetail: "Cert + EPR + label remediation amortization",
        adsLabel: "Advertising & marketing",
        adsDetail: "Brand ads + marketplace boost (folded into total)",
        returnsLabel: "Returns & warranty reserve",
        returnsDetail: "Returns + warranty reserve",
      }
    : {
        targetVolume: "销量基准 3,000 台 / 月",
        risk: [
          "单日最高罚款 ¥180 万",
          "全店永久封停",
          "货物强制扣毁",
          "跨境集体诉讼",
        ],
        bomLabel: "采购 BOM（壳料 + PCB + 电池）",
        bomDetail: "壳料 + PCB + 电池等原材料采购",
        logisticsLabel: "物流头程 + 尾程",
        logisticsDetail: "头程海运/空运 + 尾程派送",
        platformLabel: "平台抽佣",
        platformDetail: "亚马逊 / 主流平台抽佣(已折入 total)",
        complianceLabel: "合规成本",
        complianceDetail: "认证 + EPR + 标签整改一次性费用摊销",
        adsLabel: "广告与营销",
        adsDetail: "品牌投放 + 站内推广(已折入 total)",
        returnsLabel: "退货与售后预留",
        returnsDetail: "退货 + 售后保修预留",
      };

  const financialSummary: FinancialSummary = {
    estimatedHeroicProfit: fmt(bare.gp),
    trueNetProfit: fmt(comp.gp),
    complianceCost: fmt(complianceCostNum),
    monthlyNetProfit: pr.pricingStrategy || labels.targetVolume,
    targetVolumeLabel: labels.targetVolume,
    targetVolumeLabelEn: labels.targetVolume,
    riskExposureItems: labels.risk,
    riskExposureItemsEn: labels.risk,
    costBreakdown: [
      { itemId: "cost_01", label: labels.bomLabel, labelEn: labels.bomLabel, amount: fmt(bare.bom), detail: labels.bomDetail, detailEn: labels.bomDetail },
      { itemId: "cost_02", label: labels.logisticsLabel, labelEn: labels.logisticsLabel, amount: fmt(bare.logistics), detail: labels.logisticsDetail, detailEn: labels.logisticsDetail },
      { itemId: "cost_03", label: labels.platformLabel, labelEn: labels.platformLabel, amount: "—", detail: labels.platformDetail, detailEn: labels.platformDetail },
      { itemId: "cost_04", label: labels.complianceLabel, labelEn: labels.complianceLabel, amount: fmt(complianceCostNum), detail: labels.complianceDetail, detailEn: labels.complianceDetail },
      { itemId: "cost_05", label: labels.adsLabel, labelEn: labels.adsLabel, amount: "—", detail: labels.adsDetail, detailEn: labels.adsDetail },
      { itemId: "cost_06", label: labels.returnsLabel, labelEn: labels.returnsLabel, amount: fmt(comp.warranty), detail: labels.returnsDetail, detailEn: labels.returnsDetail },
    ],
  };

  const syntheticResult: ScanResult = {
    sessionId: pr.sessionId,
    scanTime: pr.generatedAt,
    productName: pr.productType,
    productNameEn: pr.productTypeEn ?? pr.productType,
    targetMarkets: [pr.market as ScanResult["targetMarkets"][number]],
    productCategory: "other",
    images: [],
    documents: [],
    generatedAt: pr.generatedAt,
    complianceScore: 0,
    scoreGrade: "C",
    financialSummary,
    riskPoints: [],
    checklist: [],
    // Pass through the LLM markdown + reportPackage shape so the optional
    // backend-LLM section still renders if the caller passed a markdown body.
    reportPackage: pr.report
      ? {
          profitReport: {
            markdown: pr.report,
            conclusions: pr.conclusions,
            references: pr.references,
            pricingStrategy: pr.pricingStrategy,
            pricingStrategyEn: pr.pricingStrategyEn,
            riskNote: pr.riskNote,
            riskNoteEn: pr.riskNoteEn,
            keyConclusion: pr.keyConclusion,
            keyConclusionEn: pr.keyConclusionEn,
          },
        }
      : undefined,
  };

  // Re-use the existing builder so the legacy /result/[sessionId] export path
  // converges with the /profit/[sessionId] path on the same model.
  return buildProfitRenderModel({
    result: syntheticResult,
    financialSummary,
    profitMode: "compliant",
    locale: locale as import("@/lib/report-export-modules/shared").Locale,
  });
}
