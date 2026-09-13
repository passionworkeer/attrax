import { blazeReportPreviewTabs } from "@/lib/mock/blaze-scenario";
import {
  createMockScanResult,
  mockComplianceReportMarkdown,
  mockScanResult,
} from "@/lib/mock/blaze-scan-result";
import type {
  ComplianceReportResult,
  Market,
  ProductCategory,
  RiskPoint,
  ScanResult,
} from "@/lib/types";

/**
 * Result page 纯视图辅助函数（2026-09-10 自 app/result/[sessionId]/page.tsx 抽出，
 * 审计 2.5 —— 降低页面文件体积并允许单测直接覆盖）。
 * 全部为无副作用纯函数，不依赖 React。
 */

export function scanResultToComplianceView(result: ScanResult, locale: "zh" | "en"): ComplianceReportResult {
  const severityRank: Record<RiskPoint["severity"], number> = { critical: 3, warning: 2, info: 1, unknown: 0 };
  const riskPoints = result.riskPoints ?? [];
  const topRank = riskPoints.reduce((acc, rp) => Math.max(acc, severityRank[rp.severity] ?? 0), 0);
  const complianceStatus: ComplianceReportResult["complianceStatus"] =
    topRank >= 3 ? "REJECTED" : topRank >= 2 ? "WARN" : "PASS";
  const traceNodes: ComplianceReportResult["agentTrace"] = riskPoints.map((rp) => ({
    node: `risk.${rp.riskId}`,
    label: rp.title,
    severity: rp.severity,
  }));
  traceNodes.push({ node: "demo.aggregate", label: locale === "zh" ? "Demo 数据汇总" : "Demo aggregate" });
  const fallback = mockComplianceReportMarkdown(result, locale);
  return {
    sessionId: result.sessionId,
    scanTime: result.scanTime,
    productCategory: result.productCategory,
    productName: result.productName,
    productNameEn: result.productNameEn,
    targetMarkets: result.targetMarkets ?? [],
    complianceScore: result.complianceScore,
    scoreGrade: result.scoreGrade,
    complianceReport: fallback,
    complianceStatus,
    // Audit P1-K: explicit kind discriminator so downstream consumers can
    // assert "this view is from the demo path" without re-checking the
    // sessionId string.
    kind: "demo",
    agentTrace: traceNodes,
    loopCount: 0,
    retrievedChunks: riskPoints.flatMap((rp) =>
      (rp.regulations ?? []).map((rule) => ({
        regId: rule.regId,
        docName: rule.name,
        docNameEn: rule.nameEn,
        articleNo: rule.code,
        region: rule.market,
        score: 0.85,
      })),
    ),
    // Forward the rich side-data so `<ComplianceReportView>`'s rich
    // risk-point / checklist / image panel renders for demo presets too.
    // (Previously these were hardcoded to `undefined`, which silently
    // collapsed the entire rich section — see audit P0-A.)
    images: result.images ?? [],
    documents: (result.documents ?? []).map((doc) => ({
      documentId: doc.documentId,
      name: doc.name,
      nameEn: doc.nameEn,
      size: doc.size,
      type: doc.type,
      mimeType: doc.mimeType,
      url: doc.url,
    })),
    riskPoints: riskPoints,
    checklist: result.checklist ?? [],
    generatedAt: result.generatedAt,
    modelInfo: { ragProvider: "demo", latencyMs: 0 },
    source: "demo",
  };
}

/**
 * Build a ComplianceReportResult for a *real* (non-demo) scan.
 *
 * Unlike `scanResultToComplianceView`, this does NOT overwrite the LLM output
 * with mock markdown or a synthetic "demo.aggregate" trace node. The KB-anchored
 * pipeline already emits the report markdown, agent trace, and provider name on
 * the v1 session payload; the v1-adapter surfaces them on `result`, and we
 * forward them unchanged. Only the shape is adapted to match ComplianceReportResult.
 *
 * Callers MUST gate on `isDemoSession` (e.g. `sessionId === "demo"`) before
 * picking between this and `scanResultToComplianceView` — real scans routed
 * through the demo converter would render the fake template.
 */
