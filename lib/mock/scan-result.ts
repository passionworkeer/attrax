import type { ComplianceReportResult, ProfitReportResult, ScanResult } from "@/lib/types";

const PRODUCT_NAME = "USB 智能加湿器";
const DEFAULT_MARKETS = ["EU", "US"] as const;

function nowIso() {
  return new Date().toISOString();
}

export function createMockScanResult(sessionId = "demo"): ScanResult {
  const now = nowIso();

  return {
    sessionId,
    scanTime: now,
    productCategory: "electronics",
    productName: PRODUCT_NAME,
    targetMarkets: [...DEFAULT_MARKETS],
    complianceScore: 45,
    scoreGrade: "D",
    images: [
      {
        imageId: "img_01",
        url: "/mock-fixtures/humidifier-1.jpg",
        thumbnail: "/mock-fixtures/humidifier-1.jpg",
        width: 1200,
        height: 900,
        angleHint: "front",
      },
      {
        imageId: "img_02",
        url: "/mock-fixtures/humidifier-2.jpg",
        thumbnail: "/mock-fixtures/humidifier-2.jpg",
        width: 1200,
        height: 900,
        angleHint: "nameplate",
      },
    ],
    documents: [
      {
        documentId: "doc_01",
        name: "产品规格书.pdf",
        size: 524288,
        type: "pdf",
        mimeType: "application/pdf",
        url: "/mock-fixtures/spec.pdf",
      },
      {
        documentId: "doc_02",
        name: "CE 证书草稿.docx",
        size: 262144,
        type: "docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        url: "/mock-fixtures/ce-cert.docx",
      },
    ],
    riskPoints: [
      {
        riskId: "risk_01",
        title: "铭牌缺少 CE / UKCA 等合规标识",
        description:
          "图片中的铭牌区域未看到 CE 标识、欧盟责任人信息或完整型号信息。若直接进入欧盟/英国市场，平台审核、海关抽检和售后追溯都会存在较高风险。",
        severity: "critical",
        flameLevel: 1,
        confidence: 0.91,
        imageId: "img_02",
        bbox: { x: 0.34, y: 0.46, w: 0.24, h: 0.18 },
        regulations: [
          {
            regId: "EU-CE-GENERAL",
            code: "CE",
            name: "CE 标识与技术文件通用要求",
            market: "EU",
            summary: "进入欧盟市场的电子电器产品需要满足适用指令下的合格评定、技术文件、DoC 与可追溯标识要求。",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "critical",
          },
        ],
        recommendedAction:
          "先冻结欧盟/英国新上架，补齐铭牌、欧盟责任人、DoC、LVD/EMC/RoHS 技术文件后再恢复销售。",
        estimatedFixCost: "¥8,000-22,000",
      },
      {
        riskId: "risk_02",
        title: "包装与说明书缺少多语言安全警示",
        description:
          "包装和说明书未体现欧盟多语言安全警示、回收标识、WEEE 垃圾桶标志、批次号和进口商联系方式。该问题容易触发平台资料补交或客户投诉。",
        severity: "warning",
        flameLevel: 2,
        confidence: 0.74,
        imageId: "img_01",
        bbox: { x: 0.6, y: 0.12, w: 0.2, h: 0.16 },
        regulations: [
          {
            regId: "EU-GPSR-2023/988",
            code: "GPSR",
            name: "通用产品安全法规",
            market: "EU",
            summary: "产品页面、包装和说明书应提供制造商/责任人、产品识别、安全警示和可追溯信息。",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "warning",
          },
        ],
        recommendedAction:
          "重做欧盟包装和说明书模板，至少覆盖 EN/DE/FR/ES/IT 五语安全警示，并把批次追溯码写入包装版式。",
        estimatedFixCost: "¥1,500-5,000",
      },
      {
        riskId: "risk_03",
        title: "电源和水箱结构需要补充安全测试",
        description:
          "该产品同时涉及 USB 供电、雾化片、水箱和塑料外壳。若电源保护、阻燃等级或防水结构证据不足，可能影响 CE LVD/EMC、UL/ETL 以及平台电气安全审核。",
        severity: "critical",
        flameLevel: 1,
        confidence: 0.83,
        imageId: "img_01",
        bbox: { x: 0.18, y: 0.28, w: 0.38, h: 0.32 },
        regulations: [
          {
            regId: "EU-LVD-2014/35/EU",
            code: "LVD",
            name: "低电压指令",
            market: "EU",
            summary: "电气产品应证明结构、电源、温升、绝缘和用户可接触部件满足基本安全要求。",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "critical",
          },
        ],
        recommendedAction:
          "补充温升、异常工作、跌落、阻燃、EMC 预扫和电源保护测试；若使用第三方适配器，需锁定型号和证书。",
        estimatedFixCost: "¥12,000-35,000",
      },
    ],
    checklist: [
      {
        itemId: "check_01",
        category: "CE / 欧盟市场",
        title: "建立技术文件包和 DoC",
        requiredMaterials: ["产品规格书", "BOM", "电路图", "风险评估", "测试报告", "欧盟责任人信息"],
        recommendedLab: "SGS / TUV / Intertek / 华测",
        estimatedCost: "¥8,000-20,000",
        estimatedTime: "2-4 周",
        isFree: false,
      },
      {
        itemId: "check_02",
        category: "标签与包装",
        title: "补齐铭牌、警示语和追溯信息",
        requiredMaterials: ["铭牌版式", "包装刀模", "多语言警示语", "批次编码规则"],
        estimatedCost: "¥1,500-5,000",
        estimatedTime: "3-7 天",
        isFree: true,
      },
      {
        itemId: "check_03",
        category: "EPR / WEEE",
        title: "确认德国/法国 EPR 注册路径",
        requiredMaterials: ["品牌主体", "包装重量", "电子电器分类", "年度销量预测"],
        estimatedCost: "¥3,000-10,000",
        estimatedTime: "1-3 周",
        isFree: false,
      },
    ],
    generatedAt: now,
    modelInfo: {
      visionProvider: "mock",
      latencyMs: 0,
    },
  };
}

