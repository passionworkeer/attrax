/**
 * J17（计划 §5.4）—— 品类 manifest 数据契约测试。
 *
 * 验证 lib/upload/category-manifest.ts 的结构与计划 §5.4 表格一致：
 *   - 十个品类全部定义
 *   - 每个品类 photoSlots 数量在 2-4（≤ MAX_UPLOAD_FILES 8）
 *   - 3C：正反面/铭牌/接口与包装槽 + 内置电池/无线/输入电压/适配器问题
 *   - 玩具：整体/包装年龄警告/附件平铺槽 + 年龄/磁体/绳带/电池问题
 *   - 玩具不再套用 3C 的 CE/UKCA/FCC 提示语
 *   - 「不应仅凭照片断言」诚实边界文案存在
 */
import { describe, expect, it } from "vitest";
import {
  CATEGORY_MANIFESTS,
  getCategoryManifest,
} from "@/lib/upload/category-manifest";
import type { ProductCategory } from "@/lib/types";

const EXPECTED_CATEGORIES: ProductCategory[] = [
  "electronics",
  "appliance",
  "3c",
  "toy",
  "home",
  "battery",
  "cosmetic",
  "textile",
  "food_contact",
  "other",
];

describe("J17: category manifests — 结构契约", () => {
  it("十个品类全部定义且可按 id 查询", () => {
    for (const id of EXPECTED_CATEGORIES) {
      const manifest = CATEGORY_MANIFESTS[id];
      expect(manifest, `manifest for ${id}`).toBeDefined();
      expect(manifest.id).toBe(id);
      expect(getCategoryManifest(id).id).toBe(id);
    }
  });

  it("未知品类回退到 other（克制降级，不抛错）", () => {
    const manifest = getCategoryManifest("other");
    expect(manifest.id).toBe("other");
  });

  it("每个品类 photoSlots 数量在 2-4 之间（上限 8 不变）", () => {
    for (const id of EXPECTED_CATEGORIES) {
      const { photoSlots } = CATEGORY_MANIFESTS[id];
      expect(
        photoSlots.length,
        `${id} photoSlots count`,
      ).toBeGreaterThanOrEqual(2);
      expect(photoSlots.length).toBeLessThanOrEqual(4);
      expect(photoSlots.length).toBeLessThanOrEqual(8);
    }
  });

  it("每个 photoSlot 带 view/label/labelEn/hint/hintEn（中英齐全）", () => {
    for (const id of EXPECTED_CATEGORIES) {
      for (const slot of CATEGORY_MANIFESTS[id].photoSlots) {
        expect(slot.view.length).toBeGreaterThan(0);
        expect(slot.label.length).toBeGreaterThan(0);
        expect(slot.labelEn.length).toBeGreaterThan(0);
        expect(slot.hint.length).toBeGreaterThan(0);
        expect(slot.hintEn.length).toBeGreaterThan(0);
      }
    }
  });

  it("每个品类都有 notPhotoAssertable 诚实边界（中英）", () => {
    for (const id of EXPECTED_CATEGORIES) {
      const manifest = CATEGORY_MANIFESTS[id];
      expect(manifest.notPhotoAssertable.length).toBeGreaterThan(10);
      expect(manifest.notPhotoAssertableEn.length).toBeGreaterThan(10);
    }
  });
});