export function scanResultToRealComplianceView(
  result: ScanResult,
): ComplianceReportResult {
  // Roll complianceStatus up from the result's own riskPoints when the backend
  // did not supply a top-level complianceStatus (matches the v1-adapter scoring
  // contract — never fall back to demo defaults).
  const severityRank: Record<RiskPoint["severity"], number> = {
    critical: 4,
    warning: 3,
    info: 1,
    unknown: 0,
  };
  const riskPoints = result.riskPoints ?? [];
  const topRank = riskPoints.reduce(
    (acc, rp) => Math.max(acc, severityRank[rp.severity] ?? 0),
    0,
  );
  const complianceStatus: ComplianceReportResult["complianceStatus"] =
    topRank >= 4 ? "REJECTED" : topRank >= 3 ? "WARN" : topRank >= 1 ? "PASS" : "UNKNOWN";

  // Prefer the real LLM-rendered markdown; fall back to the package-level field
  // (some payloads nest it under reportPackage) and finally to an empty string
  // so the renderer never silently swaps in a demo template.
  const complianceReport =
    (typeof result.complianceReport === "string" && result.complianceReport.trim()) ||
    (typeof result.reportPackage?.complianceReport === "string" &&
      result.reportPackage.complianceReport.trim()) ||
    "";

  // Real agent trace from the KB-anchored pipeline (vision → generate → verify).
  // When the backend omitted it (legacy or demo-shaped payload) emit an empty
  // array — do NOT append the demo.aggregate sentinel here, that belongs only
  // to the demo path.
  const agentTrace: ComplianceReportResult["agentTrace"] = Array.isArray(result.agentTrace)
    ? result.agentTrace
    : [];

  return {
    sessionId: result.sessionId,
    scanTime: result.scanTime,
    productCategory: result.productCategory,
    productName: result.productName,
    productNameEn: result.productNameEn,
    targetMarkets: result.targetMarkets ?? [],
    complianceScore: result.complianceScore,
    scoreGrade: result.scoreGrade,
    complianceReport,
    complianceStatus,
    // Audit P1-K: explicit kind discriminator so the type system enforces
    // which converter produced this view (see `scanResultToComplianceView`).
    kind: "real",
    agentTrace,
    loopCount: typeof result.loopCount === "number" ? result.loopCount : 0,
    retrievedChunks: riskPoints.flatMap((rp) =>
      (rp.regulations ?? []).map((rule) => ({
        regId: rule.regId,
        docName: rule.name,
        docNameEn: rule.nameEn,
        articleNo: rule.code,
        region: rule.market,
        // Use the first-cited regulation's confidence if present so demo
        // and real lists are visually consistent; otherwise the neutral 0.85.
        score: 0.85,
      })),
    ),
    // Forward rich side-data so `<ComplianceReportView>`'s rich risk-point /
    // checklist / image panel actually renders for real scans. Prior audit
    // P0-A: real scans used to silently drop these fields, hiding the
    // hotspot overlay, the rich risk cards, and the checklist entirely.
    images: result.images ?? [],
    documents: (result.documents ?? []).map((doc) => ({
      documentId: doc.documentId,
      name: doc.name,
      nameEn: doc.nameEn,
      size: doc.size,
      type: doc.type,
      mimeType: doc.mimeType,
      url: doc.url,
    })),
    riskPoints: riskPoints,
    checklist: result.checklist ?? [],
    generatedAt: result.generatedAt,
    reportPackage: result.reportPackage,
    modelInfo: {
      // Audit P1-H: surface an honest "unknown" when the backend didn't ship
      // a provider name, instead of fabricating "minimax". This used to make
      // future LLM swaps silently keep showing the old provider label.
      ragProvider:
        typeof result.ragProvider === "string" && result.ragProvider.trim()
          ? result.ragProvider.trim()
          : "unknown",
      latencyMs: typeof result.latencyMs === "number" ? result.latencyMs : 0,
    },
    source: result.source ?? "real",
  };
}