export function createMockComplianceReportResult(sessionId = "demo"): ComplianceReportResult {
  const now = nowIso();
  return {
    sessionId,
    scanTime: now,
    productCategory: "electronics",
    productName: PRODUCT_NAME,
    targetMarkets: [...DEFAULT_MARKETS],
    complianceScore: 45,
    scoreGrade: "D",
    complianceReport: `## 降级合规分析报告：${PRODUCT_NAME}

> 当前为离线降级报告：后端 RAG/LLM 服务不可用时生成，用于保障演示和业务流不中断。结论偏保守，正式出货前仍需要以实验室报告和官方法规为准。

### 1. 总体判断

该产品属于小型电子电器/家居加湿类产品，目标市场为欧盟和美国。基于图片可见信息，当前状态建议判定为 **REJECTED / 暂不建议上架**。

主要原因：

1. 铭牌未看到完整 CE 标识、型号、制造商/责任人和批次追溯信息。
2. 包装与说明书缺少多语言安全警示、WEEE/EPR、回收和儿童误用提示。
3. 产品涉及 USB 供电、雾化片、水箱和塑料外壳，需要补充电气安全、EMC、阻燃和异常工作测试。

### 2. 关键风险

| 风险项 | 严重度 | 影响市场 | 业务影响 | 建议动作 |
| --- | --- | --- | --- | --- |
| CE/DoC/技术文件缺失 | 严重 | EU/UK | 平台审核失败、海关扣留、召回风险 | 先完成 LVD/EMC/RoHS 技术文件包 |
| 标签和责任人信息不足 | 严重 | EU | GPSR 下架、售后追溯失败 | 补齐欧盟责任人、制造商、批次号 |
| 多语言警示不足 | 中高 | EU/US | 客诉、差评、平台资料补交 | 更新包装和说明书 |
| 电气和水箱结构证据不足 | 严重 | EU/US | 安全事故、退货、保险拒赔 | 做温升、跌落、异常工作、防水结构评估 |
| EPR/WEEE 未登记 | 中高 | DE/FR | 平台限制销售、罚款 | 建立包装、电器、可能的电池 EPR 台账 |

### 3. 推荐整改排期

| 阶段 | 时间 | 负责人 | 产出 |
| --- | --- | --- | --- |
| 资料冻结 | 第 1-2 天 | 产品/采购 | 锁定 BOM、供应商、适配器型号、外壳材料 |
| 标签包装整改 | 第 3-7 天 | 设计/合规 | 铭牌、包装、说明书、多语言警示 |
| 预扫测试 | 第 1-2 周 | 实验室 | EMC 预扫、电气安全、温升和异常工作结果 |
| 正式认证 | 第 3-5 周 | 实验室/合规 | CE 技术文件、DoC、RoHS/REACH 报告 |
| 上架复核 | 第 5 周 | 运营/法务 | listing 文案、证书归档、EPR 编号 |

### 4. 上线建议

短期可以先用于内部选品和成本测算，不建议直接进入欧盟/美国销售。若必须赶上架，建议只开放低风险测试渠道，并把页面库存、广告预算和仓储入库控制在小批量范围内。`,
    complianceStatus: "REJECTED",
    agentTrace: [
      { node: "vision", status: "MOCK", duration_ms: 0, score: 0.7 },
      { node: "retriever", status: "FALLBACK", duration_ms: 0, docs_retrieved: 6 },
      { node: "generator", status: "MOCK", duration_ms: 0, score: 0.68 },
      { node: "verifier", status: "WARN", duration_ms: 0, score: 0.62 },
    ],
    loopCount: 0,
    retrievedChunks: [
      { regId: "EU-GPSR-2023/988", docName: "EU GPSR 通用产品安全法规", articleNo: "Art. 9", region: "EU", score: 0.86 },
      { regId: "EU-LVD-2014/35/EU", docName: "低电压指令", articleNo: "Annex I", region: "EU", score: 0.83 },
      { regId: "EU-EMC-2014/30/EU", docName: "EMC 指令", articleNo: "Art. 6", region: "EU", score: 0.8 },
      { regId: "EU-ROHS-2011/65/EU", docName: "RoHS 指令", articleNo: "Art. 4", region: "EU", score: 0.78 },
      { regId: "US-FCC-15", docName: "FCC Part 15", articleNo: "15.101", region: "US", score: 0.72 },
      { regId: "US-CPSA", docName: "Consumer Product Safety Act", articleNo: "General Duty", region: "US", score: 0.68 },
    ],
    images: undefined,
    documents: [],
    riskPoints: undefined,
    checklist: undefined,
    generatedAt: now,
    modelInfo: { ragProvider: "fallback-mock", latencyMs: 0 },
  };
}

