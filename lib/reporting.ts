import { createMockScanResult } from "@/lib/mock/scan-result";
import { getSession } from "@/lib/pipeline/session-store";
import type { ChecklistItem, RegulationRef, RiskPoint, ScanResult } from "@/lib/types";

export type BlazeReportType = "compliance" | "roadmap" | "profit";
export type BlazeExportFormat = "md" | "csv" | "pdf" | "docx";
export type BlazeReportLocale = "zh" | "en";

export function getResultForReport(
  sessionId: string,
  backendResult?: ScanResult,
): ScanResult | null {
  if (backendResult) {
    return backendResult;
  }
  if (sessionId === "demo") {
    return createMockScanResult("demo");
  }

  const session = getSession(sessionId);
  const result = session?.result;
  if (!result || !("riskPoints" in result) || !Array.isArray(result.riskPoints)) {
    return null;
  }
  return result as ScanResult;
}

export function getDefaultFormat(reportType: BlazeReportType): BlazeExportFormat {
  if (reportType === "roadmap") {
    return "csv";
  }
  return "md";
}

function marketList(result: ScanResult) {
  return result.targetMarkets.join(" / ");
}

export function localizeRegulation(regulation: RegulationRef, locale: BlazeReportLocale) {
  if (locale === "en") {
    return {
      ...regulation,
      name: regulation.nameEn ?? regulation.name,
      summary: regulation.summaryEn ?? regulation.summary,
    };
  }
  return regulation;
}

export function localizeRisk(risk: RiskPoint, locale: BlazeReportLocale) {
  if (locale === "en") {
    return {
      ...risk,
      title: risk.titleEn ?? risk.title,
      description: risk.descriptionEn ?? risk.description,
      recommendedAction: risk.recommendedActionEn ?? risk.recommendedAction,
      regulations: risk.regulations.map((regulation) => localizeRegulation(regulation, locale)),
    };
  }
  return risk;
}

export function localizeChecklist(item: ChecklistItem, locale: BlazeReportLocale) {
  if (locale === "en") {
    return {
      ...item,
      category: item.categoryEn ?? item.category,
      title: item.titleEn ?? item.title,
      requiredMaterials: item.requiredMaterialsEn ?? item.requiredMaterials,
    };
  }
  return item;
}

export function localizeResult(result: ScanResult, locale: BlazeReportLocale): ScanResult {
  if (locale === "en") {
    return {
      ...result,
      productName: result.productNameEn ?? result.productName,
      riskPoints: result.riskPoints.map((risk) => localizeRisk(risk, locale)),
      checklist: result.checklist.map((item) => localizeChecklist(item, locale)),
    };
  }
  return result;
}

export function buildComplianceReport(result: ScanResult, locale: BlazeReportLocale) {
  const localized = localizeResult(result, locale);

  if (locale === "en") {
    return `# CompliPilot · Compliance Scan Report

Product name: ${localized.productName ?? "Untitled product"}
Target markets: ${marketList(localized)}
Compliance score: ${localized.complianceScore} / ${localized.scoreGrade}
Generated at: ${localized.generatedAt}

## Core findings

${localized.riskPoints
  .map((risk, index) => `${index + 1}. ${risk.title} - ${risk.description}`)
  .join("\n")}

## Regulatory citations

${localized.riskPoints
  .flatMap((risk) =>
    risk.regulations.map(
      (regulation) =>
        `- ${regulation.market} · ${regulation.code} · ${regulation.name}: ${regulation.summary}`
    )
  )
  .join("\n")}

## Recommended remediation actions

${localized.riskPoints
  .map(
    (risk) =>
      `- ${risk.title}: ${risk.recommendedAction}${risk.estimatedFixCost ? ` (Estimated ${risk.estimatedFixCost})` : ""}`
  )
  .join("\n")}
`;
  }

  return `# 规航AI · 合规扫描报告

产品名称: ${localized.productName ?? "未命名产品"}
目标市场: ${marketList(localized)}
当前合规得分: ${localized.complianceScore} / ${localized.scoreGrade}
生成时间: ${localized.generatedAt}

## 核心结论

${localized.riskPoints
  .map((risk, index) => `${index + 1}. ${risk.title} - ${risk.description}`)
  .join("\n")}

## 重点法规引用

${localized.riskPoints
  .flatMap((risk) =>
    risk.regulations.map(
      (regulation) =>
        `- ${regulation.market} · ${regulation.code} · ${regulation.name}: ${regulation.summary}`
    )
  )
  .join("\n")}

## 推荐整改动作

${localized.riskPoints
  .map(
    (risk) =>
      `- ${risk.title}: ${risk.recommendedAction}${risk.estimatedFixCost ? ` (预计 ${risk.estimatedFixCost})` : ""}`
  )
  .join("\n")}
`;
}

