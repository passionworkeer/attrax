import { createMockScanResult as createBlazeMockScanResult, mockScanResult as blazeMockScanResult } from "@/lib/mock/blaze-scan-result";
import type { ChecklistItem, ProductCategory, RegulationRef, RiskPoint, ScanResult } from "@/lib/types";

export type BlazeReportType = "compliance" | "roadmap" | "profit";
export type BlazeExportFormat = "md" | "csv" | "pdf" | "docx";
export type BlazeReportLocale = "zh" | "en";

function presetCategoryFromKey(key: string | null | undefined): ProductCategory | null {
  switch (key) {
    case "humidifier":
      return "appliance";
    case "toy":
      return "toy";
    case "charger":
      return "electronics";
    default:
      return null;
  }
}

/**
 * Returns the scan result for the given session, used by the report export
 * pipeline. The `demo` session always resolves to the Blaze Hawks "65W 充电宝"
 * product (the home-page scenario) — *not* the legacy USB 加湿器 fallback —
 * so the data the user sees on `/result/demo` matches what the export API
 * returns.
 *
 * Non-demo sessions fall back to the USB 加湿器 result only when the
 * production scan service has not produced one yet, since that helper is the
 * single source of truth for backend-down fallback packages.
 */
export function getResultForReport(
  sessionId: string,
  backendResult?: ScanResult,
  options: { preset?: string | null } = {},
): ScanResult | null {
  if (backendResult) {
    return backendResult;
  }
  if (sessionId === "demo") {
    // /result/demo page uses the same object, so the page and the /api/report
    // export describe identical content. The Blaze result carries the demo
    // product image, 65W charger risk profile, and full cost/financial
    // summary that the profit PDF builder expects.
    //
    // Mid-2026-07:`?preset=charger|humidifier|toy` query 切到不同 scenario
    // (electronics / appliance / toy),共用 5 个 scenarioMap 里的 baseScore
    // 与 financialSummary 子集;无 query 时保留 65W 充电器为默认(向后兼容
    // /result/demo 的现有书签)。
    const presetCategory = presetCategoryFromKey(options.preset ?? null);
    if (presetCategory) {
      return createBlazeMockScanResult("demo", { category: presetCategory }) ?? blazeMockScanResult;
    }
    return createBlazeMockScanResult("demo") ?? blazeMockScanResult;
  }

  // Non-demo sessions: production scans are owned by the RAG service and
  // already return their result via the backendResult argument above. If no
  // backend result was provided, fall through to 404 (return null) rather
  // than resurrecting the legacy local session store.
  return null;
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

  // Demo path (homepage /result/demo "65W 充电宝"): 走一份独立预制的
  // 中文 markdown,而不是 riskPoints 拼出来的——后者太碎片,导出后不是
  // 用户在前端看到的同一份合规叙述。判定条件:`sessionId === "demo"`
  // 且用的是 Blaze Hawks electronics 场景(productName 以 "ZGA" 开头)。
  const isDemoCharger = result.sessionId === "demo" && /^ZGA/.test(localized.productName ?? "");
  if (isDemoCharger) {
    // 注意运算符优先级:`.replace` (17) 高于 `?:` (4)。之前写成
    // `locale === "en" ? EN : ZH.replace(...)` 时整条 replace 链只绑定到 ZH,
    // EN 分支直接返回带 {{PRODUCT}}/{{SCORE}} 等占位符的原模板(废文本)。
    // 先选模板再统一替换,两分支都走占位符填充。
    const demoTpl = locale === "en" ? DEMO_CHARGER_REPORT_EN : DEMO_CHARGER_REPORT_ZH;
    return demoTpl
      .replace("{{PRODUCT}}", localized.productName ?? "ZGA 便携式充电器")
      .replace("{{MARKETS}}", marketList(localized))
      .replace("{{SCORE}}", String(localized.complianceScore))
      .replace("{{GRADE}}", localized.scoreGrade)
      .replace("{{GENERATED_AT}}", localized.generatedAt)
      .replace("{{RULES}}", localized.riskPoints
        .map((risk, index) => `${index + 1}. ${risk.title} — ${risk.description}\n   · 证据: ${risk.regulations.map((r) => `${r.market}·${r.code}`).join(" / ")}\n   · 整改: ${risk.recommendedAction}${risk.estimatedFixCost ? ` (预计 ${risk.estimatedFixCost})` : ""}`)
        .join("\n\n"));
  }

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

/**
 * Demo-specific 合规章 markdown。
 *
 * 与 handoff 设计稿的"65W 快充充电器"介绍文案对齐(CopliPilot 设计稿 §3.4
 * 「合规检测报告」章节),针对 home-page /result/demo 路径上的 65W 充电宝产品,
 * 复用 `localized.riskPoints` 给出实际抓到的 `CE / UKCA 标志缺失` 风险作为
 * 段落证据,而不是泛泛的扫描输出。这份 markdown:
 *
 * - 会被 `/api/report/demo/compliance?format=md` 路由直接吐给浏览器下载
 * - 会被 `<ComplianceReportView>` 渲染在 `/result/demo` 页面 §证据之后
 * - 会被 `downloadReportAsPdf` / `downloadReportAsDocx` 客户端下载
 *
 * 设计选择:把它放在 reporting.ts 而非 lib/mock/blaze-scan-result.ts,因为
 * reporting.ts 已经有 zh/en 的接口约定 + `localizeResult()` 工具链;将来
 * 一旦生产 RAG 出 65W 充电宝这种报告,函数签名无需大改。
 */
const DEMO_CHARGER_REPORT_ZH = `# 规航AI · 合规扫描报告 · 充电宝原型 (65W)

> 本报告针对产品 **{{PRODUCT}}**(65W GaN USB-PD 快充)的目标市场
> **{{MARKETS}}** 给出端到端的合规风险评估与整改路径。
> 报告基于以下 3 张产品图片(正面 / 侧面 / 包装)的多模态识别结果,
> 并联动了欧盟 + 英国两级法规知识库(CE-RED / LVD / EMC / RoHS /
> GPSR / UKCA / EMC-2016 / EPR)。

## 1. 总体判断

- **合规等级**: {{SCORE}} / {{GRADE}}
- **结论**: 当前状态 **不建议直接上架** {{MARKETS}}。在 CE 标志、铭牌信息、
  包装多语言警示与平台审核资料四项闭环之前,进入欧盟/英国销售会同时触发
  平台审核拒绝 + 海关扣留 + 抽检召回三种风险链路。
- **整改成本**: 单产品合规成本约 ¥64.50,占当前售价约 8%;整改后月度净利
  基准 ¥18,000(3,000 台/月销量)。

## 2. 关键风险与法规引用

{{RULES}}

## 3. 整改路线图概览

| 阶段 | 时间 | 关键产出 | 责任方 |
| --- | --- | --- | --- |
| 资料冻结 | 第 1-2 天 | 规格书 / BOM / 适配器规格 / 外壳材料锁定 | 产品 / 采购 |
| 标签包装整改 | 第 3-7 天 | 铭牌 CE/UKCA 标志、说明书多语言警示、回收标识 | 设计 / 合规 |
| LVD / EMC 预扫 | 第 1-2 周 | 温升 / 跌落 / 异常工作 / 防水结构报告 | 实验室 |
| 正式认证 | 第 3-5 周 | CE 技术文件包、DoC、RoHS/REACH 报告 | 实验室 / 合规 |
| 上架复核 | 第 5 周 | listing 文案 / 主图 / 证书归档 / EPR 编号 | 运营 / 法务 |

## 4. 一句话行动建议

在欧盟责任人信息 + UKCA 标志 + 多语言警告语三件事全部闭环之前,只开放小
批量测试渠道,主站 listing 暂时不上。完整闭环后,合规后单件净利约 ¥7.46,
月度净利基准约 ¥18,000,可作为上架决策的最终核算依据。

---
报告生成时间: {{GENERATED_AT}}
合规评分体系: 满分 100,A≥85 / B≥70 / C≥55 / D<55
`;

const DEMO_CHARGER_REPORT_EN = `# CompliPilot · Compliance Scan Report — 65W Charger (Demo)

> This report evaluates **{{PRODUCT}}** (65W GaN USB-PD fast charger) for the target markets **{{MARKETS}}**, based on multimodal analysis of 3 product images (front, side, packaging) and a two-level EU + UK regulation corpus (CE-RED / LVD / EMC / RoHS / GPSR / UKCA / EMC-2016 / EPR).

## 1. Headline

- **Score**: {{SCORE}} / {{GRADE}}
- **Verdict**: Do **not** launch into {{MARKETS}} yet. Until CE marks, nameplate data, multilingual packaging warnings, and listing evidence are closed, EU/UK market entry will trip listing rejection, customs hold, and recall channels in parallel.
- **Remediation cost**: per-unit compliance cost ≈ ¥64.50 (~8% of selling price); post-remediation monthly net baseline ¥18,000 (3,000 units/month).

## 2. Risk and citations

{{RULES}}

## 3. Remediation timeline (see full roadmap report)

| Phase | Window | Deliverable | Owner |
| --- | --- | --- | --- |
| Document freeze | Days 1-2 | Spec / BOM / adapter / shell material | Product / Procurement |
| Label & packaging remediation | Days 3-7 | Nameplate CE/UKCA marks, multilingual warnings, recycling mark | Design / Compliance |
| LVD / EMC pre-scan | Weeks 1-2 | Temperature-rise / drop / abnormal / waterproof report | Lab |
| Formal certification | Weeks 3-5 | CE tech file, DoC, RoHS/REACH | Lab / Compliance |
| Listing review | Week 5 | Listing copy / hero image / cert archive / EPR ID | Ops / Legal |

## 4. One-line action

Hold the main listing; gate only low-volume test channels until EU responsible person + UKCA + multilingual warnings are all closed. After closure, per-unit net ≈ ¥7.46, monthly net baseline ≈ ¥18,000.

---
Generated at: {{GENERATED_AT}}
Score scale: 100 max, A≥85 / B≥70 / C≥55 / D<55
`;

export function sanitizeCsvCell(cell: unknown): string {
  const str = String(cell ?? "");
  // Neutralize CSV formula injection: if cell starts with =, +, -, @, \t, \r, prefix with a single quote '
  const sanitized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${sanitized.replaceAll('"', '""')}"`;
}

export function buildRoadmapCsv(result: ScanResult, locale: BlazeReportLocale) {
  const localized = localizeResult(result, locale);
  const items = result.reportPackage?.roadmap?.items;

  if (items && items.length > 0) {
    if (locale === "en") {
      const headers = ["Index", "Title", "Description", "Estimated Days", "Cost", "Required Documents"];
      const rows = items.map((item, idx) => [
        String(idx + 1),
        item.titleEn ?? item.title_en ?? item.title ?? "",
        item.descriptionEn ?? item.description_en ?? item.description ?? "",
        item.estimatedDays != null ? `${item.estimatedDays} days` : (item.estimated_days != null ? `${item.estimated_days} days` : ""),
        item.cost ?? "",
        (item.documentsEn ?? item.documents_en ?? item.documents ?? []).join("; "),
      ]);
      return [headers, ...rows]
        .map((row) => row.map(sanitizeCsvCell).join(","))
        .join("\n");
    }

    const headers = ["序号", "事项", "描述", "预估耗时", "预估费用", "所需资料"];
    const rows = items.map((item, idx) => [
      String(idx + 1),
      item.title ?? item.titleEn ?? "",
      item.description ?? item.descriptionEn ?? "",
      item.estimatedDays != null ? `${item.estimatedDays} 天` : (item.estimated_days != null ? `${item.estimated_days} 天` : ""),
      item.cost ?? "",
      (item.documents ?? item.documentsEn ?? []).join("；"),
    ]);
    return [headers, ...rows]
      .map((row) => row.map(sanitizeCsvCell).join(","))
      .join("\n");
  }

  if (locale === "en") {
    const rows = [
      ["Phase", "Action", "Output", "Note"],
      ["Document freeze", "Collect specification, BOM, nameplate, and supplier files", "Base product package", localized.productName ?? ""],
      ["Label remediation", "Restore CE/UKCA, IO specs, and warning copy", "Shell and packaging artwork", marketList(localized)],
      ["Risk review", "Confirm hotspot and closure", "Risk summary", `${localized.riskPoints.length} hotspots`],
      ["Formal certification", "Enter lab testing and DoC flow", "Test and declaration files", "Recommended week 3-5"],
      ["Listing review", "Align listing, hero image, and manual", "Launch package", "Only enter the market after closure"],
    ];
    return rows
      .map((row) => row.map(sanitizeCsvCell).join(","))
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
    .map((row) => row.map(sanitizeCsvCell).join(","))
    .join("\n");
}

export function buildProfitReport(result: ScanResult, locale: BlazeReportLocale) {
  const localized = localizeResult(result, locale);
  const totalCritical = localized.riskPoints.filter((risk) => risk.severity === "critical").length;
  const totalWarning = localized.riskPoints.filter((risk) => risk.severity === "warning").length;
  const financial: ScanResult["financialSummary"] = localized.financialSummary;
  // Capture for the strict-mode narrowing inside the `if (isDemoCharger)` block.
  const summary: NonNullable<typeof financial> | undefined = financial ?? undefined;

  // 真实 RAG 路径:后端若返回了 profitReport.markdown(后端 LLM 生成的
  // 成本/利润叙述),优先透传 — 避免本地模板覆盖后端真实分析。
  const backendMarkdown = (result.reportPackage?.profitReport as { markdown?: string } | undefined)?.markdown;
  if (backendMarkdown && backendMarkdown.trim().length > 0 && !financial) {
    return backendMarkdown;
  }
  // 既无 financialSummary 也无 backend markdown:显式说明数据不可用,
  // 不要伪造金额(commit 3e5259e 删正则 fallback 后的兜底)。
  if (!financial && !backendMarkdown) {
    return locale === "en"
      ? `# CompliPilot · Compliance Cost Impact / AI Decision Report

Product name: ${localized.productName ?? "Untitled product"}
Target markets: ${marketList(localized)}
Risk mix: ${totalCritical} critical / ${totalWarning} warning

**Cost figures are not available for this session** — backend did not return structured financial fields. Re-run the scan with a clear selling price and target volume to populate the cost breakdown.
`
      : `# 规航AI · 合规成本影响 / AI 决策报告

产品名称: ${localized.productName ?? "未命名产品"}
目标市场: ${marketList(localized)}
风险结构: ${totalCritical} 个高危 / ${totalWarning} 个警告

**本会话的成本数字暂不可用** —— 后端未返回结构化财务字段。请提供明确的售价与目标销量后重新扫描,以补全成本拆解。
`;
  }

  // Demo 65W 充电宝专用 markdown:与合规章呼应,直接给出 BOM/包装/认证/EPR/
  // 物流单价与合规前后净利对比,而不是泛泛"财务数据"。和合规章走同一份
  // 设计稿口径,符合"同一产品同时给出合规 + 利润报告"的 handoff 期望。
  const isDemoCharger = result.sessionId === "demo" && /^ZGA/.test(localized.productName ?? "");
  if (isDemoCharger) {
    return locale === "en"
      ? `# CompliPilot · Cost Margin Analysis — 65W Charger (Demo)

Product name: ${localized.productName ?? "65W Fast Charger"}
Target markets: ${marketList(localized)}
Risk mix: ${totalCritical} critical / ${totalWarning} warning

## Decision summary

- Current compliance score ${localized.complianceScore} / ${localized.scoreGrade}
- Hold the listing until CE + LVD + RoHS evidence is closed; per-unit net improves from ${summary?.estimatedHeroicProfit ?? "—"} (barebone) to ${summary?.trueNetProfit ?? "—"} (compliant).
- Monthly net return baseline ${summary?.monthlyNetProfit ?? "—"}; do not enter the main listing before the top 3 hotspots close.

## Cost breakdown (per unit, CNY ¥)

| Item | Barebone | Compliant |
| --- | --- | --- |
| BOM (shell + PCB + battery) | ¥32.00 | ¥32.00 |
| Packaging (retail box + manual) | ¥3.00 | ¥5.50 |
| Certification (CE + UKCA + RoHS) | ¥0.00 | ¥18.00 |
| EPR + recycling mark | ¥0.00 | ¥4.00 |
| Logistics (lead time + last mile) | ¥18.50 | ¥18.50 |
| Warranty reserve | ¥4.30 | ¥7.50 |
| Platform commission | ¥12.40 | ¥12.40 |
| Compliance cost (cert + EPR + label) | ¥0.00 | ¥25.00 |
| **Total direct cost** | ¥70.20 | ¥122.90 |

Average selling price (ASP) ¥180; gross profit per unit barebone ≈ ¥109.80 (61.0%), after compliance ≈ ¥57.10 (31.7%). Volume baseline 3,000 units/month.

## Why remediation precedes listing

- Single-platform compliance cost rises ~75% per unit, but removes the tail risks of store suspension, seizure, and cross-border litigation (fine amounts depend on the violation and jurisdiction; no statute-backed figure is claimed in this demo).
- ${summary?.riskExposureItems?.length ?? 0} explicit risk exposures listed: ${(summary?.riskExposureItemsEn ?? summary?.riskExposureItems ?? []).join("; ")}.
- AI decision: ${totalCritical > 0 ? "evidence chain is incomplete — close the top " + Math.min(3, totalCritical) + " hotspots before the listing review window." : "compliance evidence is sufficient for an EU + UK launch campaign."}
`
      : `# 规航AI · 合规成本影响报告 · 充电宝原型 (65W)

产品名称: ${localized.productName ?? "65W 快充充电器"}
目标市场: ${marketList(localized)}
风险结构: 高危 ${totalCritical} 个 / 警告 ${totalWarning} 个
当前合规得分: ${localized.complianceScore} / ${localized.scoreGrade}

## 1. 决策摘要

- 当前合规得分 **${localized.complianceScore} / ${localized.scoreGrade}**
- 单件净利: 整改前 **${summary?.estimatedHeroicProfit ?? "—"}** → 合规后 **${summary?.trueNetProfit ?? "—"}**
- 单件合规成本: **${summary?.complianceCost ?? "—"}**(占当前 ASP 约 8%)
- 月度净利基准: **${summary?.monthlyNetProfit ?? "—"}**(销量基准 ${summary?.targetVolumeLabel ?? "3,000 台 / 月"})
- 整改策略: **先关闭 CE / UKCA / RoHS 三件事,再进 ${marketList(localized)} 主站 listing**
- 风险敞口: ${(summary?.riskExposureItems ?? []).join("；")}

## 2. 成本拆分(每件,CNY ¥)

| 成本项 | 裸机(Barebone) | 合规后(Compliant) |
| --- | --- | --- |
| 采购 BOM(壳料 + PCB + 电池) | ¥32.00 | ¥32.00 |
| 包装(彩盒 + 说明书) | ¥3.00 | ¥5.50 |
| 认证(CE + UKCA + RoHS) | ¥0.00 | ¥18.00 |
| EPR + 回收标识 | ¥0.00 | ¥4.00 |
| 物流(头程 + 尾程) | ¥18.50 | ¥18.50 |
| 保修预留 | ¥4.30 | ¥7.50 |
| 平台抽佣 | ¥12.40 | ¥12.40 |
| 合规总成本(认证 + EPR + 整改) | ¥0.00 | ¥25.00 |
| **单件总直接成本** | **¥70.20** | **¥122.90** |

按平均售价 ¥180 计算: 整改前毛利润约 ¥109.80(毛利率 61.0%);
合规后毛利润约 ¥57.10(毛利率 31.7%)。销量基准 3,000 台 / 月。

## 3. 盈亏平衡与定价策略

- 盈亏平衡: 整改前约 1,950 台 / 月即打平 BOM + 物流 + 抽佣;合规后抬高到
  约 2,580 台 / 月(因认证 / EPR / 保修预留拉高了固定成本门槛)。
- 定价策略: 单平台合规成本上升约 75%,但单件净利仍正向,建议保留 ¥180 基础
  售价,关键市场做"含税认证险"增值服务(¥15 / 单)以回收部分合规投入。
- 风险敞口拆解: 罚款金额取决于具体违法行为与辖区,本示例未提供适用罚则,不作数字估算;
  另含全店永久封停 / 货物强制扣毁 / 跨境集体诉讼三条尾部风险线。

## 4. 为什么先整改再上架

- 合规后每件净利下降约 ¥52,消除永久封停与货物扣押的尾部风险
  (罚款金额取决于违法行为与辖区,本示例不作数字估算)。
- 整改闭环完成后,listing 主图 / 资料审核 / 售后追溯可一次性放行,运营可
  把节省下来的"补交资料 + 申诉"时间投入增长策略。
- AI 结论: ${totalCritical > 0
    ? "证据链未闭环 — 建议先关闭前 " + Math.min(3, totalCritical) + " 项高危再进入上架复核窗口。"
    : "合规证据充分,可立即启动 EU + UK 上架战役。"}

---
报告生成时间: ${localized.generatedAt}
销量基准: ${summary?.targetVolumeLabel ?? "3,000 台 / 月"}
`;
  }

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

- Estimated pre-remediation return: ${financial?.estimatedHeroicProfit ?? "—"}
- Net return after compliance: ${financial?.trueNetProfit ?? "—"}
- Compliance cost: ${financial?.complianceCost ?? "—"}
- Monthly net return: ${financial?.monthlyNetProfit ?? "—"}

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

- 整改前预估收益: ${financial?.estimatedHeroicProfit ?? "—"}
- 合规后净收益: ${financial?.trueNetProfit ?? "—"}
- 合规成本: ${financial?.complianceCost ?? "—"}
- 月度净收益: ${financial?.monthlyNetProfit ?? "—"}

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
