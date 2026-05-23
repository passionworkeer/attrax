import type { CostSummary, GeneratedReportPackage, ProfitReportResult } from "@/lib/types";

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

export function buildProfitReportFromMarkdown(
  sessionId: string,
  markdown: string,
  productType: string,
  market: string,
  overrides?: GeneratedReportPackage["profitReport"]
): ProfitReportResult {
  const extracted = extractCostSummary(markdown);
  return {
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
}
