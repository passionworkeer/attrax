import type { ScanResult, ProfitReportResult } from "@/lib/types";

export function createMockScanResult(sessionId = "demo"): ScanResult {
  const now = new Date().toISOString();

  return {
    sessionId,
    scanTime: now,
    productCategory: "electronics",
    productName: "USB 智能加湿器",
    targetMarkets: ["EU", "US"],
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
        name: "CE认证证书.docx",
        size: 262144,
        type: "docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        url: "/mock-fixtures/ce-cert.docx",
      },
    ],
    riskPoints: [
      {
        riskId: "risk_01",
        title: "缺少 CE 标识",
        description: "铭牌区域没有清晰看到 CE 标识，欧盟市场销售前需要先补齐认证与标识信息。",
        severity: "critical",
        flameLevel: 1,
        confidence: 0.91,
        imageId: "img_02",
        bbox: { x: 0.34, y: 0.46, w: 0.24, h: 0.18 },
        regulations: [
          {
            regId: "EU-CE-GENERAL",
            code: "CE",
            name: "CE 标识通用要求",
            market: "EU",
            summary: "欧盟市场销售前，产品需要具备适用指令下的合规标识和技术文件。",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "critical",
          },
        ],
        recommendedAction: "补齐铭牌信息并准备欧盟适用指令下的合规资料。",
        estimatedFixCost: "¥3,000-8,000",
      },
      {
        riskId: "risk_02",
        title: "警示标签可疑",
        description: "包装区未看到明确的多语言警示或回收提示，可能影响欧美市场上架与抽检表现。",
        severity: "warning",
        flameLevel: 2,
        confidence: 0.62,
        imageId: "img_01",
        bbox: { x: 0.6, y: 0.12, w: 0.2, h: 0.16 },
        regulations: [
          {
            regId: "EU-PACKAGING-94-62",
            code: "94/62/EC",
            name: "欧盟包装指令",
            market: "EU",
            summary: "包装信息需要满足回收和必要提示要求，避免因标识缺失引发合规风险。",
            sourceUrl: "https://eur-lex.europa.eu/",
            severity: "warning",
          },
        ],
        recommendedAction: "补充包装标签与警示说明，并准备对应的包材合规记录。",
      },
    ],
    checklist: [
      {
        itemId: "check_01",
        category: "CE 认证 / 欧盟市场",
        title: "整理产品规格书与铭牌信息",
        requiredMaterials: ["产品规格书", "铭牌版式", "供应商信息"],
        recommendedLab: "SGS / TÜV / 华测",
        estimatedCost: "¥0-2,000",
        estimatedTime: "1-2 天",
        isFree: true,
      },
      {
        itemId: "check_02",
        category: "标签整改",
        title: "补充多语言警示与包装标识",
        requiredMaterials: ["包装图稿", "警示语清单"],
        estimatedCost: "¥500-1,500",
        estimatedTime: "1 周",
        isFree: true,
      },
    ],
    generatedAt: now,
    modelInfo: {
      visionProvider: "mock",
      latencyMs: 0,
    },
  };
}

