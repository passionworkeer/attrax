import type { ScanResult, ProfitReportResult, ComplianceReportResult } from "@/lib/types";

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

/** Demo compliance report result with rich image/risk/checklist data */
export function createMockComplianceReportResult(sessionId = "demo") {
  const now = new Date().toISOString();
  return {
    sessionId,
    scanTime: now,
    productCategory: "electronics",
    productName: "USB 智能加湿器",
    targetMarkets: ["EU", "US"] as const,
    complianceScore: 78,
    scoreGrade: "C" as const,
    complianceStatus: "WARN",
    complianceReport: `## 合规分析报告\n\n### 1. 总体评估\n\n**综合评分：78 / 100（等级 C）**\n\n该产品出口欧盟及美国市场，整体合规性基本达标，但存在 **3 项风险点** 需要关注。\n\n### 2. 产品图片分析\n\n通过视觉 AI 识别，从 3 张产品图片中提取了关键合规信息：\n\n| 图片 | 角度 | 检测区域 | 匹配法规 |\n|------|------|---------|---------|\n| humidifier-main.jpg | 正面 | 铭牌区域 | EU-CE-2014/35/EU |\n| humidifier-label.jpg | 铭牌特写 | CE 标识区域 | EU-CE-MDR |\n| humidifier-package.jpg | 包装 | 包装标识 | EU-Packaging-94/62/EC |\n\n### 3. 关键风险点\n\n#### 3.1 锂电池未做 UN 38.3 测试（严重）\n\n- **置信度**：94%\n- **涉及市场**：EU · US\n- **相关法规**：UN 38.3 · (EU) 2023/1542 · US 49 CFR\n\n加湿器内置 2000mAh 锂电池，跨境运输前必须完成 UN 38.3 认证。\n\n**建议行动**：\n- 联系有资质的实验室完成 UN 38.3 测试（约 5–8 工作日）\n- 预估整改成本：¥8,000–15,000\n\n#### 3.2 包装材料缺少 EPR 注册（警告）\n\n- **置信度**：81%\n- **涉及市场**：EU\n- **相关法规**：EU-Packaging-94/62/EC · 德国 VerpackG\n\n包装材质为普通瓦楞纸，未在德国包装注册系统（LUCID）完成注册。\n\n**建议行动**：\n- 在 LUCID 网站完成包装商注册（免费基础注册）\n- 预估整改成本：¥500–2,000\n\n#### 3.3 USB-C 充电接口不符合欧盟统一充电指令（警告）\n\n- **置信度**：67%\n- **涉及市场**：EU\n- **相关法规**：EU-2022/2380 (USB-C 统一充电指令)\n\n加湿器使用 USB-C 接口，但未在说明书或包装上注明支持 USB-PD 协议。\n\n**建议行动**：\n- 补充 USB-PD 兼容性说明，审核现有 USB-C 线缆合规性\n- 预估整改成本：¥0–1,000\n\n### 4. 合规检查清单\n\n| 检查项 | 结果 | 说明 |\n|--------|------|------|\n| CE 标识 | PASS | 铭牌清晰可见 |\n| RoHS 检测 | PASS | 已提供符合性声明 |\n| 锂电池运输认证 | FAIL | 缺 UN 38.3 报告 |\n| 包装 EPR 注册 | WARN | 德国未注册 |\n| USB-PD 说明 | WARN | 说明书缺失 |\n\n### 5. 总结\n\n该产品基础合规性较好，CE 标识和 RoHS 已达标。建议优先完成锂电池 UN 38.3 测试和德国包装 EPR 注册后再上架销售。</p>`,
    agentTrace: [
      { node: "vision", status: "PASS", duration_ms: 3200, score: 0.95 },
      { node: "query_planner", status: "PASS", duration_ms: 210, docs_retrieved: 0 },
      { node: "retriever", status: "PASS", duration_ms: 1800, docs_retrieved: 12 },
      { node: "synthesizer", status: "PASS", duration_ms: 950, score: 0.87 },
      { node: "generator", status: "PASS", duration_ms: 2100, score: 0.88 },
      { node: "verifier", status: "WARN", duration_ms: 600, score: 0.72 },
    ],
    loopCount: 1,
    retrievedChunks: [
      { regId: "EU-CE-2014/35/EU", docName: "低压指令", articleNo: "Art. 4", region: "EU", score: 0.93 },
      { regId: "EU-ROHS-2011/65/EU", docName: "RoHS 指令", articleNo: "Art. 4", region: "EU", score: 0.91 },
      { regId: "EU-REACH-1907/2006", docName: "REACH 法规", articleNo: "Art. 33", region: "EU", score: 0.88 },
      { regId: "EU-WEEE-2012/19/EU", docName: "WEEE 指令", articleNo: "Art. 8", region: "EU", score: 0.82 },
      { regId: "EU-PACKAGING-94/62/EC", docName: "包装指令", articleNo: "Art. 9", region: "EU", score: 0.76 },
      { regId: "EU-USB-C-2022/2380", docName: "统一充电指令", articleNo: "Art. 3", region: "EU", score: 0.71 },
      { regId: "US-FCC-15", docName: "FCC 第15部分", articleNo: "15.101", region: "US", score: 0.68 },
      { regId: "UN38.3", docName: "锂电池运输测试", articleNo: "ST/SG/AC.10/11", region: "INTL", score: 0.95 },
    ],
    images: [
      {
        imageId: "img_01",
        url: "/mock-fixtures/humidifier-main.jpg",
        thumbnail: "/mock-fixtures/humidifier-main.jpg",
        width: 1200,
        height: 900,
        angleHint: "front",
        bbox: { x: 0.30, y: 0.40, w: 0.25, h: 0.20 },
        matchedRegulations: ["EU-CE-2014/35/EU"],
      },
      {
        imageId: "img_02",
        url: "/mock-fixtures/humidifier-label.jpg",
        thumbnail: "/mock-fixtures/humidifier-label.jpg",
        width: 1200,
        height: 900,
        angleHint: "nameplate",
        bbox: { x: 0.34, y: 0.46, w: 0.24, h: 0.18 },
        matchedRegulations: ["EU-CE-MDR", "EU-2022/2380"],
      },
      {
        imageId: "img_03",
        url: "/mock-fixtures/humidifier-package.jpg",
        thumbnail: "/mock-fixtures/humidifier-package.jpg",
        width: 1200,
        height: 900,
        angleHint: "package",
        bbox: { x: 0.05, y: 0.10, w: 0.90, h: 0.80 },
        matchedRegulations: ["EU-PACKAGING-94/62/EC"],
      },
    ],
    documents: [],
    riskPoints: [
      {
        riskId: "risk_01",
        title: "锂电池未做 UN 38.3 测试",
        description: "内置 2000mAh 锂电池未完成 UN 38.3 运输测试，存在跨境运输合规风险。",
        severity: "critical",
        flameLevel: 1,
        confidence: 0.94,
        imageId: "img_01",
        bbox: { x: 0.48, y: 0.55, w: 0.12, h: 0.15 },
        matched_regulations: [
          { name: "UN 38.3 锂电池运输测试", article: "ST/SG/AC.10/11 Rev.5" },
          { name: "(EU) 2023/1542 欧盟电池法规", article: "Art. 7" },
          { name: "US 49 CFR 锂电池规定", article: "49 CFR 173.185" },
        ],
        suggestions: "联系有资质的实验室完成 UN 38.3 测试，准备测试报告和危包证。",
      },
      {
        riskId: "risk_02",
        title: "包装材料缺少 EPR 注册",
        description: "包装材质未在德国 LUCID 系统完成 EPR 注册，存在被罚款风险。",
        severity: "warning",
        flameLevel: 2,
        confidence: 0.81,
        imageId: "img_03",
        bbox: { x: 0.05, y: 0.10, w: 0.90, h: 0.80 },
        matched_regulations: [
          { name: "EU 包装指令", article: "94/62/EC Art. 9" },
          { name: "德国包装法", article: "VerpackG §9" },
        ],
        suggestions: "在 LUCID 网站（lucid.verpackungsregister.de）完成免费基础注册。",
      },
      {
        riskId: "risk_03",
        title: "USB-C 接口说明不完整",
        description: "产品使用 USB-C 接口但未标注支持 USB-PD 协议，不符合 EU 2022/2380 指令。",
        severity: "warning",
        flameLevel: 2,
        confidence: 0.67,
        imageId: "img_02",
        bbox: { x: 0.60, y: 0.35, w: 0.10, h: 0.12 },
        matched_regulations: [
          { name: "EU 统一充电指令", article: "(EU) 2022/2380 Art. 3" },
        ],
        suggestions: "在说明书和外包装补充 USB-PD 兼容性说明。",
      },
      {
        riskId: "risk_04",
        title: "铭牌缺少多语言警告",
        description: "铭牌仅含英文，欧盟市场需要至少英语和德语双语警告标识。",
        severity: "warning",
        flameLevel: 3,
        confidence: 0.59,
        imageId: "img_02",
        bbox: { x: 0.34, y: 0.46, w: 0.24, h: 0.18 },
        matched_regulations: [
          { name: "EU 低压指令", article: "2014/35/EU Art. 5" },
        ],
        suggestions: "补充德语警告标识，与 CE 标识一起印刷在铭牌背面。",
      },
    ],
    checklist: [
      { question: "产品是否带有清晰的 CE 标识？", answer: "铭牌清晰可见 CE 标识，符合要求。", status: "pass" },
      { question: "锂电池是否已完成 UN 38.3 测试？", answer: "未完成，需要补充测试报告。", status: "fail" },
      { question: "包装材料是否已在 EPR 系统注册？", answer: "德国 LUCID 未注册，需尽快完成。", status: "fail" },
      { question: "RoHS 合规声明是否有效？", answer: "已提供第三方检测报告，符合要求。", status: "pass" },
      { question: "USB-C 接口是否有 PD 协议说明？", answer: "说明书缺失相关说明，需补充。", status: "warn" },
      { question: "铭牌是否有多语言警告标识？", answer: "仅英文，欧盟市场需要至少双语。", status: "warn" },
      { question: "是否已在欧代注册（EU Rep）？", answer: "已注册，代理信息标注在包装上。", status: "pass" },
    ],
    status: "WARN",
    score: 78,
    summary: "产品整体合规性基本达标，存在 1 项严重风险（锂电池认证）和 3 项警告。建议优先完成 UN 38.3 测试和包装 EPR 注册后再上架欧盟市场。",
    totalRisks: 3,
    passItems: 4,
    warnItems: 3,
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
    currency: "USD",
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

/** EU market profit report for demo */
export function createMockProfitReportEU(): ProfitReportResult {
  return createMockProfitReport("demo");
}
export function createMockProfitReportUS(): ProfitReportResult {
  const now = new Date().toISOString();
  return {
    sessionId: "demo",
    productType: "USB 智能加湿器",
    market: "US",
    currency: "USD",
    report: `## [USB 智能加湿器] 合规成本与利润分析报告 · 美国市场

> 目标市场：US | 产品类型：electronics | 报告日期：${now.slice(0, 10)}

---

### 一、成本对比表

| 成本项 | 裸奔模式 | 合规模式 | 差异 |
|--------|---------|---------|------|
| 材料成本(BOM) | $9.20 | $12.80 | +$3.60 |
| 包装与印刷 | $0.25 | $0.55 | +$0.30 |
| FCC/UL 认证摊销 | $0.05 | $0.60 | +$0.55 |
| EPA 注册费 | $0.00 | $0.25 | +$0.25 |
| 售后/保修预留 | $0.45 | $0.85 | +$0.40 |
| 物流与渠道 | $7.50 | $7.50 | 持平 |
| **总直接成本** | **$17.45** | **$22.55** | **+$5.10 (+29%)** |

### 二、收益对比

| 收益项 | 裸奔模式 | 合规模式 | 差异 |
|--------|---------|---------|------|
| 平均售价(ASP) | $24.99 | $44.99 | +$20.00 |
| 毛利润(单台) | $1.04 | $13.89 | +$12.85 |
| 毛利率 | 4.2% | 30.9% | — |

### 三、风险调整后净收益

| 模式 | 毛利润 | 风险敞口 | 经风险调整净收益 |
|------|--------|---------|----------------|
| 合规模式 | $13.89 | $0.00 | **$13.89** |
| 裸奔模式 | $1.04 | 25–40% 扣押/召回概率 | **-$2.50（期望值亏损）** |

### 四、关键结论

1. 美国市场合规溢价约 29%，低于欧盟市场。
2. FCC + UL 认证是主要成本增量，但合规后可进入 Target/Home Depot 等主流渠道。
3. 合规模式净利润 $13.89/台，裸奔模式期望利润为负数。
4. 建议同时完成 FCC SDoC 和 UL 认证，覆盖线上线下全渠道。`,
    barebone: { bom: 9.2, packaging: 0.25, cert: 0.05, epr: 0, logistics: 7.5, asp: 24.99, gp: 1.04, warranty: 0.45, total: 17.45 },
    compliant: { bom: 12.8, packaging: 0.55, cert: 0.6, epr: 0.25, logistics: 7.5, asp: 44.99, gp: 13.89, warranty: 0.85, total: 22.55 },
    bareboneRiskExposure: 5500,
    compliantRiskExposure: 280,
    keyConclusion: "美国市场合规溢价约 29%，合规模式净利润 $13.89/台，裸奔模式期望利润为负数。",
    generatedAt: now,
    premiumPct: "29%",
    breakevenUnits: "240 台",
    pricingStrategy: "建议定价 $44.99–$54.99，覆盖亚马逊自营、Target、Home Depot 等渠道。",
    riskNote: "裸奔模式在美国监管环境下被查处概率约 25%–40%，一旦扣押单次损失约 $17.45–$34.90/台；合规模式零风险敞口。",
    conclusions: "1. 美国市场合规溢价约 29%。\n2. 合规模式净利润 $13.89/台，裸奔模式期望利润为负数。\n3. FCC + UL 认证是主要成本增量，完成后可进入主流渠道。",
    references: "- FCC 47 CFR Part 15\n- UL 60335-1 家用电器安全标准\n- EPA TSCA 法规\n- US 49 CFR 锂电池运输",
    bareboneGpm: 4.2,
    compliantGpm: 30.9,
  };
}
export const demoProfitReportEU = createMockProfitReportEU();
export const demoProfitReportUS = createMockProfitReportUS();
