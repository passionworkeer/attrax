import type { ComplianceReportResult, ProfitReportResult, ReportPackage, ScanResult } from "@/lib/types";

const PRODUCT_NAME = "USB 智能加湿器";
const PRODUCT_NAME_EN = "USB Smart Humidifier";
const DEFAULT_MARKETS = ["EU", "US"] as const;

function nowIso() {
  return new Date().toISOString();
}

function buildComplianceReportZh(productName = PRODUCT_NAME): string {
  return `## 降级合规分析报告：${productName}

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

短期可以先用于内部选品和成本测算，不建议直接进入欧盟/美国销售。若必须赶上架，建议只开放低风险测试渠道，并把页面库存、广告预算和仓储入库控制在小批量范围内。`;
}

function buildComplianceReportEn(productName = PRODUCT_NAME_EN): string {
  return `## Fallback Compliance Analysis Report: ${productName}

> This is an offline fallback report generated when the RAG/LLM backend is unavailable. It keeps the demo and business flow running. The conclusions are intentionally conservative; final shipment decisions should still rely on laboratory reports and official regulatory sources.

### 1. Overall Assessment

This product is a small electronic home humidifier targeting the European Union and the United States. Based on the visible image evidence, the current recommendation is **REJECTED / not ready for listing**.

Main reasons:

1. The nameplate does not show complete CE marking, model identification, manufacturer/responsible-person details, or batch traceability information.
2. The packaging and manual lack multilingual safety warnings, WEEE/EPR information, recycling marks, and child misuse warnings.
3. The product combines USB power, an atomizer, a water tank, and a plastic housing, so additional electrical safety, EMC, flame-retardancy, and abnormal-operation testing is required.

### 2. Key Risks

| Risk Item | Severity | Affected Markets | Business Impact | Recommended Action |
| --- | --- | --- | --- | --- |
| Missing CE/DoC/technical file evidence | Critical | EU/UK | Marketplace review failure, customs detention, recall exposure | Complete the LVD/EMC/RoHS technical file first |
| Insufficient label and responsible-person information | Critical | EU | GPSR delisting and failed after-sales traceability | Add EU responsible person, manufacturer, and batch number |
| Missing multilingual warnings | Medium-high | EU/US | Complaints, poor reviews, additional platform evidence requests | Update packaging and user manual |
| Insufficient electrical and water-tank safety evidence | Critical | EU/US | Safety incidents, returns, and insurance disputes | Run temperature-rise, drop, abnormal-operation, and ingress-structure assessments |
| EPR/WEEE registrations not confirmed | Medium-high | DE/FR | Sales restrictions and fines | Build packaging, WEEE, and possible battery EPR ledgers |

### 3. Recommended Remediation Schedule

| Phase | Timing | Owner | Output |
| --- | --- | --- | --- |
| Freeze product data | Day 1-2 | Product / Sourcing | Locked BOM, suppliers, adapter model, and housing material |
| Label and packaging remediation | Day 3-7 | Design / Compliance | Nameplate, packaging, manual, and multilingual warnings |
| Pre-compliance testing | Week 1-2 | Lab | EMC pre-scan, electrical safety, temperature-rise, and abnormal-operation results |
| Formal certification | Week 3-5 | Lab / Compliance | CE technical file, DoC, and RoHS/REACH reports |
| Listing review | Week 5 | Operations / Legal | Listing copy, certificate archive, and EPR IDs |

### 4. Launch Recommendation

Use this product for internal sourcing and cost modeling in the short term, but do not list it directly in the EU or US. If a rushed launch is unavoidable, limit it to a low-risk pilot channel and keep listing inventory, advertising spend, and warehouse intake at a small-batch level.`;
}