type ProfitScenario = "lean" | "standard" | "premium";

const profitScenarioConfig: Record<
  ProfitScenario,
  {
    title: string;
    market: string;
    barebone: ProfitReportResult["barebone"];
    compliant: ProfitReportResult["compliant"];
    bareboneRiskExposure: number;
    compliantRiskExposure: number;
    premiumPct: string;
    breakevenUnits: string;
    pricingStrategy: string;
    riskNote: string;
    keyConclusion: string;
  }
> = {
  lean: {
    title: "方案 A：保守修复版",
    market: "EU",
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6, asp: 19.99, gp: 0.71, warranty: 0.45, total: 15.95 },
    compliant: { bom: 11.8, packaging: 0.55, cert: 0.35, epr: 0.28, logistics: 6.1, asp: 29.99, gp: 7.46, warranty: 0.75, total: 19.63 },
    bareboneRiskExposure: 6800,
    compliantRiskExposure: 600,
    premiumPct: "23%",
    breakevenUnits: "545 台",
    pricingStrategy: "以 $29.99 作为合规入门价，优先保住转化率和评价数量。",
    riskNote: "裸奔模式在欧盟平台审核中容易被要求补证；小批量也可能触发仓储冻结。",
    keyConclusion: "保守修复版适合赶首批上架：单台成本增加约 $3.68，但风险敞口下降约 91%。",
  },
  standard: {
    title: "方案 B：标准合规版",
    market: "EU",
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6, asp: 19.99, gp: 0.71, warranty: 0.45, total: 15.95 },
    compliant: { bom: 13.5, packaging: 0.65, cert: 0.45, epr: 0.35, logistics: 6, asp: 39.99, gp: 11.48, warranty: 0.9, total: 21.85 },
    bareboneRiskExposure: 9200,
    compliantRiskExposure: 480,
    premiumPct: "37%",
    breakevenUnits: "295 台",
    pricingStrategy: "建议 $39.99-49.99，主打安全认证、低噪音和可持续包装。",
    riskNote: "裸奔模式在 EU/US 双市场会叠加平台下架、召回和赔付风险。",
    keyConclusion: "标准合规版是推荐路径：单台毛利从 $0.71 提升到 $11.48，约 295 台即可覆盖合规投入。",
  },
  premium: {
    title: "方案 C：品牌溢价版",
    market: "EU + US + UK",
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6.2, asp: 19.99, gp: 0.51, warranty: 0.65, total: 16.15 },
    compliant: { bom: 15.8, packaging: 1.15, cert: 0.65, epr: 0.42, logistics: 6.4, asp: 54.99, gp: 24.77, warranty: 1.8, total: 30.22 },
    bareboneRiskExposure: 12800,
    compliantRiskExposure: 900,
    premiumPct: "87%",
    breakevenUnits: "182 台",
    pricingStrategy: "建议 $49.99-59.99，搭配品牌包装、延保、低噪音测试和礼品场景营销。",
    riskNote: "品牌溢价依赖更完整的测试证据和售后承诺；成本更高，但能明显提升渠道议价能力。",
    keyConclusion: "品牌溢价版适合做长期款：合规成本更高，但单台风险调整后利润最高。",
  },
};