/** Mock ComplianceReportResult — used for demo Tab view */
export function createMockComplianceReportResult(sessionId = "demo") {
  const now = new Date().toISOString();
  return {
    sessionId,
    scanTime: now,
    productCategory: "electronics",
    productName: "USB 智能加湿器",
    targetMarkets: ["EU", "US"] as const,
    complianceScore: 45,
    scoreGrade: "D" as const,
    complianceReport: `## 合规分析报告\n\n### 1. 总体评估\n\n**综合评分：45 / 100（等级 D）**\n\n该产品出口欧盟市场存在 **2 项严重风险**，当前状态为 **不通过**。\n\n### 2. 关键风险点\n\n#### 2.1 缺少 CE 标识（严重）\n\n- **置信度**：91%\n- **涉及市场**：EU\n- **相关法规**：CE 标识通用要求 (EU-CE-GENERAL)\n\n**描述**：铭牌区域没有清晰看到 CE 标识，欧盟市场销售前需要先补齐认证与标识信息。\n\n**建议行动**：\n- 补齐铭牌信息并准备欧盟适用指令下的合规资料\n- 预估整改成本：¥3,000-8,000\n\n#### 2.2 警示标签缺失（警告）\n\n- **置信度**：62%\n- **涉及市场**：EU\n- **相关法规**：欧盟包装指令 (94/62/EC)\n\n**描述**：包装区未看到明确的多语言警示或回收提示，可能影响欧美市场上架与抽检表现。\n\n**建议行动**：\n- 补充包装标签与警示说明\n- 预估整改成本：¥500-1,500\n\n### 3. 认证清单\n\n| 认证项 | 是否需要 | 预估时间 | 预估成本 |\n|--------|---------|---------|----------|\n| CE 认证 | 必须 | 2-4 周 | ¥5,000-15,000 |\n| RoHS 检测 | 必须 | 1-2 周 | ¥2,000-5,000 |\n| REACH 检测 | 必须 | 1-2 周 | ¥2,000-5,000 |\n| 包装指令 | 必须 | 1 周 | ¥500-1,500 |\n\n### 4. 总结\n\n该产品暂不符合欧盟市场合规要求，建议在完成 CE 认证、RoHS 检测和包装标签整改后再上架销售。`,
    complianceStatus: "REJECTED" as const,
    agentTrace: [
      { node: "vision", status: "PASS", duration_ms: 3200, score: 0.95 },
      { node: "query_planner", status: "PASS", duration_ms: 210, docs_retrieved: 0 },
      { node: "retriever", status: "PASS", duration_ms: 1800, docs_retrieved: 12 },
      { node: "synthesizer", status: "PASS", duration_ms: 950, score: 0.87 },
      { node: "generator", status: "PASS", duration_ms: 2100, score: 0.88 },
      { node: "verifier", status: "WARN", duration_ms: 600, score: 0.65 },
    ],
    loopCount: 1,
    retrievedChunks: [
      { regId: "EU-CE-2014/35/EU", docName: "低压指令", articleNo: "Art. 4", region: "EU", score: 0.93 },
      { regId: "EU-ROHS-2011/65/EU", docName: "RoHS 指令", articleNo: "Art. 4", region: "EU", score: 0.91 },
      { regId: "EU-REACH-1907/2006", docName: "REACH 法规", articleNo: "Art. 33", region: "EU", score: 0.88 },
      { regId: "EU-WEEE-2012/19/EU", docName: "WEEE 指令", articleNo: "Art. 8", region: "EU", score: 0.82 },
      { regId: "EU-PACKAGING-94/62/EC", docName: "包装指令", articleNo: "Art. 9", region: "EU", score: 0.76 },
      { regId: "US-FCC-15", docName: "FCC 第15部分", articleNo: "15.101", region: "US", score: 0.71 },
    ],
    images: undefined,
    documents: [],
    riskPoints: undefined,
    checklist: undefined,
    generatedAt: now,
    modelInfo: { ragProvider: "mimotalk", latencyMs: 8500 },
  };
}

export const mockComplianceReportResult = createMockComplianceReportResult("demo");

export const mockScanResult = createMockScanResult("demo");