function createMockReportPackage(): ReportPackage {
  return {
    complianceReport: buildComplianceReportZh(),
    complianceReportEn: buildComplianceReportEn(),
    decisionView: {
      verdict: "REJECTED",
      riskLevel: "HIGH",
      summary:
        "AI 决策链路基于图片、法规检索和成本影响综合判断：当前资料不足以支持欧盟/美国正式上架，应先完成证据补齐和小批量复核。",
      summaryEn:
        "The AI decision chain combines image evidence, regulatory retrieval, and cost impact. The current dossier is not sufficient for formal EU/US listing and should be remediated before a small-batch review.",
      keyFindings: [
        "铭牌缺少 CE、型号、制造商/责任人和批次追溯信息。",
        "包装与说明书缺少多语言安全警示、WEEE/EPR 和进口商联系方式。",
        "USB 供电、水箱和塑料外壳组合需要补充电气安全、EMC、温升和异常工作测试。",
        "合规投入会增加前置成本，但能显著降低平台下架、扣仓和召回风险。",
      ],
      keyFindingsEn: [
        "The nameplate lacks CE marking, model identification, manufacturer/responsible-person data, and batch traceability.",
        "Packaging and instructions lack multilingual safety warnings, WEEE/EPR information, and importer contact details.",
        "The USB power, water tank, and plastic housing combination requires additional electrical safety, EMC, temperature-rise, and abnormal-operation testing.",
        "Compliance investment raises upfront cost but materially reduces delisting, warehouse hold, and recall exposure.",
      ],
      recommendedAction:
        "暂缓正式上架；优先补齐铭牌/说明书、DoC、LVD/EMC/RoHS 技术文件和 EPR 台账，再进行小批量试销。",
      recommendedActionEn:
        "Pause formal listing; complete labels/manuals, DoC, LVD/EMC/RoHS technical files, and EPR ledgers before a small pilot sale.",
      nodes: [
        {
          id: "vision",
          type: "vision",
          label: "视觉识别",
          labelEn: "Visual Recognition",
          icon: "eye",
          status: "MOCK",
          duration: "0.0s",
          confidence: 0.91,
          reasoning: "图片中可见铭牌信息不完整，包装安全标识不足。",
          reasoningEn: "Images show incomplete nameplate information and insufficient packaging safety marks.",
        },
        {
          id: "retriever",
          type: "retrieval",
          label: "法规检索",
          labelEn: "Regulatory Retrieval",
          icon: "search",
          status: "FALLBACK",
          duration: "0.0s",
          confidence: 0.86,
          reasoning: "命中 GPSR、LVD、EMC、RoHS、FCC 等与电子加湿器高度相关的要求。",
          reasoningEn: "Matched GPSR, LVD, EMC, RoHS, FCC, and related requirements for an electronic humidifier.",
        },
        {
          id: "generator",
          type: "generation",
          label: "报告生成",
          labelEn: "Report Generation",
          icon: "file",
          status: "MOCK",
          duration: "0.0s",
          confidence: 0.68,
          reasoning: "生成合规、利润、路线图和决策四个结果场景。",
          reasoningEn: "Generated the compliance, profit, roadmap, and decision result scenes.",
        },
        {
          id: "verifier",
          type: "verification",
          label: "保守校验",
          labelEn: "Conservative Verification",
          icon: "shield",
          status: "WARN",
          duration: "0.0s",
          confidence: 0.62,
          reasoning: "缺少实验室原始报告和正式证书，因此维持高风险裁决。",
          reasoningEn: "Original lab reports and official certificates are missing, so the high-risk verdict remains.",
        },
      ],
    },
    roadmap: {
      totalDays: 35,
      totalCost: "¥24K-72K",
      progress: 14,
      items: [
        {
          id: "roadmap-01",
          title: "冻结产品资料与供应链清单",
          titleEn: "Freeze Product Data and Supplier List",
          description: "锁定 BOM、适配器型号、外壳材料、水箱结构和供应商证书，避免测试过程中频繁变更。",
          descriptionEn: "Lock the BOM, adapter model, housing material, water-tank structure, and supplier certificates to avoid changes during testing.",
          type: "apply",
          status: "completed",
          estimatedDays: 2,
          cost: "¥0-2K",
          documents: ["产品规格书", "BOM 清单", "供应商证书"],
          documentsEn: ["Product specification", "BOM", "Supplier certificates"],
        },
        {
          id: "roadmap-02",
          title: "完成铭牌、说明书和包装整改",
          titleEn: "Complete Nameplate, Manual, and Packaging Remediation",
          description: "补齐 CE、责任人、批次追溯、WEEE、回收标识和 EN/DE/FR/ES/IT 五语安全警示。",
          descriptionEn: "Add CE marking, responsible-person details, batch traceability, WEEE, recycling marks, and EN/DE/FR/ES/IT safety warnings.",
          type: "apply",
          status: "in-progress",
          estimatedDays: 5,
          cost: "¥1.5K-5K",
          documents: ["铭牌图稿", "包装刀模", "多语言说明书"],
          documentsEn: ["Nameplate artwork", "Packaging dieline", "Multilingual manual"],
        },
        {
          id: "roadmap-03",
          title: "执行 EMC 与电气安全预扫",
          titleEn: "Run EMC and Electrical Safety Pre-Scans",
          description: "完成温升、异常工作、跌落、阻燃和 EMC 预扫，确认是否需要结构或电源方案调整。",
          descriptionEn: "Run temperature-rise, abnormal-operation, drop, flame-retardancy, and EMC pre-scans to confirm whether design changes are needed.",
          type: "test",
          status: "pending",
          estimatedDays: 10,
          cost: "¥12K-35K",
          documents: ["样机", "电路图", "测试委托单"],
          documentsEn: ["Samples", "Circuit diagram", "Test request form"],
        },
        {
          id: "roadmap-04",
          title: "形成 CE/FCC/RoHS 技术文件包",
          titleEn: "Build CE/FCC/RoHS Technical File",
          description: "归档 DoC、风险评估、测试报告、供应商声明和 SKU 级证据清单。",
          descriptionEn: "Archive the DoC, risk assessment, test reports, supplier declarations, and SKU-level evidence checklist.",
          type: "certify",
          status: "pending",
          estimatedDays: 14,
          cost: "¥8K-25K",
          documents: ["DoC", "测试报告", "风险评估", "供应商声明"],
          documentsEn: ["DoC", "Test reports", "Risk assessment", "Supplier declarations"],
        },
        {
          id: "roadmap-05",
          title: "完成上架复核与小批量试销",
          titleEn: "Complete Listing Review and Pilot Sale",
          description: "复核 listing 文案、证书归档、EPR 编号和售后承诺，先以小批量验证转化和退货表现。",
          descriptionEn: "Review listing copy, certificate archives, EPR IDs, and warranty promises, then validate conversion and returns with a small pilot batch.",
          type: "complete",
          status: "pending",
          estimatedDays: 4,
          cost: "¥2K-5K",
          documents: ["Listing 文案", "证书归档", "EPR 编号"],
          documentsEn: ["Listing copy", "Certificate archive", "EPR IDs"],
        },
      ],
    },
  };
}