function buildProfitReport(sessionId: string, scenario: ProfitScenario): ProfitReportResult {
  const now = nowIso();
  const config = profitScenarioConfig[scenario];
  const compliantDelta = config.compliant.total - config.barebone.total;
  const conclusions = [
    `1. ${config.keyConclusion}`,
    `2. 合规方案直接成本增加约 $${compliantDelta.toFixed(2)}/台，但显著降低平台下架、扣仓和召回风险。`,
    `3. 建议把证书、标签、EPR 和测试报告做成 SKU 级台账，避免后续扩市场时重复补资料。`,
    `4. 若预算有限，优先完成铭牌/说明书/RoHS/EMC 预扫；若做长期款，应同步布局品牌包装和延保。`,
  ].join("\n");
  const references = [
    "- EU GPSR (EU) 2023/988 通用产品安全法规",
    "- LVD 2014/35/EU / EMC 2014/30/EU",
    "- RoHS 2011/65/EU / REACH (EC) No 1907/2006",
    "- WEEE 2012/19/EU / 德国 VerpackG、ElektroG",
    "- FCC Part 15 / 美国消费品安全通用义务",
  ].join("\n");

  return {
    sessionId,
    productType: PRODUCT_NAME,
    market: config.market,
    currency: "USD",
    report: `## ${config.title}：${PRODUCT_NAME} 合规成本与利润分析

> 当前为离线降级利润报告。金额为演示估算，用于展示成本结构和决策逻辑；正式报价前应替换为真实 BOM、物流、认证报价和平台费率。

### 一、成本对比

| 成本项 | 裸奔模式 | 合规模式 | 说明 |
| --- | ---: | ---: | --- |
| BOM | $${config.barebone.bom.toFixed(2)} | $${config.compliant.bom.toFixed(2)} | 外壳、电源、雾化片、阻燃材料 |
| 包装与印刷 | $${config.barebone.packaging.toFixed(2)} | $${config.compliant.packaging.toFixed(2)} | 多语言警示、追溯码、回收标识 |
| 认证摊销 | $${config.barebone.cert.toFixed(2)} | $${config.compliant.cert.toFixed(2)} | CE/FCC/RoHS/EMC 等按销量摊销 |
| EPR/WEEE | $${config.barebone.epr.toFixed(2)} | $${config.compliant.epr.toFixed(2)} | 包装、电器、可能的电池责任 |
| 售后预留 | $${config.barebone.warranty.toFixed(2)} | $${config.compliant.warranty.toFixed(2)} | 合规模式含更清晰保修承诺 |
| 物流渠道 | $${config.barebone.logistics.toFixed(2)} | $${config.compliant.logistics.toFixed(2)} | 海外仓/平台仓基础成本 |
| **总直接成本** | **$${config.barebone.total.toFixed(2)}** | **$${config.compliant.total.toFixed(2)}** | 合规溢价 ${config.premiumPct} |

### 二、收益对比

| 收益项 | 裸奔模式 | 合规模式 |
| --- | ---: | ---: |
| 平均售价 ASP | $${config.barebone.asp.toFixed(2)} | $${config.compliant.asp.toFixed(2)} |
| 单台毛利 GP | $${config.barebone.gp.toFixed(2)} | $${config.compliant.gp.toFixed(2)} |
| 毛利率 | ${((config.barebone.gp / config.barebone.asp) * 100).toFixed(1)}% | ${((config.compliant.gp / config.compliant.asp) * 100).toFixed(1)}% |

### 三、风险调整后收益

裸奔模式看似成本低，但一旦遇到平台补证、扣仓、批量退货或召回，单次损失可能覆盖数百台利润。合规模式虽然增加前置成本，但能换取更稳定的上架、广告投放和渠道合作。

### 四、盈亏平衡

- 合规溢价：${config.premiumPct}
- 预估盈亏平衡点：${config.breakevenUnits}
- 定价策略：${config.pricingStrategy}

### 五、关键结论

${conclusions}

### 六、法规与运营依据

${references}`,
    barebone: config.barebone,
    compliant: config.compliant,
    bareboneRiskExposure: config.bareboneRiskExposure,
    compliantRiskExposure: config.compliantRiskExposure,
    keyConclusion: config.keyConclusion,
    generatedAt: now,
    premiumPct: config.premiumPct,
    breakevenUnits: config.breakevenUnits,
    pricingStrategy: config.pricingStrategy,
    riskNote: config.riskNote,
    conclusions,
    references,
    bareboneGpm: (config.barebone.gp / config.barebone.asp) * 100,
    compliantGpm: (config.compliant.gp / config.compliant.asp) * 100,
  };
}

export function createMockProfitReports(sessionId = "demo"): ProfitReportResult[] {
  return [buildProfitReport(sessionId, "lean"), buildProfitReport(sessionId, "standard"), buildProfitReport(sessionId, "premium")];
}

export function createMockProfitReport(sessionId = "demo"): ProfitReportResult {
  return createMockProfitReports(sessionId)[1];
}

export function createMockProfitReportEU(sessionId = "demo"): ProfitReportResult {
  return createMockProfitReports(sessionId)[1];
}

export function createMockProfitReportUS(sessionId = "demo"): ProfitReportResult {
  return createMockProfitReports(sessionId)[2];
}

export const mockComplianceReportResult = createMockComplianceReportResult("demo");
export const mockScanResult = createMockScanResult("demo");
export const mockProfitReports = createMockProfitReports("demo");
export const mockProfitReport = mockProfitReports[1];
export const demoProfitReportEU = createMockProfitReportEU();
export const demoProfitReportUS = createMockProfitReportUS();
