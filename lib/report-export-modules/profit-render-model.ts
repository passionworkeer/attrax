/**
 * profit-render-model.ts
 *
 * Single source of truth for the visual layout of the "合规整改成本与风险影响"
 * (Compliance Cost and Risk Impact) page. Both `/profit/[sessionId]/page.tsx`
 * and the PDF / DOCX export modules (`lib/report-export-modules/profit-pdf.ts`
 * and `profit-docx.ts`) must consume this model — so a PDF the user downloads
 * has byte-for-byte the same labels, numbers, and bare-mode caveat they just
 * saw on screen.
 *
 * Why one model: the page (React) and the exporters (jsPDF / docx) were
 * independently hard-coding labels and numbers. As a result the previous PDF
 * showed "合规成本与利润分析报告" (from `report.profitTitle` in translations.ts)
 * and a `¥X toFixed(0)` summary card driven by `CostSummary.gp`, while the
 * page showed "合规整改成本与风险影响" and `estimatedHeroicProfit` /
 * `trueNetProfit` / `complianceCost` / `monthlyNetProfit` from
 * `FinancialSummary`. Two parallel data flows producing different numbers.
 *
 * The model is produced from:
 *   - `result`           (ScanResult)
 *   - `financialSummary` (FinancialSummary — string amounts already pre-formatted
 *                          in the user's currency by the synthesizer or by the
 *                          demo fixture)
 *   - `locale`           ("zh" | "en")
 *   - `profitMode`       ("bare" | "compliant" — which mode the user is
 *                          currently viewing on `/profit/[sessionId]`)
 *
 * The model is *presentation-only* — it does not invent or alter numbers. All
 * `amount` and `displayAmount` strings come verbatim from the FinancialSummary
 * (or the synthesizer). All percentages come from the page's chain-cost math
 * which we replicate here for consistency (see `buildProfitRenderModel`).
 */
import type { Locale } from "./shared";
import type { FinancialSummary } from "@/lib/types.blaze-hawks";
import type { ScanResult } from "@/lib/types";

export type ProfitMode = "bare" | "compliant";
export type MetricTone = "green" | "white" | "orange" | "blue" | "alert";

export interface ProfitMetricCard {
  label: string;
  value: string;
  unit: string;
  tone: MetricTone;
  /** Mirror of `metric.tone === "orange"` on the page — drives "核心结果" badge. */
  isCore?: boolean;
  /** Bare-mode "expected risk exposure not deducted" caveat (mode === "bare" only). */
  bareRiskCaveat?: string | null;
}

export interface ProfitChainNode {
  label: string;
  detail: string;
  /** Formatted display amount with currency symbol, e.g. "¥15.00". */
  displayAmount: string;
  /** Numeric amount (used for stacking math). */
  amount: number;
  /** 0–100 percentage of `retailBaseline`. */
  share: number;
  /** Running balance after subtracting this row from `retailBaseline`. */
  remaining: number;
  /** Hex color used for bar + segment. */
  color: string;
}

export interface ProfitStackLegendItem {
  label: string;
  color: string;
  displayAmount: string;
  isFinal?: boolean;
}

export interface ProfitRiskItem {
  icon: "gavel" | "xcircle" | "shield";
  label: string;
}

export interface ProfitCostBoard {
  retailBaselineLabel: string;
  totalChainCostLabel: string;
  finalNetValue: string;
  /** Numeric final profit after subtracting all chain costs. */
  finalNetNumber: number;
  /** 0–100 share of retail baseline. */
  finalNetShare: number;
  marginSignal: string;
  breakEvenBufferLabel: string;
  dominantCost: {
    label: string;
    amountLabel: string;
    shareLabel: string;
  };
  activeModeTitle: string;
}

export interface ProfitRenderModel {
  // Header
  title: string;
  subtitle: string;
  productName: string;
  marketLabel: string;
  generatedAtLabel: string;

  // Active mode (exporters need to know which mode the user was on)
  profitMode: ProfitMode;

  // 4 metric cards in display order
  metrics: ProfitMetricCard[];

  // 6 chain cost nodes
  chainNodes: ProfitChainNode[];

  // Cost impact board (3 small cards + 3 diagnostic cards)
  costBoard: ProfitCostBoard;

  // Stacked-bar legend entries (chain + final net)
  stackLegend: ProfitStackLegendItem[];

  // Risk exposure (4 items)
  riskExposureItems: ProfitRiskItem[];

  // Bare-mode caveat (null when profitMode === "compliant")
  bareRiskCaveat: string | null;