export function createMockScanResult(sessionId = "demo"): ScanResult {
  const now = nowIso();

  return {
    sessionId,
    scanTime: now,
    productCategory: "electronics",
    productName: PRODUCT_NAME,
    productNameEn: PRODUCT_NAME_EN,
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
        nameEn: "Product Specification.pdf",
        size: 524288,
        type: "pdf",
        mimeType: "application/pdf",
        url: "/mock-fixtures/spec.pdf",
      },
      {
        documentId: "doc_02",
        name: "CE 证书草稿.docx",
        nameEn: "Draft CE Certificate.docx",
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
        titleEn: "Nameplate Missing CE / UKCA Compliance Marks",
        description:
          "图片中的铭牌区域未看到 CE 标识、欧盟责任人信息或完整型号信息。若直接进入欧盟/英国市场，平台审核、海关抽检和售后追溯都会存在较高风险。",
        descriptionEn:
          "The nameplate area does not show CE marking, EU responsible-person information, or complete model identification. Direct EU/UK listing would create high marketplace review, customs inspection, and after-sales traceability risk.",
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
            nameEn: "General CE Marking and Technical File Requirements",
            market: "EU",
            summary: "进入欧盟市场的电子电器产品需要满足适用指令下的合格评定、技术文件、DoC 与可追溯标识要求。",
            summaryEn:
              "Electronic products entering the EU must meet applicable conformity assessment, technical file, DoC, and traceability marking requirements.",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "critical",
          },
        ],
        recommendedAction:
          "先冻结欧盟/英国新上架，补齐铭牌、欧盟责任人、DoC、LVD/EMC/RoHS 技术文件后再恢复销售。",
        recommendedActionEn:
          "Freeze new EU/UK listings first, then resume sales after completing the nameplate, EU responsible-person data, DoC, and LVD/EMC/RoHS technical files.",
        estimatedFixCost: "¥8,000-22,000",
      },
      {
        riskId: "risk_02",
        title: "包装与说明书缺少多语言安全警示",
        titleEn: "Packaging and Manual Missing Multilingual Safety Warnings",
        description:
          "包装和说明书未体现欧盟多语言安全警示、回收标识、WEEE 垃圾桶标志、批次号和进口商联系方式。该问题容易触发平台资料补交或客户投诉。",
        descriptionEn:
          "The packaging and manual do not show EU multilingual safety warnings, recycling marks, the WEEE crossed-bin symbol, batch number, or importer contact details. This can trigger platform evidence requests or customer complaints.",
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
            nameEn: "General Product Safety Regulation",
            market: "EU",
            summary: "产品页面、包装和说明书应提供制造商/责任人、产品识别、安全警示和可追溯信息。",
            summaryEn:
              "Product pages, packaging, and instructions should provide manufacturer/responsible-person details, product identification, safety warnings, and traceability data.",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "warning",
          },
        ],
        recommendedAction:
          "重做欧盟包装和说明书模板，至少覆盖 EN/DE/FR/ES/IT 五语安全警示，并把批次追溯码写入包装版式。",
        recommendedActionEn:
          "Rebuild the EU packaging and manual templates with at least EN/DE/FR/ES/IT safety warnings and add batch traceability codes to the packaging layout.",
        estimatedFixCost: "¥1,500-5,000",
      },
      {
        riskId: "risk_03",
        title: "电源和水箱结构需要补充安全测试",
        titleEn: "Power and Water-Tank Structure Need Additional Safety Testing",
        description:
          "该产品同时涉及 USB 供电、雾化片、水箱和塑料外壳。若电源保护、阻燃等级或防水结构证据不足，可能影响 CE LVD/EMC、UL/ETL 以及平台电气安全审核。",
        descriptionEn:
          "The product combines USB power, an atomizer, a water tank, and a plastic housing. Insufficient evidence for power protection, flame-retardancy, or water-ingress structure can affect CE LVD/EMC, UL/ETL, and marketplace electrical safety reviews.",
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
            nameEn: "Low Voltage Directive",
            market: "EU",
            summary: "电气产品应证明结构、电源、温升、绝缘和用户可接触部件满足基本安全要求。",
            summaryEn:
              "Electrical products should demonstrate that structure, power supply, temperature rise, insulation, and user-accessible parts meet essential safety requirements.",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "critical",
          },
        ],
        recommendedAction:
          "补充温升、异常工作、跌落、阻燃、EMC 预扫和电源保护测试；若使用第三方适配器，需锁定型号和证书。",
        recommendedActionEn:
          "Add temperature-rise, abnormal-operation, drop, flame-retardancy, EMC pre-scan, and power-protection tests; if a third-party adapter is used, lock the model and certificate.",
        estimatedFixCost: "¥12,000-35,000",
      },
    ],
    checklist: [
      {
        itemId: "check_01",
        category: "CE / 欧盟市场",
        categoryEn: "CE / EU Market",
        title: "建立技术文件包和 DoC",
        titleEn: "Build Technical File and DoC",
        requiredMaterials: ["产品规格书", "BOM", "电路图", "风险评估", "测试报告", "欧盟责任人信息"],
        requiredMaterialsEn: ["Product specification", "BOM", "Circuit diagram", "Risk assessment", "Test reports", "EU responsible-person details"],
        recommendedLab: "SGS / TUV / Intertek / 华测",
        recommendedLabEn: "SGS / TUV / Intertek / CTI",
        estimatedCost: "¥8,000-20,000",
        estimatedTime: "2-4 周",
        estimatedTimeEn: "2-4 weeks",
        isFree: false,
      },
      {
        itemId: "check_02",
        category: "标签与包装",
        categoryEn: "Labels and Packaging",
        title: "补齐铭牌、警示语和追溯信息",
        titleEn: "Complete Nameplate, Warnings, and Traceability",
        requiredMaterials: ["铭牌版式", "包装刀模", "多语言警示语", "批次编码规则"],
        requiredMaterialsEn: ["Nameplate artwork", "Packaging dieline", "Multilingual warnings", "Batch coding rules"],
        estimatedCost: "¥1,500-5,000",
        estimatedTime: "3-7 天",
        estimatedTimeEn: "3-7 days",
        isFree: true,
      },
      {
        itemId: "check_03",
        category: "EPR / WEEE",
        categoryEn: "EPR / WEEE",
        title: "确认德国/法国 EPR 注册路径",
        titleEn: "Confirm Germany/France EPR Registration Path",
        requiredMaterials: ["品牌主体", "包装重量", "电子电器分类", "年度销量预测"],
        requiredMaterialsEn: ["Brand entity", "Packaging weight", "Electrical equipment category", "Annual sales forecast"],
        estimatedCost: "¥3,000-10,000",
        estimatedTime: "1-3 周",
        estimatedTimeEn: "1-3 weeks",
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
    productNameEn: PRODUCT_NAME_EN,
    targetMarkets: [...DEFAULT_MARKETS],
    complianceScore: 45,
    scoreGrade: "D",
    complianceReport: buildComplianceReportZh(),
    complianceReportEn: buildComplianceReportEn(),
    complianceStatus: "REJECTED",
    agentTrace: [
      { node: "vision", status: "MOCK", duration_ms: 0, score: 0.7 },
      { node: "retriever", status: "FALLBACK", duration_ms: 0, docs_retrieved: 6 },
      { node: "generator", status: "MOCK", duration_ms: 0, score: 0.68 },
      { node: "verifier", status: "WARN", duration_ms: 0, score: 0.62 },
    ],
    loopCount: 0,
    retrievedChunks: [
      { regId: "EU-GPSR-2023/988", docName: "EU GPSR 通用产品安全法规", docNameEn: "EU GPSR General Product Safety Regulation", articleNo: "Art. 9", region: "EU", score: 0.86 },
      { regId: "EU-LVD-2014/35/EU", docName: "低电压指令", docNameEn: "Low Voltage Directive", articleNo: "Annex I", region: "EU", score: 0.83 },
      { regId: "EU-EMC-2014/30/EU", docName: "EMC 指令", docNameEn: "EMC Directive", articleNo: "Art. 6", region: "EU", score: 0.8 },
      { regId: "EU-ROHS-2011/65/EU", docName: "RoHS 指令", docNameEn: "RoHS Directive", articleNo: "Art. 4", region: "EU", score: 0.78 },
      { regId: "US-FCC-15", docName: "FCC Part 15", docNameEn: "FCC Part 15", articleNo: "15.101", region: "US", score: 0.72 },
      { regId: "US-CPSA", docName: "Consumer Product Safety Act", docNameEn: "Consumer Product Safety Act", articleNo: "General Duty", region: "US", score: 0.68 },
    ],
    reportPackage: createMockReportPackage(),
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
    titleEn: string;
    market: string;
    marketEn: string;
    barebone: ProfitReportResult["barebone"];
    compliant: ProfitReportResult["compliant"];
    bareboneRiskExposure: number;
    compliantRiskExposure: number;
    premiumPct: string;
    breakevenUnits: string;
    breakevenUnitsEn: string;
    pricingStrategy: string;
    pricingStrategyEn: string;
    riskNote: string;
    riskNoteEn: string;
    keyConclusion: string;
    keyConclusionEn: string;
  }
> = {
  lean: {
    title: "方案 A：保守修复版",
    titleEn: "Scenario A: Conservative Remediation",
    market: "EU",
    marketEn: "EU",
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6, asp: 19.99, gp: 0.71, warranty: 0.45, total: 15.95 },
    compliant: { bom: 11.8, packaging: 0.55, cert: 0.35, epr: 0.28, logistics: 6.1, asp: 29.99, gp: 7.46, warranty: 0.75, total: 19.63 },
    bareboneRiskExposure: 6800,
    compliantRiskExposure: 600,
    premiumPct: "23%",
    breakevenUnits: "545 台",
    breakevenUnitsEn: "545 units",
    pricingStrategy: "以 $29.99 作为合规入门价，优先保住转化率和评价数量。",
    pricingStrategyEn: "Use $29.99 as the entry compliant price to protect conversion rate and review volume.",
    riskNote: "裸奔模式在欧盟平台审核中容易被要求补证；小批量也可能触发仓储冻结。",
    riskNoteEn: "Barebone listings can be asked for evidence during EU marketplace review; even small batches may trigger warehouse holds.",
    keyConclusion: "保守修复版适合赶首批上架：单台成本增加约 $3.68，但风险敞口下降约 91%。",
    keyConclusionEn: "Conservative remediation fits a rushed first batch: unit cost rises by about $3.68, while risk exposure drops by about 91%.",
  },
  standard: {
    title: "方案 B：标准合规版",
    titleEn: "Scenario B: Standard Compliance",
    market: "EU",
    marketEn: "EU",
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6, asp: 19.99, gp: 0.71, warranty: 0.45, total: 15.95 },
    compliant: { bom: 13.5, packaging: 0.65, cert: 0.45, epr: 0.35, logistics: 6, asp: 39.99, gp: 11.48, warranty: 0.9, total: 21.85 },
    bareboneRiskExposure: 9200,
    compliantRiskExposure: 480,
    premiumPct: "37%",
    breakevenUnits: "295 台",
    breakevenUnitsEn: "295 units",
    pricingStrategy: "建议 $39.99-49.99，主打安全认证、低噪音和可持续包装。",
    pricingStrategyEn: "Recommend $39.99-49.99, positioned around safety certification, low noise, and sustainable packaging.",
    riskNote: "裸奔模式在 EU/US 双市场会叠加平台下架、召回和赔付风险。",
    riskNoteEn: "Barebone mode across both EU and US markets compounds delisting, recall, and compensation exposure.",
    keyConclusion: "标准合规版是推荐路径：单台毛利从 $0.71 提升到 $11.48，约 295 台即可覆盖合规投入。",
    keyConclusionEn: "Standard compliance is the recommended path: gross profit rises from $0.71 to $11.48 per unit, covering compliance investment after about 295 units.",
  },
  premium: {
    title: "方案 C：品牌溢价版",
    titleEn: "Scenario C: Brand Premium",
    market: "EU + US + UK",
    marketEn: "EU + US + UK",
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6.2, asp: 19.99, gp: 0.51, warranty: 0.65, total: 16.15 },
    compliant: { bom: 15.8, packaging: 1.15, cert: 0.65, epr: 0.42, logistics: 6.4, asp: 54.99, gp: 24.77, warranty: 1.8, total: 30.22 },
    bareboneRiskExposure: 12800,
    compliantRiskExposure: 900,
    premiumPct: "87%",
    breakevenUnits: "182 台",
    breakevenUnitsEn: "182 units",
    pricingStrategy: "建议 $49.99-59.99，搭配品牌包装、延保、低噪音测试和礼品场景营销。",
    pricingStrategyEn: "Recommend $49.99-59.99 with branded packaging, extended warranty, low-noise testing, and gift-use marketing.",
    riskNote: "品牌溢价依赖更完整的测试证据和售后承诺；成本更高，但能明显提升渠道议价能力。",
    riskNoteEn: "The brand-premium route depends on stronger testing evidence and warranty promises; cost is higher but channel negotiation power improves.",
    keyConclusion: "品牌溢价版适合做长期款：合规成本更高，但单台风险调整后利润最高。",
    keyConclusionEn: "The brand-premium route fits a long-term SKU: compliance cost is higher, but risk-adjusted profit per unit is the strongest.",
  },
};