export function createMockProfitReport(sessionId = "demo"): ProfitReportResult {
  const now = new Date().toISOString();
  return {
    sessionId,
    productType: "USB 智能加湿器",
    market: "EU",
    report: `## [USB 智能加湿器] 合规成本与利润分析报告

> 目标市场：EU | 产品类型：electronics | 报告日期：${now.slice(0, 10)}

---

### 一、成本对比表（合规模式 vs 裸奔模式）

| 成本项 | 裸奔模式 | 合规模式 | 差异 |
|--------|---------|---------|------|
| 材料成本(BOM) | $9.20 | $13.50 | +$4.30 |
| 包装与印刷 | $0.25 | $0.65 | +$0.40 |
| 认证费(单台摊销) | $0.05 | $0.45 | +$0.40 |
| EPR运营费 | $0.00 | $0.35 | +$0.35 |
| 售后/保修预留 | $0.45 | $0.90 | +$0.45 |
| 物流与渠道 | $6.00 | $6.00 | 持平 |
| **总直接成本** | **$15.95** | **$21.85** | **+$5.90 (+37%)** |

### 二、收益对比

| 收益项 | 裸奔模式 | 合规模式 | 差异 |
|--------|---------|---------|------|
| 平均售价(ASP) | $19.99 | $39.99 | +$20.00 |
| 毛利润(单台) | $0.71 | $11.48 | +$10.77 |
| 毛利率 | 3.6% | 28.7% | — |

### 三、风险调整后净收益

| 模式 | 毛利润 | 风险敞口 | 经风险调整净收益 |
|------|--------|---------|----------------|
| 合规模式 | $11.48 | $0.00 | **$11.48** |
| 裸奔模式 | $0.71 | 35–50% 扣押/召回概率 | **-$4.00（期望值亏损）** |

> 风险敞口说明：裸奔模式在2025年后欧盟监管环境下被查处概率约35%–50%，一旦扣押单次损失约$15.95–$31.90/台；合规模式零风险敞口。

### 四、盈亏平衡分析

- 合规溢价约 **37%**
- 盈亏平衡点：约 **295** 台
- 合规模式定价策略：建议定价 $39.99–$49.99，进入亚马逊/MediaMarkt 等主流渠道

### 五、关键结论

1. **合规溢价约 37%**：单台成本增加约 $5.90，但可支撑 2 倍以上定价。
2. **合规模式净利润 $11.48/台**，裸奔模式经风险调整后期望利润为 **负数**（约 -$4/台）。
3. **盈亏平衡点仅 295 台**，规模出货后合规成本可忽略不计。
4. **关键合规节点**：V-0 阻燃外壳、A 级电芯、USB-C/PD 芯片、CE/WEEE/EPR 注册。
5. **2027 年结构性风险**：电池可拆卸性要求（+~$1.62/台），裸奔产品届时将无法通关。

### 六、法规引用

- (EU) 2023/1542《欧盟电池法规》
- EN 62368-1 电气安全标准（外壳阻燃 V-0 级）
- Directive (EU) 2022/2380 统一充电器指令（USB-C/PD）
- RoHS 2011/65/EU / REACH (EC) No 1907/2006
- 德国 BattG / VerpackG / ElektroG EPR 体系`,
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 6.0, asp: 19.99, gp: 0.71, warranty: 0.45, total: 15.95 },
    compliant: { bom: 13.5, packaging: 0.65, cert: 0.45, epr: 0.35, logistics: 6.0, asp: 39.99, gp: 11.48, warranty: 0.9, total: 21.85 },
    bareboneRiskExposure: 6800,
    compliantRiskExposure: 320,
    keyConclusion: "合规溢价约 37%：单台成本增加约 $5.90，但可支撑 2 倍以上定价。",
    generatedAt: now,
    premiumPct: "37%",
    breakevenUnits: "295 台",
    pricingStrategy: "建议定价 $39.99–$49.99，进入亚马逊/MediaMarkt 等主流渠道",
    riskNote: "裸奔模式在2025年后欧盟监管环境下被查处概率约35%–50%，一旦扣押单次损失约$15.95–$31.90/台；合规模式零风险敞口。",
    conclusions: "1. 合规溢价约 37%：单台成本增加约 $5.90，但可支撑 2 倍以上定价。\n2. 合规模式净利润 $11.48/台，裸奔模式经风险调整后期望利润为负数（约 -$4/台）。\n3. 盈亏平衡点仅 295 台，规模出货后合规成本可忽略不计。\n4. 关键合规节点：V-0 阻燃外壳、A 级电芯、USB-C/PD 芯片、CE/WEEE/EPR 注册。\n5. 2027 年结构性风险：电池可拆卸性要求（+~$1.62/台），裸奔产品届时将无法通关。",
    references: "- (EU) 2023/1542《欧盟电池法规》\n- EN 62368-1 电气安全标准（外壳阻燃 V-0 级）\n- Directive (EU) 2022/2380 统一充电器指令（USB-C/PD）\n- RoHS 2011/65/EU / REACH (EC) No 1907/2006\n- 德国 BattG / VerpackG / ElektroG EPR 体系",
    bareboneGpm: 3.6,
    compliantGpm: 28.7,
  };
}

export const mockProfitReport = createMockProfitReport("demo");
