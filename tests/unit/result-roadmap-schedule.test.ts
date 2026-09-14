/**
 * J16 —— 排期与执行状态：roadmap 数据契约测试。
 *
 *   - buildRoadmapRows 的时间来自各 checklist 条目的 estimatedTime
 *     （缺估时回退 unknownTime「时间待估」），不产生写死的总周期。
 *   - RoadmapRow 本身不携带「已完成」状态——roadmap 是整改待办清单，
 *     完成与否需来源显式给出（J16：执行状态独立标记）。
 */
import { describe, expect, it } from "vitest";
import { buildRoadmapRows } from "@/lib/result-view-helpers";
import type { ScanResult } from "@/lib/types";

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    sessionId: "scan_j16",
    scanTime: "2026-09-14T10:00:00Z",
    productCategory: "electronics",
    targetMarkets: ["EU", "UK"],
    complianceScore: 62,
    scoreGrade: "C",
    images: [],
    documents: [],
    riskPoints: [],
    checklist: [
      {
        itemId: "check_01",
        category: "核心市场",
        categoryEn: "Core markets",
        title: "整理 CE / FCC / UKCA 合规资料包",
        titleEn: "Prepare CE / FCC / UKCA compliance evidence pack",
        requiredMaterials: ["产品规格书"],
        requiredMaterialsEn: ["Product spec"],
        estimatedCost: "¥8,000-20,000",
        estimatedTime: "第 1 周",
        estimatedTimeEn: "Week 1",
        isFree: false,
      },
      {
        itemId: "check_02",
        category: "电气安全",
        categoryEn: "Electrical safety",
        title: "完成 LVD / EMC 预扫",
        titleEn: "Run LVD / EMC pre-scan",
        requiredMaterials: ["样机 5 台"],
        requiredMaterialsEn: ["5 prototypes"],
        estimatedCost: "¥6,000-12,000",
        // 注意：此条目没有 estimatedTime
        isFree: false,
      },
    ],
    generatedAt: "2026-09-14T10:00:00Z",
    ...overrides,
  } as ScanResult;
}

describe("J16: buildRoadmapRows — 周期口径来自条目", () => {
  it("时间逐条取 estimatedTime，缺估时回退 unknownTime（时间待估），不合成固定总周期", () => {
    const rows = buildRoadmapRows(makeResult(), "zh", "时间待估");
    expect(rows).toHaveLength(3); // 2 checklist + 1 上架复核
    expect(rows[0].time).toBe("第 1 周");
    // 缺估时条目 → unknownTime，而不是写死的周期
    expect(rows[1].time).toBe("时间待估");
    // 任何行都不应出现写死的总计周期
    for (const row of rows) {
      expect(row.time).not.toContain("两周");
      expect(row.time).not.toContain("2周");
    }
  });

  it("英文名额下 estimatedTimeEn 由 localizeTimeText 映射，缺省回退 unknownTime", () => {
    const rows = buildRoadmapRows(makeResult(), "en", "Time TBD");
    expect(rows[0].time).toBe("Week 1");
    expect(rows[1].time).toBe("Time TBD");
  });

  it("空 checklist 时仍产出「上架复核」行（可行动的兜底，而不是空排期）", () => {
    const rows = buildRoadmapRows(makeResult({ checklist: [] }), "zh", "时间待估");
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("上架复核");
  });
});

describe("J16: RoadmapRow 不携带完成状态（待办/完成必须由来源显式区分）", () => {
  it("RoadmapRow 结构只有 phase/time/owner/output，没有 status 字段（渲染层不再全部打勾）", () => {
    const rows = buildRoadmapRows(makeResult(), "zh", "时间待估");
    for (const row of rows) {
      const keys = Object.keys(row).sort();
      expect(keys).toEqual(["output", "owner", "phase", "time"]);
    }
  });
});