function buildProfitReport(sessionId: string, scenario: ProfitScenario): ProfitReportResult {
  const now = nowIso();
  const config = profitScenarioConfig[scenario];
  const compliantDelta = config.compliant.total - config.barebone.total;
  const conclusions = [
    `1. ${config.keyConclusion}`,
    `2. 合规方案直接成本增加约 $${compliantDelta.toFixed(2)}/台，但显著降低平台下架、扣仓和召回风险。`,
    "3. 建议把证书、标签、EPR 和测试报告做成 SKU 级台账，避免后续扩市场时重复补资料。",
    "4. 若预算有限，优先完成铭牌/说明书/RoHS/EMC 预扫；若做长期款，应同步布局品牌包装和延保。",
  ].join("\n");
  const conclusionsEn = [
    `1. ${config.keyConclusionEn}`,
    `2. The compliant route adds about $${compliantDelta.toFixed(2)} per unit in direct cost, but materially reduces delisting, warehouse hold, and recall risk.`,
    "3. Build a SKU-level evidence ledger covering certificates, labels, EPR records, and test reports to avoid repeated evidence gaps during market expansion.",
    "4. If budget is limited, prioritize nameplate/manual updates, RoHS evidence, and EMC pre-scan; for a long-term SKU, add branded packaging and warranty planning at the same time.",
  ].join("\n");
  const references = [
    "- EU GPSR (EU) 2023/988 通用产品安全法规",
    "- LVD 2014/35/EU / EMC 2014/30/EU",
    "- RoHS 2011/65/EU / REACH (EC) No 1907/2006",
    "- WEEE 2012/19/EU / 德国 VerpackG、ElektroG",
    "- FCC Part 15 / 美国消费品安全通用义务",
  ].join("\n");
  const referencesEn = [
    "- EU GPSR (EU) 2023/988 General Product Safety Regulation",
    "- LVD 2014/35/EU / EMC 2014/30/EU",
    "- RoHS 2011/65/EU / REACH (EC) No 1907/2006",
    "- WEEE 2012/19/EU / Germany VerpackG and ElektroG",
    "- FCC Part 15 / U.S. consumer product safety general duty",
  ].join("\n");

  const report = `## ${config.title}：${PRODUCT_NAME} 合规成本与利润分析

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

${references}`;

  const reportEn = `## ${config.titleEn}: ${PRODUCT_NAME_EN} Compliance Cost and Profit Analysis

> This is an offline fallback profit report. Amounts are demo estimates used to illustrate cost structure and decision logic; replace them with real BOM, logistics, certification quotes, and platform fee rates before final pricing.

### 1. Cost Comparison

| Cost Item | Barebone Mode | Compliance Mode | Notes |
| --- | ---: | ---: | --- |
| BOM | $${config.barebone.bom.toFixed(2)} | $${config.compliant.bom.toFixed(2)} | Housing, power module, atomizer, flame-retardant material |
| Packaging and printing | $${config.barebone.packaging.toFixed(2)} | $${config.compliant.packaging.toFixed(2)} | Multilingual warnings, traceability code, recycling marks |
| Certification amortization | $${config.barebone.cert.toFixed(2)} | $${config.compliant.cert.toFixed(2)} | CE/FCC/RoHS/EMC amortized by sales volume |
| EPR/WEEE | $${config.barebone.epr.toFixed(2)} | $${config.compliant.epr.toFixed(2)} | Packaging, electrical equipment, and possible battery responsibility |
| Warranty reserve | $${config.barebone.warranty.toFixed(2)} | $${config.compliant.warranty.toFixed(2)} | Clearer warranty promise under the compliant route |
| Logistics channel | $${config.barebone.logistics.toFixed(2)} | $${config.compliant.logistics.toFixed(2)} | Overseas warehouse / marketplace warehouse baseline cost |
| **Total direct cost** | **$${config.barebone.total.toFixed(2)}** | **$${config.compliant.total.toFixed(2)}** | Compliance premium ${config.premiumPct} |

### 2. Revenue Comparison

| Revenue Item | Barebone Mode | Compliance Mode |
| --- | ---: | ---: |
| Average selling price (ASP) | $${config.barebone.asp.toFixed(2)} | $${config.compliant.asp.toFixed(2)} |
| Gross profit per unit (GP) | $${config.barebone.gp.toFixed(2)} | $${config.compliant.gp.toFixed(2)} |
| Gross margin | ${((config.barebone.gp / config.barebone.asp) * 100).toFixed(1)}% | ${((config.compliant.gp / config.compliant.asp) * 100).toFixed(1)}% |

### 3. Risk-Adjusted Revenue

Barebone mode looks cheaper, but one platform evidence request, warehouse hold, mass return, or recall can erase the profit from hundreds of units. Compliance raises upfront cost but gives more stable listing, ad delivery, and channel cooperation.

### 4. Break-even

- Compliance premium: ${config.premiumPct}
- Estimated break-even point: ${config.breakevenUnitsEn}
- Pricing strategy: ${config.pricingStrategyEn}

### 5. Key Conclusions

${conclusionsEn}

### 6. Regulatory and Operating Basis

${referencesEn}`;

  return {
    sessionId,
    productType: PRODUCT_NAME,
    productTypeEn: PRODUCT_NAME_EN,
    market: config.market,
    marketEn: config.marketEn,
    currency: "USD",
    report,
    reportEn,
    barebone: config.barebone,
    compliant: config.compliant,
    bareboneRiskExposure: config.bareboneRiskExposure,
    compliantRiskExposure: config.compliantRiskExposure,
    keyConclusion: config.keyConclusion,
    keyConclusionEn: config.keyConclusionEn,
    generatedAt: now,
    premiumPct: config.premiumPct,
    breakevenUnits: config.breakevenUnits,
    breakevenUnitsEn: config.breakevenUnitsEn,
    pricingStrategy: config.pricingStrategy,
    pricingStrategyEn: config.pricingStrategyEn,
    riskNote: config.riskNote,
    riskNoteEn: config.riskNoteEn,
    conclusions,
    conclusionsEn,
    references,
    referencesEn,
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