describe("J17: 3C/数码配件 manifest（计划 §5.4 表格）", () => {
  const manifest = CATEGORY_MANIFESTS["3c"];

  it("photoSlots 覆盖 正反面/铭牌/接口与包装", () => {
    const views = manifest.photoSlots.map((slot) => slot.view);
    expect(views).toContain("front_back");
    expect(views).toContain("nameplate");
    expect(views).toContain("ports_packaging");
  });

  it("conditionalQuestions 覆盖 内置电池/无线/输入电压/适配器", () => {
    const questionIds = manifest.conditionalQuestions.map((q) => q.id);
    expect(questionIds).toContain("builtin_battery");
    expect(questionIds).toContain("wireless");
    expect(questionIds).toContain("input_voltage");
    expect(questionIds).toContain("adapter_included");
  });

  it("每个条件问题都有选项（可回答）", () => {
    for (const question of manifest.conditionalQuestions) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("J17: 玩具 manifest（计划 §5.4 表格）", () => {
  const manifest = CATEGORY_MANIFESTS.toy;

  it("photoSlots 覆盖 整体/包装年龄警告/附件平铺", () => {
    const views = manifest.photoSlots.map((slot) => slot.view);
    expect(views).toContain("overall");
    expect(views).toContain("package_age_warning");
    expect(views).toContain("accessories_flat");
  });

  it("conditionalQuestions 覆盖 年龄/磁体/绳带/电池", () => {
    const questionIds = manifest.conditionalQuestions.map((q) => q.id);
    expect(questionIds).toContain("age_grade");
    expect(questionIds).toContain("magnets");
    expect(questionIds).toContain("cords_ropes");
    expect(questionIds).toContain("battery");
  });

  it("玩具的槽位提示不含 3C 通用的 CE/UKCA/FCC 误导（J17：旧固定 3 槽的第三槽提示为「CE、UKCA、FCC 与警示语」）", () => {
    const allHints = manifest.photoSlots
      .map((slot) => `${slot.hint} ${slot.hintEn}`)
      .join("\n");
    expect(allHints).not.toContain("CE、UKCA、FCC");
    expect(allHints).not.toContain("CE, UKCA, FCC");
  });

  it("玩具 notPhotoAssertable 明确 量规/拉力/磁通量/迁移限值 不能仅凭照片断言", () => {
    expect(manifest.notPhotoAssertable).toContain("小零件量规");
    expect(manifest.notPhotoAssertable).toContain("拉力");
    expect(manifest.notPhotoAssertable).toContain("磁通量");
    expect(manifest.notPhotoAssertable).toContain("迁移限值");
  });

  it("玩具 documentHints 包含材料来源类提示（磁体/绳带/电池需附来源）", () => {
    const hints = manifest.documentHints.join("\n");
    expect(hints).toContain("来源");
  });
});

describe("J17: 其余品类槽位要点（计划 §5.4 表格抽样）", () => {
  it("家电：整机/铭牌/插头与操作警告，问市电/加热电机/用途", () => {
    const manifest = CATEGORY_MANIFESTS.appliance;
    const views = manifest.photoSlots.map((slot) => slot.view);
    expect(views).toEqual(
      expect.arrayContaining(["overall", "nameplate", "plug_warnings"]),
    );
    const ids = manifest.conditionalQuestions.map((q) => q.id);
    expect(ids).toEqual(
      expect.arrayContaining(["mains_powered", "heating_or_motor", "usage_scenario"]),
    );
  });

  it("电池/储能：铭牌/端子/外观/包装运输标识，问类型/容量Wh/用途", () => {
    const manifest = CATEGORY_MANIFESTS.battery;
    const views = manifest.photoSlots.map((slot) => slot.view);
    expect(views).toEqual(
      expect.arrayContaining(["nameplate", "terminals", "appearance", "transport_marks"]),
    );
    const ids = manifest.conditionalQuestions.map((q) => q.id);
    expect(ids).toEqual(
      expect.arrayContaining(["battery_chemistry", "capacity_wh", "usage"]),
    );
  });

  it("化妆品：正背标签/成分/净含量批次，问用途/人群/宣称", () => {
    const manifest = CATEGORY_MANIFESTS.cosmetic;
    const ids = manifest.conditionalQuestions.map((q) => q.id);
    expect(ids).toEqual(
      expect.arrayContaining(["purpose", "target_group", "claims"]),
    );
  });

  it("食品接触：整体/接触面/材质用途标签，问接触/温度/重复使用", () => {
    const manifest = CATEGORY_MANIFESTS.food_contact;
    const ids = manifest.conditionalQuestions.map((q) => q.id);
    expect(ids).toEqual(
      expect.arrayContaining(["food_contact", "temperature", "reuse"]),
    );
  });

  it("其他品类的问题引导先确认子类（不能套通用品类直接下完整结论）", () => {
    const manifest = CATEGORY_MANIFESTS.other;
    expect(manifest.conditionalQuestions[0]?.id).toBe("subcategory");
    expect(manifest.notPhotoAssertable).toContain("子类");
  });
});
