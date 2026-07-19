import type {
  AppLocale,
  ChecklistItem,
  FinancialSummary,
  ImageAsset,
  Market,
  ProductCategory,
  RegulationRef,
  RiskPoint,
  ScanResult,
  ScoreGrade,
} from "@/lib/types";

type MockScanOptions = {
  category?: ProductCategory;
  markets?: Market[];
  imageCount?: number;
  locale?: AppLocale;
  imageUrls?: string[];
};

type RiskTemplate = Omit<RiskPoint, "riskId" | "regulations"> & {
  markets: Market[];
  regulations: RegulationRef[];
  titleEn: string;
  descriptionEn: string;
  recommendedActionEn: string;
};

type ChecklistTemplate = Omit<ChecklistItem, "itemId"> & {
  markets?: Market[];
};

type Scenario = {
  productName: string;
  productNameEn: string;
  productCategory: ProductCategory;
  baseScore: number;
  images: ImageAsset[];
  risks: RiskTemplate[];
  checklist: ChecklistTemplate[];
  financialSummary: FinancialSummary;
};

function buildScenarioImages(productImageUrl: string): ImageAsset[] {
  return [
    {
      imageId: "img_01",
      url: productImageUrl,
      thumbnail: productImageUrl,
      width: 1456,
      height: 1024,
      angleHint: "front",
    },
    {
      imageId: "img_02",
      url: productImageUrl,
      thumbnail: productImageUrl,
      width: 1456,
      height: 1024,
      angleHint: "side",
    },
    {
      imageId: "img_03",
      url: productImageUrl,
      thumbnail: productImageUrl,
      width: 1456,
      height: 1024,
      angleHint: "package",
    },
  ];
}

const scenarioImages = {
  electronics: buildScenarioImages("/mock-fixtures/preset-charger-photo.png"),
  appliance: buildScenarioImages("/mock-fixtures/preset-humidifier-photo.png"),
  toy: buildScenarioImages("/mock-fixtures/preset-toy-blocks-photo.png"),
  home: buildScenarioImages("/mock-fixtures/preset-humidifier-photo.png"),
  other: buildScenarioImages("/mock-fixtures/preset-charger-photo.png"),
} satisfies Record<Exclude<ProductCategory, "3c">, ImageAsset[]>;

const ELECTRONICS_FINANCIAL: FinancialSummary = {
  estimatedHeroicProfit: "¥0.71",
  trueNetProfit: "¥7.46",
  complianceCost: "¥64.50",
  monthlyNetProfit: "¥18,000",
  targetVolumeLabel: "3,000 台 / 月",
  targetVolumeLabelEn: "3,000 units / month",
  riskExposureItems: [
    "单日最高罚款 ¥180 万",
    "全店永久封停",
    "货物强制扣毁",
    "跨境集体诉讼",
  ],
  riskExposureItemsEn: [
    "Up to ¥1.8M daily fine",
    "Permanent store suspension",
    "Mandatory goods destruction",
    "Cross-border class action",
  ],
  costBreakdown: [
    {
      itemId: "cost_01",
      label: "采购 BOM",
      labelEn: "Procurement BOM",
      amount: "¥32.00",
      detail: "外壳、主板、电池与包装组件",
      detailEn: "Shell, motherboard, battery, and packaging",
    },
    {
      itemId: "cost_02",
      label: "物流头程",
      labelEn: "Logistics lead time",
      amount: "¥18.50",
      detail: "海外仓入仓与最后一公里",
      detailEn: "Overseas warehouse intake and last mile",
    },
    {
      itemId: "cost_03",
      label: "平台抽佣",
      labelEn: "Marketplace commission",
      amount: "¥12.40",
      detail: "主流跨境电商平台费率",
      detailEn: "Mainstream cross-border marketplace fee",
    },
    {
      itemId: "cost_04",
      label: "合规成本",
      labelEn: "Compliance cost",
      amount: "¥64.50",
      detail: "认证、标签、说明书与平台审核",
      detailEn: "Certification, labels, manuals, and marketplace review",
    },
    {
      itemId: "cost_05",
      label: "广告与营销",
      labelEn: "Ads and marketing",
      amount: "¥9.80",
      detail: "站内外广告与达人投放",
      detailEn: "On-site and off-site ads plus influencer",
    },
    {
      itemId: "cost_06",
      label: "退货与售后",
      labelEn: "Returns and after-sales",
      amount: "¥4.30",
      detail: "逆向物流、损耗与售后客服",
      detailEn: "Reverse logistics, shrinkage, and support",
    },
  ],
};

