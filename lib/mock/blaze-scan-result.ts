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