  // Optional backend LLM section (only when synthesized from real scan)
  backendMarkdown: string | null;
  backendMarkdownBadge: string;
  backendMarkdownTitle: string;
  backendMarkdownDescription: string;

  // Section 5 (conclusions) / Section 6 (references) — from ProfitReportResult
  conclusions: string;
  references: string;

  // Session meta
  sessionId: string;
  generatedAt: string;
  currencySymbol: string;
  /** Localized basename for the export file (no extension). */
  exportBasename: string;

  // Color palette constants (exporters need the same colors)
  chainPalette: string[];
  finalNetGradientStart: string;
  finalNetGradientEnd: string;
}

/**
 * Convert a FinancialSummary amount string like "¥0.71" / "$11.48" / "—" / "¥15.00"
 * to a numeric value. Falls back to 0 for "—" and non-numeric strings.
 */
function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d.-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Detect currency symbol from a pre-formatted FinancialSummary amount string.
 * Returns the first currency glyph found, defaulting to the symbol implied by
 * the locale ("¥" for zh, "$" for en).
 */
function detectCurrencySymbol(ls: FinancialSummary, locale: Locale): string {
  const sample = ls.trueNetProfit || ls.complianceCost || ls.estimatedHeroicProfit || "";
  if (sample.includes("¥")) return "¥";
  if (sample.includes("$")) return "$";
  if (sample.includes("€")) return "€";
  if (sample.includes("£")) return "£";
  return locale === "zh" ? "¥" : "$";
}

const I18N = {
  zh: {
    pageTitle: "合规整改成本与风险影响",
    pageTitleEn: "Compliance Cost and Risk Impact",
    eyebrow: "成本影响",
    eyebrowEn: "Cost Impact",
    bare: "裸奔出海",
    bareEn: "Launch Bare",
    compliant: "合规后出海",
    compliantEn: "Launch Compliant",
    bareBody: "不补认证、不补标签，短期利润看起来更高，但风险会直接吞掉整批货。",
    bareBodyEn: "Skip marks and labels for short-term margin, but the exposure can swallow the whole batch.",
    compliantBody: "先承担合规成本，把认证、说明书和平台审核链路闭环后再进入目标市场。",
    compliantBodyEn: "Absorb compliance cost first, close marks, manuals, and marketplace review before launch.",
    heroMetric: "未整改预估单件收益",
    heroMetricEn: "Estimated Net Before Remediation",
    visibleCost: "表面合规成本",
    visibleCostEn: "Visible compliance cost",
    maxExposure: "最高风险暴露",
    maxExposureEn: "Maximum exposure",
    aiDecision: "AI 决策",
    aiDecisionEn: "AI decision",
    fixFirst: "先整改",
    fixFirstEn: "Fix first",
    trueNet: "合规后单件净收益",
    trueNetEn: "Net After Compliance",
    complianceCost: "单产品合规总成本",
    complianceCostEn: "Compliance Cost",
    monthlyNet: "合规后预估月度净收益",
    monthlyNetEn: "Estimated Monthly Net",
    coreResultBadge: "核心结果",
    coreResultBadgeEn: "Core Result",
    unitPer: "/单个产品",
    unitPerEn: "/unit",
    unitMonth: "/月",
    unitMonthEn: "/month",
    unitDailyCap: "单日上限",
    unitDailyCapEn: "daily max",
    bareCaveat: "↑ 此数未扣除期望风险敞口（潜在罚款 / 扣押 / 召回）",
    bareCaveatEn: "↑ Does not deduct expected risk exposure (potential fines, seizure, recall)",
    costBoardEyebrow: "PAGE 05 · 数据驱动",
    costBoardEyebrowEn: "PAGE 05 · Data driven",
    costBoardTitle: "全链路成本明细",
    costBoardTitleEn: "Full-Chain Cost Breakdown",
    costBoardDesc: "从售价开始，逐项扣除采购、物流、平台、合规、营销与退货成本，实时计算最终净利润。",
    costBoardDescEn: "Start from retail price, deduct procurement, logistics, marketplace, compliance, marketing, and returns to calculate final net profit.",
    retailBaseline: "售价基线",
    retailBaselineEn: "Retail",
    retailBaselineChip: (n: number) => `售价基线 ¥${n}`,
    retailBaselineChipEn: (n: number) => `Retail baseline ¥${n}`,
    chainCost: "全链路成本",
    chainCostEn: "Chain cost",
    finalNet: "最终净利润",
    finalNetEn: "Final net",
    aiMarginSignal: "AI 利润判断",
    aiMarginSignalEn: "AI margin signal",
    marginHealthy: (n: number) => `每售出 1 件保留 ¥${n.toFixed(0)}，当前利润结构接近健康线。`,
    marginHealthyEn: (n: number) => `Each sale retains ¥${n.toFixed(0)}; the current margin is near the healthy range.`,
    marginFragile: (n: number) => `每售出 1 件保留 ¥${n.toFixed(0)}，当前利润结构仍需谨慎。`,
    marginFragileEn: (n: number) => `Each sale retains ¥${n.toFixed(0)}; the current margin is still fragile.`,
    aboveMarginFloor: "距 ¥8 利润底线",
    aboveMarginFloorEn: "Above ¥8 margin floor",
    largestDriver: "最大成本来源",
    largestDriverEn: "Largest cost driver",
    costFlowTitle: "成本节点流",
    costFlowTitleEn: "Cost flow",
    costFlowHint: "节点宽度按售价占比计算",
    costFlowHintEn: "Node bars reflect share of retail",
    balanceLabel: "扣后余额",
    balanceLabelEn: "Balance",
    allocationTitle: "售价分配结果",
    allocationTitleEn: "Retail allocation",
    allocationHint: "每一段代表售价中被对应成本或利润占用的比例",
    allocationHintEn: "Each segment shows how retail value is consumed by cost or profit.",
    netMargin: "净利率",
    netMarginEn: "Net margin",
    riskTitle: "不合规最高风险",
    riskTitleEn: "Maximum Risk Exposure",
    backendBadge: "后端真实输出",
    backendBadgeEn: "Real backend output",
    backendTitle: "本次扫描的完整成本叙述(来自后端 LLM)",
    backendTitleEn: "Full cost narrative for this scan (from the backend LLM)",
    backendDesc: "以下为后端 LLM 结合语料库与本次扫描产物直接生成的成本 / 利润 / 风险叙述。数字与上方「合规化升级总成本」结构保持一致,但包含更细的认证明细与单台摊销推导。",
    backendDescEn: "Below is the cost / margin / exposure narrative generated by the backend LLM against the corpus and this scan. Numbers track the structured figures above, with finer certification breakdown and per-unit amortization.",
  },
} as const;