const APPLIANCE_FINANCIAL: FinancialSummary = {
  ...ELECTRONICS_FINANCIAL,
  estimatedHeroicProfit: "¥0.71",
  trueNetProfit: "¥9.20",
  complianceCost: "¥72.00",
  monthlyNetProfit: "¥22,500",
  riskExposureItems: [
    "召回与退货成本抬升",
    "平台抽检失败",
    "外箱回收标识不合规",
  ],
  riskExposureItemsEn: [
    "Recall and returns cost spikes",
    "Marketplace sampling failure",
    "Outer carton recycling mark non-compliance",
  ],
  costBreakdown: ELECTRONICS_FINANCIAL.costBreakdown.map((row, index) =>
    index === 0
      ? { ...row, amount: "¥44.00", detail: "机壳、电机、滤芯与包装", detailEn: "Casing, motor, filter, and packaging" }
      : index === 3
        ? { ...row, amount: "¥72.00", detail: "认证、说明书、回收标识", detailEn: "Certification, manuals, and recycling mark" }
        : row,
  ),
};

const TOY_FINANCIAL: FinancialSummary = {
  ...ELECTRONICS_FINANCIAL,
  estimatedHeroicProfit: "¥0.91",
  trueNetProfit: "¥6.40",
  complianceCost: "¥58.00",
  monthlyNetProfit: "¥12,800",
  riskExposureItems: [
    "儿童误用责任风险",
    "CPSIA 抽检失败",
    "欧盟玩具召回",
  ],
  riskExposureItemsEn: [
    "Child misuse liability",
    "CPSIA sampling failure",
    "EU toy recall",
  ],
  costBreakdown: ELECTRONICS_FINANCIAL.costBreakdown.map((row, index) =>
    index === 0
      ? { ...row, amount: "¥24.00", detail: "塑料外壳、涂装与包装", detailEn: "Plastic shell, paint, and packaging" }
      : index === 3
        ? { ...row, amount: "¥58.00", detail: "CPSIA、EN71 测试与警告语", detailEn: "CPSIA, EN71 testing, and warning labels" }
        : row,
  ),
};

const HOME_FINANCIAL: FinancialSummary = {
  ...ELECTRONICS_FINANCIAL,
  estimatedHeroicProfit: "¥1.10",
  trueNetProfit: "¥5.80",
  complianceCost: "¥46.00",
  monthlyNetProfit: "¥9,600",
  riskExposureItems: [
    "材料说明不足",
    "家居电器标签偏弱",
    "平台售后风险上升",
  ],
  riskExposureItemsEn: [
    "Insufficient material disclosure",
    "Weak home appliance labeling",
    "Rising marketplace after-sales risk",
  ],
  costBreakdown: ELECTRONICS_FINANCIAL.costBreakdown.map((row, index) =>
    index === 0
      ? { ...row, amount: "¥20.00", detail: "基础家居材料与包装", detailEn: "Basic home materials and packaging" }
      : index === 3
        ? { ...row, amount: "¥46.00", detail: "家具与材料检测", detailEn: "Furniture and material testing" }
        : row,
  ),
};

const OTHER_FINANCIAL: FinancialSummary = {
  ...ELECTRONICS_FINANCIAL,
  estimatedHeroicProfit: "¥0.50",
  trueNetProfit: "¥4.20",
  complianceCost: "¥52.00",
  monthlyNetProfit: "¥7,400",
  riskExposureItems: [
    "追溯信息不足",
    "标签不完整",
    "市场说明不一致",
  ],
  riskExposureItemsEn: [
    "Insufficient traceability",
    "Incomplete labeling",
    "Inconsistent market notes",
  ],
  costBreakdown: ELECTRONICS_FINANCIAL.costBreakdown.map((row, index) =>
    index === 3
      ? { ...row, amount: "¥52.00", detail: "通用标签与材料测试", detailEn: "Generic labeling and material tests" }
      : row,
  ),
};

