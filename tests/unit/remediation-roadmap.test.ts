import { describe, expect, it } from "vitest";
import { buildRemediationRoadmap } from "@/lib/result/remediation-roadmap";
import type { GeneratedRoadmapItem, ScanResult } from "@/lib/types";

function result(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    sessionId: "scan_roadmap",
    scanTime: "2026-09-19T08:00:00Z",
    productCategory: "toy",
    targetMarkets: ["US"],
    complianceScore: 62,
    scoreGrade: "C",
    images: [], documents: [], riskPoints: [], generatedAt: "2026-09-19T08:00:00Z",
    checklist: [{ itemId: "age_label", category: "标签核验", title: "补齐年龄标识证据", requiredMaterials: ["包装六面图"], isFree: true }],
    ...overrides,
  } as ScanResult;
}

describe("buildRemediationRoadmap", () => {
  it("uses explicit roadmap status and backend total duration", () => {
    const model = buildRemediationRoadmap(result({ reportPackage: { roadmap: { totalDays: 12, items: [{ id: "r1", title: "补齐测试报告", status: "in-progress", type: "test", estimatedDays: 5, cost: "¥12K-35K", documents: ["测试报告"] }] } } }), "zh");
    expect(model.rows[0]).toMatchObject({ status: "in-progress", time: "预计 5 天", cost: "¥12K-35K", phase: "检测验证" });
    expect(model.totalTime).toBe("预计 12 天");
    expect(model.focusIndex).toBe(0);
  });

  it("falls back to checklist without inventing duration or completion", () => {
    const model = buildRemediationRoadmap(result(), "zh");
    expect(model.totalTime).toBe("待评估");
    expect(model.rows[0]).toMatchObject({ status: "pending", time: "待评估", cost: "¥1.5K-5K", checkId: "age_label" });
    expect(model.rows.at(-1)?.phase).toBe("上架复核");
  });

  it("estimates conservative ranges when the backend has no quote", () => {
    const model = buildRemediationRoadmap(result({ reportPackage: { roadmap: { items: [
      { id: "photo", title: "补充实物批次与UPC照片", type: "apply", cost: "待询价" },
      { id: "transport", title: "获取UN38.3运输报告", type: "certify" },
    ] } } }), "zh");
    expect(model.rows[0].cost).toBe("¥0-2K");
    expect(model.rows[1].cost).toBe("¥3K-8K");
  });

  it("removes the estimate prefix from model-provided cost ranges", () => {
    const model = buildRemediationRoadmap(result({ reportPackage: { roadmap: { items: [
      { id: "quoted", title: "检测", type: "test", cost: "AI估算 ¥5K-10K" },
    ] } } }), "zh");
    expect(model.rows[0].cost).toBe("¥5K-10K");
  });

  it("keeps only the first price range and drops conditional retest text", () => {
    const model = buildRemediationRoadmap(result({ reportPackage: { roadmap: { items: [
      { id: "compound", title: "索取证书对应测试报告", type: "test", cost: "¥0-3,000（整理核阅）；如需第三方复测 AI估算 ¥15,000-40,000" },
    ] } } }), "zh");
    expect(model.rows[0].cost).toBe("¥0-3,000");
    expect(model.rows[0].cost).not.toContain("第三方复测");
    expect(model.rows[0].cost).not.toContain("AI估算");
  });

  it("keeps rendering when the model emits a type or status outside the enum", () => {
    // 生产会话里出现过后端未约束的取值（type "verify"、status 任意字符串），
    // 这里锁定枚举外的值不会让整个结果页渲染失败。
    const rogueType = { id: "astm-version", title: "标准版本交叉核对", type: "verify", status: "done", cost: "待询价" } as unknown as GeneratedRoadmapItem;
    const upperCaseType = { id: "lab", title: "送检", type: "Test", cost: "待询价" } as unknown as GeneratedRoadmapItem;
    const model = buildRemediationRoadmap(result({ reportPackage: { roadmap: { items: [rogueType, upperCaseType] } } }), "zh");
    expect(model.rows[0]).toMatchObject({ phase: "资料准备", owner: "产品 / 采购", status: "pending" });
    expect(model.rows[1]).toMatchObject({ phase: "检测验证", owner: "测试 / 合规" });
    expect(model.roleCount).toBe(4);
  });
});