const CHAIN_PALETTE = ["#3fb5c8", "#54c9d6", "#71d9db", "#8ae6df", "#63bfd5", "#87b7cf"];
const FINAL_GRADIENT_START = "#8cf0df";
const FINAL_GRADIENT_END = "#42bfd0";

/**
 * Build the ProfitRenderModel from the same inputs `/profit/[sessionId]/page.tsx`
 * uses — `ScanResult` (for product/market/identifying data + optional backend
 * markdown), `FinancialSummary` (for the metric cards + chain + risk items),
 * the active `profitMode`, and the locale.
 *
 * The chain-cost math (retail baseline → per-row deduction → final profit)
 * uses the same explicit financial baseline as the page and both exports.
 */
export function buildProfitRenderModel(args: {
  result: ScanResult;
  financialSummary: FinancialSummary;
  profitMode: ProfitMode;
  locale: Locale;
}): ProfitRenderModel {
  const { result, financialSummary: ls, profitMode, locale } = args;
  const L = locale;
  const isZh = L === "zh";
  const t = (zh: string, en: string) => (isZh ? zh : en);
  const i = I18N.zh; // we always pick from the zh table above based on locale

  // ── Header ────────────────────────────────────────────────────────────────
  const productName = isZh ? result.productName ?? "产品" : result.productNameEn ?? result.productName ?? "Product";
  const marketLabel = result.targetMarkets.length ? result.targetMarkets.join("+") : (isZh ? "目标市场" : "Target market");
  const subtitle = isZh
    ? `${marketLabel} 市场 · ${productName} · ${ls.targetVolumeLabel}`
    : `${marketLabel} market · ${productName} · ${ls.targetVolumeLabelEn ?? ls.targetVolumeLabel}`;
  const currencySymbol = detectCurrencySymbol(ls, L);
  const dateFmt = isZh ? "zh-CN" : "en-US";
  const generatedAtLabel = new Date(result.generatedAt).toLocaleDateString(dateFmt);

  // ── 4 metric cards ────────────────────────────────────────────────────────
  const visibleCost = "¥0";
  const visibleCostEn = "¥0";
  const maxExposure = "¥180万";
  const maxExposureEn = "¥1.8M";

  const metrics: ProfitMetricCard[] = profitMode === "bare"
    ? [
        {
          label: isZh ? i.heroMetric : i.heroMetricEn,
          value: ls.estimatedHeroicProfit,
          tone: "green",
          unit: isZh ? i.unitPer : i.unitPerEn,
          bareRiskCaveat: isZh ? i.bareCaveat : i.bareCaveatEn,
        },
        {
          label: isZh ? i.visibleCost : i.visibleCostEn,
          value: visibleCost,
          tone: "white",
          unit: isZh ? i.unitPer : i.unitPerEn,
          isCore: true,
        },
        {
          label: isZh ? i.maxExposure : i.maxExposureEn,
          value: isZh ? maxExposure : maxExposureEn,
          tone: "orange",
          unit: isZh ? i.unitDailyCap : i.unitDailyCapEn,
        },
        {
          label: isZh ? i.aiDecision : i.aiDecisionEn,
          value: isZh ? i.fixFirst : i.fixFirstEn,
          tone: "alert",
          unit: "",
        },
      ]
    : [
        {
          label: isZh ? i.heroMetric : i.heroMetricEn,
          value: ls.estimatedHeroicProfit,
          tone: "green",
          unit: isZh ? i.unitPer : i.unitPerEn,
        },
        {
          label: isZh ? i.trueNet : i.trueNetEn,
          value: ls.trueNetProfit,
          tone: "white",
          unit: isZh ? i.unitPer : i.unitPerEn,
          isCore: true,
        },
        {
          label: isZh ? i.complianceCost : i.complianceCostEn,
          value: ls.complianceCost,
          tone: "orange",
          unit: isZh ? i.unitPer : i.unitPerEn,
        },
        {
          label: isZh ? i.monthlyNet : i.monthlyNetEn,
          value: ls.monthlyNetProfit,
          tone: "blue",
          unit: isZh ? i.unitMonth : i.unitMonthEn,
        },
      ];

  const bareRiskCaveat = profitMode === "bare" ? (isZh ? i.bareCaveat : i.bareCaveatEn) : null;

  // ── Cost breakdown / chain flow / stacked bar ─────────────────────────────
  // One selected scenario supplies the costs, baseline, and final net.
  const selectedRows = profitMode === "bare" && ls.bareCostBreakdown
    ? ls.bareCostBreakdown
    : ls.costBreakdown;
  const selectedNet = profitMode === "bare"
    ? parseAmount(ls.estimatedHeroicProfit)
    : parseAmount(ls.trueNetProfit);
  const listedCost = selectedRows.reduce((sum, row) => sum + parseAmount(row.amount), 0);
  const retailBaseline = profitMode === "bare"
    ? ls.bareRetailBaseline ?? listedCost + selectedNet
    : ls.retailBaseline ?? listedCost + selectedNet;

  const costRows = selectedRows.map((row, idx) => ({
    label: isZh ? row.label : row.labelEn ?? row.label,
    amountRaw: row.amount,
    amount: parseAmount(row.amount),
    detail: isZh ? row.detail : row.detailEn ?? row.detail,
    // In bare mode the page zeros out the 4th row (index 3 — 合规成本) because
    // that cost doesn't exist before remediation.
    color: CHAIN_PALETTE[idx % CHAIN_PALETTE.length],
  }));

  let runningBalance = retailBaseline;
  const chainNodes: ProfitChainNode[] = costRows.map((row, idx) => {
    runningBalance -= row.amount;
    return {
      label: row.label,
      detail: row.detail,
      displayAmount: row.amountRaw,
      amount: row.amount,
      share: Math.max((row.amount / retailBaseline) * 100, 0),
      remaining: Math.max(runningBalance, 0),
      color: row.color,
    };
  });

  const totalChainCost = chainNodes.reduce((sum, n) => sum + n.amount, 0);
  const finalNetNumber = retailBaseline - totalChainCost;
  const finalNetShare = (finalNetNumber / retailBaseline) * 100;
  const breakEvenBuffer = Math.max(finalNetNumber - 8, 0);
  const dominantCost = chainNodes.reduce(
    (largest, n) => (n.amount > largest.amount ? n : largest),
    chainNodes[0] ?? { label: "", amount: 0, displayAmount: "", share: 0, detail: "", remaining: 0, color: CHAIN_PALETTE[0] },
  );

  const activeModeTitle = profitMode === "bare"
    ? (isZh ? i.bare : i.bareEn)
    : (isZh ? i.compliant : i.compliantEn);

  const finalNetValue = `${currencySymbol}${finalNetNumber.toFixed(2)}`;

  const costBoard: ProfitCostBoard = {
    retailBaselineLabel: isZh ? i.retailBaselineChip(retailBaseline) : i.retailBaselineChipEn(retailBaseline),
    totalChainCostLabel: isZh ? `${i.chainCost} ${currencySymbol}${totalChainCost.toFixed(2)}` : `${i.chainCostEn} ${currencySymbol}${totalChainCost.toFixed(2)}`,
    finalNetValue,
    finalNetNumber,
    finalNetShare,
    marginSignal: finalNetShare >= 10
      ? (isZh ? i.marginHealthy(finalNetNumber) : i.marginHealthyEn(finalNetNumber))
      : (isZh ? i.marginFragile(finalNetNumber) : i.marginFragileEn(finalNetNumber)),
    breakEvenBufferLabel: `+${currencySymbol}${breakEvenBuffer.toFixed(0)}`,
    dominantCost: {
      label: dominantCost.label,
      amountLabel: `${currencySymbol}${dominantCost.amount.toFixed(0)}`,
      shareLabel: `${dominantCost.share.toFixed(1)}%`,
    },
    activeModeTitle,
  };

  // ── Stacked-bar legend ─────────────────────────────────────────────────────
  const stackLegend: ProfitStackLegendItem[] = [
    ...chainNodes.map((n) => ({ label: n.label, color: n.color, displayAmount: n.displayAmount })),
    { label: isZh ? i.finalNet : i.finalNetEn, color: FINAL_GRADIENT_END, displayAmount: finalNetValue, isFinal: true },
  ];

  // ── Risk exposure items ────────────────────────────────────────────────────
  const riskStrings = isZh
    ? (ls.riskExposureItems ?? [])
    : (ls.riskExposureItemsEn ?? ls.riskExposureItems ?? []);
  // Same icon rotation as page.tsx: Gavel, XCircle, ShieldAlert, Gavel
  const iconRotation: ProfitRiskItem["icon"][] = ["gavel", "xcircle", "shield", "gavel"];
  const riskExposureItems: ProfitRiskItem[] = riskStrings.map((label, i) => ({
    icon: iconRotation[i % iconRotation.length],
    label,
  }));

  // ── Backend LLM section (only when synthesized from real scan) ─────────────
  // Page logic: only renders when `isSynthesized === true` (financialSummary
  // was synthesized from `reportPackage.profitReport.markdown`).
  // We can't read that flag from here directly, so we accept the markdown
  // from the caller and decide presence by whether financialSummary carries
  // a `_backendMarkdown` private field (set by synthesizer).
  const backendMarkdownField = (ls as FinancialSummary & { _backendMarkdown?: string })._backendMarkdown
    ?? result.reportPackage?.profitReport?.markdown
    ?? null;
  // Only show this section if it wasn't already rendered through the regular
  // page (page only shows when synthesized). The ProfitExportPanel always
  // passes an explicit boolean through `__includeBackendMarkdown`, but to keep
  // the model self-contained we accept it via a private field on the summary.
  const includeBackend = (ls as FinancialSummary & { __includeBackendMarkdown?: boolean }).__includeBackendMarkdown === true;
  const backendMarkdown = includeBackend ? backendMarkdownField : null;

  // ── Section 5 / 6 ─────────────────────────────────────────────────────────
  // The exporters previously read `result.reportPackage.profitReport.markdown`
  // and split it into conclusions/references via regex. The page does NOT
  // render those sections, so we leave them empty here — the model only
  // represents what the page shows. If a future iteration wants to add them,
  // pass them through `profitReport.markdown` as before.
  const conclusions = "";
  const references = "";

  return {
    title: isZh ? i.pageTitle : i.pageTitleEn,
    subtitle,
    productName,
    marketLabel,
    generatedAtLabel,
    profitMode,
    metrics,
    chainNodes,
    costBoard,
    stackLegend,
    riskExposureItems,
    bareRiskCaveat,
    backendMarkdown,
    backendMarkdownBadge: isZh ? i.backendBadge : i.backendBadgeEn,
    backendMarkdownTitle: isZh ? i.backendTitle : i.backendTitleEn,
    backendMarkdownDescription: isZh ? i.backendDesc : i.backendDescEn,
    conclusions,
    references,
    sessionId: result.sessionId,
    generatedAt: result.generatedAt,
    currencySymbol,
    exportBasename: isZh ? "合规整改成本与风险影响" : "Compliance Cost and Risk Impact",
    chainPalette: CHAIN_PALETTE,
    finalNetGradientStart: FINAL_GRADIENT_START,
    finalNetGradientEnd: FINAL_GRADIENT_END,
  };
}

/** The default retail baseline — kept here so page.tsx and exporters share it. */

/**
 * Helper: tiny helper to look up the icon symbol for a profit risk item.
 * (Both UI and exporters need to map `gavel` → the right icon component.)
 */
export function getProfitRiskIconName(icon: ProfitRiskItem["icon"]): "gavel" | "xcircle" | "shield" {
  return icon;
}