const scenarioMap: Record<ProductCategory, Scenario> = {
  electronics: {
    productName: "ZGA 便携式充电器",
    productNameEn: "ZGA Portable Charger",
    productCategory: "electronics",
    baseScore: 49,
    images: scenarioImages.electronics,
    risks: [
      {
        title: "认证标志缺失",
        titleEn: "Certification mark missing",
        description: "外壳与上角视图均未看到明确 CE / UKCA 标志，欧洲与英国市场会直接影响上架与抽检。",
        descriptionEn:
          "No clear CE or UKCA mark appears on the shell or angled view, which directly impacts listing and audits in Europe and the UK.",
        severity: "critical",
        flameLevel: 1,
        confidence: 0.94,
        imageId: "img_03",
        bbox: { x: 0.71, y: 0.14, w: 0.16, h: 0.22 },
        regulations: [
          {
            regId: "EU-CE-MARK",
            code: "CE",
            name: "CE 标识与合规评估",
            nameEn: "CE Marking and Conformity",
            market: "EU",
            summary: "需补充合格评定、DoC 与铭牌版式。",
            summaryEn: "Complete conformity assessment, DoC, and nameplate layout.",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "critical",
          },
        ],
        recommendedAction: "补齐 CE / UKCA 标志并提交技术文件包。",
        recommendedActionEn: "Add CE / UKCA marks and submit the technical file.",
        estimatedFixCost: "¥4,500",
        markets: ["EU", "UK"],
      },
    ],
    checklist: [],
    financialSummary: ELECTRONICS_FINANCIAL,
  },
  appliance: {
    productName: "H3 桌面加湿器",
    productNameEn: "H3 Desktop Humidifier",
    productCategory: "appliance",
    baseScore: 52,
    images: scenarioImages.appliance,
    risks: [],
    checklist: [],
    financialSummary: APPLIANCE_FINANCIAL,
  },
  "3c": {
    productName: "ZGA 便携式充电器",
    productNameEn: "ZGA Portable Charger",
    productCategory: "electronics",
    baseScore: 49,
    images: scenarioImages.electronics,
    risks: [],
    checklist: [],
    financialSummary: ELECTRONICS_FINANCIAL,
  },
  toy: {
    productName: "Blocko 儿童积木",
    productNameEn: "Blocko Kids Blocks",
    productCategory: "toy",
    baseScore: 58,
    images: scenarioImages.toy,
    risks: [],
    checklist: [],
    financialSummary: TOY_FINANCIAL,
  },
  home: {
    productName: "Aurora 桌面香薰灯",
    productNameEn: "Aurora Diffuser Lamp",
    productCategory: "home",
    baseScore: 61,
    images: scenarioImages.home,
    risks: [],
    checklist: [],
    financialSummary: HOME_FINANCIAL,
  },
  other: {
    productName: "通用 SKU",
    productNameEn: "Generic SKU",
    productCategory: "other",
    baseScore: 60,
    images: scenarioImages.other,
    risks: [],
    checklist: [],
    financialSummary: OTHER_FINANCIAL,
  },
};

function scoreToGrade(score: number): ScoreGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function buildRiskPoints(
  scenario: Scenario,
  markets: Market[],
  imageCount: number,
): RiskPoint[] {
  return scenario.risks.map((risk, index) => ({
    ...risk,
    riskId: `risk_${String(index + 1).padStart(2, "0")}`,
    regulations: risk.regulations.filter((rule) => markets.includes(rule.market)),
  })).slice(0, Math.max(1, Math.min(imageCount, 4)));
}