export function buildRoadmapCsv(result: ScanResult, locale: BlazeReportLocale) {
  const localized = localizeResult(result, locale);
  if (locale === "en") {
    const rows = [
      ["Phase", "Action", "Output", "Note"],
      ["Document freeze", "Collect specification, BOM, nameplate, and supplier files", "Base product package", localized.productName ?? ""],
      ["Label remediation", "Restore CE/UKCA, IO specs, and warning copy", "Shell and packaging artwork", marketList(localized)],
      ["Risk review", "Confirm hotspot and citation closure", "Risk summary", `${localized.riskPoints.length} hotspots`],
      ["Formal certification", "Enter lab testing and DoC flow", "Test and declaration files", "Recommended week 3-5"],
      ["Listing review", "Align listing, hero image, and manual", "Launch package", "Only enter the market after closure"],
    ];
    return rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
  }

  const rows = [
    ["阶段", "动作", "输出", "备注"],
    ["资料冻结", "整理规格书、BOM、铭牌与供应商资料", "产品基础资料包", localized.productName ?? ""],
    ["标签整改", "补齐 CE/UKCA、输入输出规格和警示语", "外壳与包装图稿", marketList(localized)],
    ["风险复核", "确认风险点与法规引用是否闭环", "风险总表", `${localized.riskPoints.length} 个热点`],
    ["正式认证", "进入实验室测试与 DoC 流程", "测试与声明文件", "建议第 3-5 周"],
    ["上架复核", "同步 Listing / 主图 / 说明书", "上架资料", "完成后再进目标市场"],
  ];

  return rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

export function buildProfitReport(result: ScanResult, locale: BlazeReportLocale) {
  const localized = localizeResult(result, locale);
  const totalCritical = localized.riskPoints.filter((risk) => risk.severity === "critical").length;
  const totalWarning = localized.riskPoints.filter((risk) => risk.severity === "warning").length;

  if (locale === "en") {
    return `# CompliPilot · Compliance Cost Impact / AI Decision Report

Product name: ${localized.productName ?? "Untitled product"}
Target markets: ${marketList(localized)}
Risk mix: ${totalCritical} critical / ${totalWarning} warning

## Decision summary

- Current compliance score ${localized.complianceScore} / ${localized.scoreGrade}
- Do not launch into target markets before the certification, label, and manual chain is closed
- Finish the top 3 hotspot fixes before entering the formal certification stage

## Cost and profit hints

- Estimated heroic margin: ¥27 / unit
- Real profit after compliance: ¥12 / unit
- Per-platform compliance cost: ¥15 / unit
- Estimated monthly loss: ¥12000

## Why remediation comes first

${localized.riskPoints
  .map(
    (risk) =>
      `- ${risk.title}: ${risk.recommendedAction}${risk.estimatedFixCost ? `, estimated ${risk.estimatedFixCost}` : ""}`
  )
  .join("\n")}
`;
  }

  return `# 规航AI · 合规成本影响 / AI 决策报告

产品名称: ${localized.productName ?? "未命名产品"}
目标市场: ${marketList(localized)}
风险结构: 高危 ${totalCritical} 个 / 警告 ${totalWarning} 个

## 决策摘要

- 当前合规得分 ${localized.complianceScore} / ${localized.scoreGrade}
- 在关键认证、标签和说明链路闭环前，不建议直接上架目标市场
- 建议先完成 ${localized.riskPoints
    .slice(0, 3)
    .map((risk) => risk.title)
    .join("、")} 的整改

## 成本与利润提示

- 神勇出海预估利润: ¥27 / 件
- 合规后真实利润: ¥12 / 件
- 单平台合规成本: ¥15 / 件
- 预估月损失利润: ¥12000

## 为什么先整改

${localized.riskPoints
  .map(
    (risk) =>
      `- ${risk.title}: ${risk.recommendedAction}${risk.estimatedFixCost ? `，预计成本 ${risk.estimatedFixCost}` : ""}`
  )
  .join("\n")}
`;
}

export function getTextReportPayload(
  reportType: BlazeReportType,
  result: ScanResult,
  format: BlazeExportFormat,
  locale: BlazeReportLocale
) {
  switch (reportType) {
    case "compliance":
      if (format !== "md") {
        throw new Error("Compliance report text export only supports md.");
      }
      return {
        body: buildComplianceReport(result, locale),
        filename: `ComplianceReport_${result.sessionId}.md`,
        contentType: "text/markdown; charset=utf-8",
      };
    case "roadmap":
      if (format !== "csv") {
        throw new Error("Roadmap report text export only supports csv.");
      }
      return {
        body: buildRoadmapCsv(result, locale),
        filename: `ComplianceRoadmap_${result.sessionId}.csv`,
        contentType: "text/csv; charset=utf-8",
      };
    case "profit":
      if (format !== "md") {
        throw new Error("Profit report text export only supports md.");
      }
      return {
        body: buildProfitReport(result, locale),
        filename: `CostProfitAnalysis_${result.sessionId}.md`,
        contentType: "text/markdown; charset=utf-8",
      };
  }
}

export function getBinaryFilename(reportType: BlazeReportType, result: ScanResult, format: "pdf" | "docx") {
  const prefix =
    reportType === "compliance"
      ? "ComplianceReport"
      : reportType === "roadmap"
        ? "ComplianceRoadmap"
        : "CostProfitAnalysis";
  return `${prefix}_${result.sessionId}.${format}`;
}
