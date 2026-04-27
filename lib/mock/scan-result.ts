import type { ScanResult } from "@/lib/types";

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

export const mockScanResult = createMockScanResult("demo");