function buildChecklist(
  scenario: Scenario,
  markets: Market[],
  category: ProductCategory,
): ChecklistItem[] {
  const base: ChecklistItem[] = scenario.checklist
    .filter((row) => !row.markets || row.markets.some((m) => markets.includes(m)))
    .map((row, index) => ({
      ...row,
      itemId: `check_${String(index + 1).padStart(2, "0")}`,
    }));

  const coreRuleMarkets: Market[] = ["EU", "US", "UK"];
  if (coreRuleMarkets.some((m) => markets.includes(m))) {
    base.push({
      itemId: `check_${String(base.length + 1).padStart(2, "0")}`,
      category: "核心市场",
      categoryEn: "Core markets",
      title: "整理 CE / FCC / UKCA 合规资料包",
      titleEn: "Prepare CE / FCC / UKCA compliance evidence pack",
      requiredMaterials: ["产品规格书", "BOM", "测试报告", "欧盟责任人信息"],
      requiredMaterialsEn: ["Product spec", "BOM", "Test reports", "EU responsible-person info"],
      estimatedCost: "¥8,000-20,000",
      estimatedTime: "第 1 周",
      estimatedTimeEn: "Week 1",
      isFree: false,
    });
  }
  if (category === "electronics" || category === "3c" || category === "appliance") {
    base.push({
      itemId: `check_${String(base.length + 1).padStart(2, "0")}`,
      category: "电气安全",
      categoryEn: "Electrical safety",
      title: "完成 LVD / EMC 预扫与异常工作测试",
      titleEn: "Run LVD / EMC pre-scan and abnormal-operation tests",
      requiredMaterials: ["样机 5 台", "适配器规格书", "外壳阻燃等级"],
      requiredMaterialsEn: ["5 prototypes", "Adapter spec", "Flame-retardant rating"],
      estimatedCost: "¥6,000-12,000",
      estimatedTime: "第 2-3 周",
      estimatedTimeEn: "Weeks 2-3",
      isFree: false,
    });
  }

  return base;
}

export function createMockScanResult(
  sessionId = "demo",
  options: MockScanOptions = {}
): ScanResult {
  const now = new Date().toISOString();
  const category = options.category ?? "electronics";
  const scenario = scenarioMap[category] ?? scenarioMap.electronics;
  const markets: Market[] = options.markets?.length ? options.markets : ["EU", "UK"];
  const imageCount = options.imageCount ?? 3;
  const locale: AppLocale = options.locale ?? "zh";
  const uploadedImageUrls = options.imageUrls?.filter(Boolean) ?? [];
  const resultImages = uploadedImageUrls.length
    ? scenario.images.map((image, index) => {
        const imageUrl = uploadedImageUrls[index % uploadedImageUrls.length];
        return {
          ...image,
          url: imageUrl,
          thumbnail: imageUrl,
        };
      })
    : scenario.images;
  const riskPoints = buildRiskPoints(scenario, markets, imageCount);
  const complianceScore = clampScore(
    scenario.baseScore + Math.min(imageCount, 4) * 2 - Math.max(markets.length - 1, 0) * 3
  );

  return {
    sessionId,
    scanTime: now,
    productCategory: scenario.productCategory,
    productName: scenario.productName,
    productNameEn: scenario.productNameEn,
    requestedLocale: locale,
    targetMarkets: markets,
    complianceScore,
    scoreGrade: scoreToGrade(complianceScore),
    images: resultImages,
    documents: [],
    riskPoints,
    checklist: buildChecklist(scenario, markets, category),
    generatedAt: now,
    financialSummary: scenario.financialSummary,
    modelInfo: {
      visionProvider: "mock",
      latencyMs: 0,
    },
  };
}

export const mockScanResult = createMockScanResult("demo");

/**
 * Client-safe (no fs/path imports) markdown builder for the home-page demo
 * "65W 充电宝" product. Mirrors `lib/reporting.ts.buildComplianceReport`'s
 * `isDemoCharger` branch, but kept here so the client bundle (`page.tsx` is
 * `"use client"`) can synthesize the `ComplianceReportResult.complianceReport`
 * field without pulling in server-only modules.
 *
 * Server callers (`/api/report/demo/compliance?format=md`) use the same
 * content via `lib/reporting.ts.buildComplianceReport`; the two paths
 * intentionally diverge in environment but share the same string template.
 */
function joinRuleZh(rp: RiskPoint): string {
  return [
    `${rp.title} — ${rp.description}`,
    `  · 证据: ${rp.regulations.map((r) => `${r.market}·${r.code}`).join(" / ")}`,
    `  · 整改: ${rp.recommendedAction}${rp.estimatedFixCost ? ` (预计 ${rp.estimatedFixCost})` : ""}`,
  ].join("\n");
}
function joinRuleEn(rp: RiskPoint): string {
  return [
    `${rp.titleEn ?? rp.title} — ${rp.descriptionEn ?? rp.description}`,
    `  · Citations: ${rp.regulations.map((r) => `${r.market}·${r.code}`).join(" / ")}`,
    `  · Remediation: ${rp.recommendedActionEn ?? rp.recommendedAction}${rp.estimatedFixCost ? ` (Est. ${rp.estimatedFixCost})` : ""}`,
  ].join("\n");
}