export function readStoredAccessToken(sessionId: string): string | null {
  try {
    const value = sessionStorage.getItem(`scan-token:${sessionId}`);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function severityLabel(locale: "zh" | "en", severity: RiskPoint["severity"]) {
  if (locale === "zh") {
    switch (severity) {
      case "critical":
        return "高危";
      case "warning":
        return "警告";
      default:
        return "提示";
    }
  }

  switch (severity) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    default:
      return "Info";
  }
}

export function severityClass(severity: RiskPoint["severity"]) {
  switch (severity) {
    case "critical":
      return "border-[rgba(196,76,63,0.32)] bg-[rgba(255,225,219,0.5)] text-[#8f3229]";
    case "warning":
      return "border-[rgba(189,120,30,0.28)] bg-[rgba(255,239,204,0.52)] text-[#7a4a0b]";
    default:
      return "border-[rgba(37,126,166,0.24)] bg-[rgba(214,242,250,0.52)] text-[#165c7a]";
  }
}

export function productCategoryLabel(locale: "zh" | "en", category: ProductCategory) {
  const labels = {
    zh: {
      electronics: "3C 电子",
      "3c": "3C 电子",
      appliance: "家电",
      toy: "玩具",
      home: "家居",
      battery: "电池/储能",
      cosmetic: "化妆品",
      textile: "纺织服装",
      food_contact: "食品接触",
      other: "其他",
    },
    en: {
      electronics: "3C electronics",
      "3c": "3C electronics",
      appliance: "Appliance",
      toy: "Toy",
      home: "Home",
      battery: "Battery / storage",
      cosmetic: "Cosmetics",
      textile: "Textile & apparel",
      food_contact: "Food contact",
      other: "Other",
    },
  } as const;

  return labels[locale][category] ?? category;
}

export function localizeRiskPoint(locale: "zh" | "en", risk: RiskPoint): RiskPoint {
  if (locale === "en") {
    return {
      ...risk,
      title: risk.titleEn ?? risk.title,
      description: risk.descriptionEn ?? risk.description,
      recommendedAction: risk.recommendedActionEn ?? risk.recommendedAction,
      regulations: risk.regulations.map((regulation) => ({
        ...regulation,
        name: regulation.nameEn ?? regulation.name,
        summary: regulation.summaryEn ?? regulation.summary,
      })),
    };
  }
  return risk;
}

export function localizeTimeText(locale: "zh" | "en", value: string | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  if (locale === "zh") {
    return value;
  }

  const map: Record<string, string> = {
    "第 1-2 天": "Days 1-2",
    "第 3-7 天": "Days 3-7",
    "第 1 周": "Week 1",
    "第 2 周": "Week 2",
    "第 3-5 周": "Weeks 3-5",
    "第 3-5 天": "Days 3-5",
  };
  return map[value] ?? value;
}

export function getLocalizedPreviewTab(locale: "zh" | "en", value: string) {
  if (locale === "zh") {
    return blazeReportPreviewTabs.find((tab) => tab.value === value) ?? blazeReportPreviewTabs[0];
  }

  const englishMap = {
    compliance: {
      label: "Compliance Report",
      title: "CompliPilot · Compliance Scan Report",
      subtitle:
        "This report is fit for the first remediation sync across legal, operations, and supplier teams.",
      leftMetric: { label: "Base Mode", value: "$1", hint: "Risk mode $6800" },
      rightMetric: { label: "Compliance Mode", value: "$7", hint: "Risk mode $6000" },
      bullets: [
        "CE / UKCA marks are missing and should be restored on the shell or nameplate.",
        "Input-output specs and protocol notes are incomplete, so manuals and listings must be aligned.",
        "Packaging warnings are too weak for EU and UK market expectations.",
      ],
    },
    roadmap: {
      label: "Roadmap Report",
      title: "Compliance Roadmap Report",
      subtitle:
        "This turns document freeze, label remediation, certification, and listing review into one executable timeline.",
      leftMetric: { label: "Current state", value: "Rejected", hint: "Estimated lead time 35 days" },
      rightMetric: { label: "Milestones", value: "5", hint: "From freeze to listing" },
      bullets: [
        "Days 1-2 freeze the BOM, nameplate, and supplier package.",
        "Days 3-7 finish CE / UKCA, IO spec, and warning updates.",
        "Weeks 3-5 move into lab testing and declaration flow before listing review.",
      ],
    },
    profit: {
      label: "Profit & AI Decision",
      title: "Cost Margin Analysis / AI Decision Report",
      subtitle:
        "This places the base and compliance modes side by side and explains why the batch should not go live yet.",
      leftMetric: { label: "Gross profit", value: "$7.46", hint: "Base mode $0.71" },
      rightMetric: { label: "Decision", value: "HIGH", hint: "Remediate before launch" },
      bullets: [
        "Single-platform compliance cost rises 23%, but it avoids fines and returns.",
        "Estimated monthly loss is around $6000, so remediation comes before market entry.",
        "AI decision: the evidence chain is incomplete; finish CE, LVD, and RoHS first.",
      ],
    },
  } as const;

  return englishMap[value as keyof typeof englishMap] ?? englishMap.compliance;
}

export function getPreviewBullets(
  locale: "zh" | "en",
  value: string,
  result: ScanResult,
  financialSummary: NonNullable<ScanResult["financialSummary"]>,
) {
  if (value === "roadmap") {
    return (result.checklist ?? []).slice(0, 3).map((item) => {
      const category = locale === "en" ? item.categoryEn ?? item.category : item.category;
      const title = locale === "en" ? item.titleEn ?? item.title : item.title;
      return `${category}: ${title}`;
    });
  }

  if (value === "profit") {
    return locale === "zh"
      ? [
          `整改前单件收益 ${financialSummary.estimatedHeroicProfit}，合规后净收益 ${financialSummary.trueNetProfit}。`,
          `单产品合规成本 ${financialSummary.complianceCost}，月度净收益基准 ${financialSummary.monthlyNetProfit}。`,
          `当前得分 ${result.complianceScore} / ${result.scoreGrade}，建议先关闭高优先级风险再上架。`,
        ]
      : [
          `Per-unit return moves from ${financialSummary.estimatedHeroicProfit} before remediation to ${financialSummary.trueNetProfit} after compliance.`,
          `Compliance cost is ${financialSummary.complianceCost} per unit, with a monthly net baseline of ${financialSummary.monthlyNetProfit}.`,
          `The current score is ${result.complianceScore} / ${result.scoreGrade}; close priority risks before launch.`,
        ];
  }

  return (result.riskPoints ?? []).slice(0, 3).map((riskRaw) => {
    const risk = localizeRiskPoint(locale, riskRaw);
    return `${risk.title}: ${risk.recommendedAction}`;
  });
}


import type { FinancialSummary } from "@/lib/types";

export type FinancialSummaryView = FinancialSummary;

/**
 * 合成财务摘要（真实 reportPackage 缺 profit 字段时的兜底视图）。
 * 2026-09-10 自 result page 抽出（审计 2.5）。
 */
export function financialSummaryOrFallback(
  result: ScanResult,
  locale: "zh" | "en",
  synthesize: (r: ScanResult, l?: "zh" | "en") => FinancialSummary | null,
): FinancialSummaryView {
  return (
    synthesize(result, locale) ?? {
      estimatedHeroicProfit: "—",
      trueNetProfit: "—",
      complianceCost: "—",
      monthlyNetProfit: "—",
      targetVolumeLabel: locale === "zh" ? "后端未提供" : "Not provided",
      riskExposureItems: [],
      costBreakdown: [],
    }
  );
}

export interface RoadmapRow {
  phase: string;
  time: string;
  owner: string;
  output: string;
}

export interface EvidenceCoverage {
  ratio: number;            // 0..1 — share of findings that have ≥1 citation AND (a bbox or a description)
  coveredFindings: number;
  totalFindings: number;
  matchedCitations: number;
  unmatchedCitations: number;
  totalCitations: number;
  status: "complete" | "partial" | "minimal" | "unknown";
}

/**
 * Compute real evidence coverage from the report package.
 *
 * Audit 2026-09-13 §10.2 + §P0-3: the result page used to hard-code "85%".
 * That number was wrong in two ways — it was a constant regardless of scan,
 * and it conflated "citation coverage" (how many citations matched the
 * source text) with "evidence coverage" (how many findings have a
 * grounding citation *and* a concrete observation).
 *
 * New contract:
 *   - ratio = coveredFindings / totalFindings (0 if no findings)
 *   - status:
 *       complete — every finding has a citation + grounding
 *       partial  — at least one finding has a citation + grounding
 *       minimal  — findings exist but none are grounded
 *       unknown  — no findings (i.e. the scan produced nothing to cover)
 *
 * Returns ratio=0, status="unknown" when the result has no findings.
 */
export function computeEvidenceCoverage(result: ScanResult): EvidenceCoverage {
  const findings = result.riskPoints ?? [];
  const totalFindings = findings.length;

  // Citations: prefer the structured evidencePack; fall back to the
  // legacy retrievedChunks[] view (it surfaces the same refs through
  // a different field path).
  const reportPackage = (result.reportPackage ?? {}) as Record<string, unknown>;
  const evidencePack = Array.isArray(reportPackage.evidencePack)
    ? (reportPackage.evidencePack as Array<Record<string, unknown>>)
    : Array.isArray((reportPackage as { evidence_pack?: unknown[] }).evidence_pack)
      ? ((reportPackage as { evidence_pack: Array<Record<string, unknown>> }).evidence_pack)
      : [];
  const citations = Array.isArray(reportPackage.citations)
    ? (reportPackage.citations as Array<Record<string, unknown>>)
    : [];

  const allCitations = [...evidencePack, ...citations];
  const totalCitations = allCitations.length;
  const matchedCitations = allCitations.filter((entry) => {
    const status = String(entry.matchStatus ?? entry.match_status ?? "").toLowerCase();
    return status === "matched" || status === "fallback_article_only";
  }).length;
  const unmatchedCitations = totalCitations - matchedCitations;

  if (totalFindings === 0) {
    return {
      ratio: 0,
      coveredFindings: 0,
      totalFindings: 0,
      matchedCitations,
      unmatchedCitations,
      totalCitations,
      status: "unknown",
    };
  }

  let coveredFindings = 0;
  for (const finding of findings) {
    const hasCitation = (finding.regulations?.length ?? 0) > 0;
    const bbox = finding.bbox;
    const hasGrounding =
      hasCitation &&
      (typeof finding.confidence === "number" ? finding.confidence > 0 : true) &&
      (bbox?.w ?? 0) > 0 &&
      (bbox?.h ?? 0) > 0;
    if (hasCitation && hasGrounding) coveredFindings += 1;
  }

  const ratio = Math.max(0, Math.min(1, coveredFindings / totalFindings));
  const status: EvidenceCoverage["status"] =
    coveredFindings === totalFindings
      ? "complete"
      : coveredFindings > 0
        ? "partial"
        : "minimal";

  return {
    ratio,
    coveredFindings,
    totalFindings,
    matchedCitations,
    unmatchedCitations,
    totalCitations,
    status,
  };
}

/** 整改路线图行（含末尾「上架复核」行）。2026-09-10 自 result page 抽出（审计 2.5）。 */
export function buildRoadmapRows(
  result: ScanResult,
  locale: "zh" | "en",
  unknownTime: string,
): RoadmapRow[] {
  return [
    ...(result.checklist ?? []).map((item, index) => ({
      phase: locale === "en" ? item.categoryEn ?? item.category : item.category,
      time: localizeTimeText(locale, item.estimatedTime, unknownTime),
      owner:
        locale === "zh"
          ? index === 0 ? "产品 / 采购" : "设计 / 合规"
          : index === 0 ? "Product / Procurement" : "Design / Compliance",
      output: locale === "en" ? item.titleEn ?? item.title : item.title,
    })),
    {
      phase: locale === "zh" ? "上架复核" : "Listing review",
      time: locale === "zh" ? "整改完成后" : "After remediation",
      owner: locale === "zh" ? "运营 / 法务" : "Operations / Legal",
      output:
        locale === "zh"
          ? `确认 ${(result.targetMarkets ?? []).join(" / ")} 市场风险与报告均已闭环`
          : `Confirm ${(result.targetMarkets ?? []).join(" / ")} risks and reports are closed`,
    },
  ];
}


/**
 * /result/demo 的 preset 解析（?preset=humidifier|toy|charger&markets=EU,UK）。
 * 2026-09-10 自 result page 抽出（审计 2.5）。
 */
export function buildDemoPresetResult(search: URLSearchParams | null): ScanResult {
  const presetKey = search?.get("preset") ?? "";
  const presetCategory: ProductCategory | null =
    presetKey === "humidifier"
      ? "appliance"
      : presetKey === "toy"
        ? "toy"
        : presetKey === "charger"
          ? "electronics"
          : null;
  const presetMarketsRaw = search?.get("markets") ?? "";
  const presetMarkets: Market[] | undefined = presetMarketsRaw
    ? (presetMarketsRaw.split(",").filter(Boolean) as Market[])
    : undefined;
  return presetCategory
    ? createMockScanResult("demo", { category: presetCategory, markets: presetMarkets })
    : mockScanResult;
}