export function mockComplianceReportMarkdown(result: ScanResult, locale: "zh" | "en"): string {
  const product = result.productName ?? "65W 快充充电器";
  const markets = result.targetMarkets.join(" / ");
  const rules = result.riskPoints.map((rp, i) =>
    (locale === "en" ? joinRuleEn(rp) : joinRuleZh(rp)).replace(/^/, `${i + 1}. `)
  ).join("\n\n");
  if (locale === "en") {
    return `# CompliPilot · Compliance Scan Report — 65W Charger (Demo)

> This report evaluates **${product}** (65W GaN USB-PD fast charger) for the target markets **${markets}**, based on multimodal analysis of 3 product images (front, side, packaging) and a two-level EU + UK regulation corpus (CE-RED / LVD / EMC / RoHS / GPSR / UKCA / EMC-2016 / EPR).

## 1. Headline

- **Score**: ${result.complianceScore} / ${result.scoreGrade}
- **Verdict**: Do **not** launch into ${markets} yet. Until CE marks, nameplate data, multilingual packaging warnings, and listing evidence are closed, EU/UK market entry will trip listing rejection, customs hold, and recall channels in parallel.

## 2. Risk and citations

${rules}

## 3. Remediation timeline (see full roadmap report)

| Phase | Window | Deliverable | Owner |
| --- | --- | --- | --- |
| Document freeze | Days 1-2 | Spec / BOM / adapter / shell material | Product / Procurement |
| Label & packaging remediation | Days 3-7 | Nameplate CE/UKCA marks, multilingual warnings, recycling mark | Design / Compliance |
| LVD / EMC pre-scan | Weeks 1-2 | Temperature-rise / drop / abnormal / waterproof report | Lab |
| Formal certification | Weeks 3-5 | CE tech file, DoC, RoHS/REACH | Lab / Compliance |
| Listing review | Week 5 | Listing copy / hero image / cert archive / EPR ID | Ops / Legal |

---
Generated at: ${result.generatedAt}
Score scale: 100 max, A≥85 / B≥70 / C≥55 / D<55
`;
  }
  return `# 规航AI · 合规扫描报告 · 充电宝原型 (65W)

> 本报告针对产品 **${product}**(65W GaN USB-PD 快充)的目标市场
> **${markets}** 给出端到端的合规风险评估与整改路径。
> 报告基于以下 3 张产品图片(正面 / 侧面 / 包装)的多模态识别结果,
> 并联动了欧盟 + 英国两级法规知识库(CE-RED / LVD / EMC / RoHS /
> GPSR / UKCA / EMC-2016 / EPR)。

## 1. 总体判断

- **合规等级**: ${result.complianceScore} / ${result.scoreGrade}
- **结论**: 当前状态 **不建议直接上架** ${markets}。在 CE 标志、铭牌信息、
  包装多语言警示与平台审核资料四项闭环之前,进入欧盟/英国销售会同时触发
  平台审核拒绝 + 海关扣留 + 抽检召回三种风险链路。

## 2. 关键风险与法规引用

${rules}

## 3. 整改路线图概览

| 阶段 | 时间 | 关键产出 | 责任方 |
| --- | --- | --- | --- |
| 资料冻结 | 第 1-2 天 | 规格书 / BOM / 适配器规格 / 外壳材料锁定 | 产品 / 采购 |
| 标签包装整改 | 第 3-7 天 | 铭牌 CE/UKCA 标志、说明书多语言警示、回收标识 | 设计 / 合规 |
| LVD / EMC 预扫 | 第 1-2 周 | 温升 / 跌落 / 异常工作 / 防水结构报告 | 实验室 |
| 正式认证 | 第 3-5 周 | CE 技术文件包、DoC、RoHS/REACH 报告 | 实验室 / 合规 |
| 上架复核 | 第 5 周 | listing 文案 / 主图 / 证书归档 / EPR 编号 | 运营 / 法务 |

---
报告生成时间: ${result.generatedAt}
合规评分体系: 满分 100,A≥85 / B≥70 / C≥55 / D<55
`;
}
