/**
 * J16 / J17 / J18 / J21 —— 「流程与商业页面」工作包的行为回归测试。
 *
 * J17: 上传页照片槽随品类动态渲染；「多品类模式」误导命名改为
 *      「示例预览 · <品类>」；玩具品类显示玩具专属提示而非 CE/UKCA/FCC。
 * J16: ComplianceReportView 合规检查清单在无 status 数据时显示待办空心圈，
 *      不再默认绿色打勾。
 * J21: burning 文案不再出现「拆解 / 3D / Exploded」；4 步与 6 阶段
 *      统一为同一 6 阶段口径。
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/",
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => {
    const { fill, unoptimized, ...imageProps } = props;
    void fill;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...imageProps} alt={imageProps.alt ?? ""} />;
  },
}));

vi.mock("@/components/blaze-hawks/locale", () => ({
  useBlazeLocale: () => ({ locale: "zh" }),
  // lib/i18n 的 TranslationProvider 通过 useOptionalBlazeLocale 可选接入
  // blaze locale 上下文；脱离 provider 时返回 null 走默认 zh。
  useOptionalBlazeLocale: () => null,
}));

import UploadPage from "@/app/upload/page";
import { ComplianceReportView } from "@/components/result/ComplianceReportView";
import { TranslationProvider } from "@/lib/i18n";
import { getCompliPilotCopy } from "@/lib/complipilot/copy";
import { MARKET_IDS } from "@/lib/types";
import type { ComplianceReportResult } from "@/lib/types";
import type { ProductCategory } from "@/lib/types";

function changeCategory(next: ProductCategory) {
  const select = screen.getByLabelText(/产品品类/) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: next } });
}

describe("J17: 上传页照片槽随品类动态渲染", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((file: File) => `blob:${file.name}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it("默认品类（3C 电子）渲染 3 个建议槽位", () => {
    render(<UploadPage />);
    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/);
    expect(slotInputs).toHaveLength(3);
    expect(screen.getByText(/3 个角度/)).toBeInTheDocument();
  });

  it("切换到玩具品类后照片槽换成玩具槽（整体/包装年龄警告/附件平铺），不再显示 3C 的接口槽", () => {
    render(<UploadPage />);
    changeCategory("toy");

    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/);
    expect(slotInputs).toHaveLength(3);
    // 玩具专属槽位标题
    expect(screen.getByText("产品整体照")).toBeInTheDocument();
    expect(screen.getByText("包装与年龄警告")).toBeInTheDocument();
    expect(screen.getByText("附件平铺照")).toBeInTheDocument();
    // 旧 3C 固定槽标题不应出现
    expect(screen.queryByText("接口 / 侧面细节")).toBeNull();
    expect(screen.queryByText("正面主视图")).toBeNull();
  });

  it("玩具品类不再显示 CE/UKCA/FCC 通用提示，显示玩具专属诚实边界（量规/拉力/迁移限值不能仅凭照片断言）", () => {
    render(<UploadPage />);
    changeCategory("toy");

    // J17: 旧固定第三槽的 hint 是「CE、UKCA、FCC 与警示语」——玩具品类不得复用
    expect(screen.queryByText(/CE、UKCA、FCC/)).toBeNull();
    // 玩具专属边界说明
    expect(screen.getByText(/小零件量规/)).toBeInTheDocument();
    expect(screen.getByText(/拉力/)).toBeInTheDocument();
    expect(screen.getByText(/迁移限值/)).toBeInTheDocument();
    expect(screen.getByText(/年龄声明也不能替代包装上的年龄标注证据/)).toBeInTheDocument();
  });

  it("切换到电池品类渲染 4 个槽位（铭牌/端子/外观/包装运输标识）", () => {
    render(<UploadPage />);
    changeCategory("battery");

    const slotInputs = screen.getAllByLabelText(/上传到.+槽位/);
    expect(slotInputs).toHaveLength(4);
    expect(screen.getByText(/4 个角度/)).toBeInTheDocument();
    expect(screen.getByText("端子 / 接口近照")).toBeInTheDocument();
    expect(screen.getByText("包装运输标识")).toBeInTheDocument();
  });

  it("预览徽标不再叫「多品类模式」，改为「示例预览 · <品类>」", () => {
    render(<UploadPage />);
    // 默认 3C 电子
    expect(screen.getByText(/示例预览 · 3C 电子/)).toBeInTheDocument();
    expect(screen.queryByText(/多品类模式/)).toBeNull();

    changeCategory("toy");
    expect(screen.getByText(/示例预览 · 玩具/)).toBeInTheDocument();
  });

  it("品类切换后，条件问题按品类切换（玩具显示年龄/磁体问题，3C 显示内置电池问题）", () => {
    render(<UploadPage />);
    changeCategory("toy");
    expect(screen.getByText("目标适用年龄是？")).toBeInTheDocument();
    expect(screen.getByText("是否含磁体部件？")).toBeInTheDocument();

    changeCategory("electronics");
    expect(screen.getByText("是否内置电池？")).toBeInTheDocument();
    // 玩具问题应被清空（切换品类清除旧答案与问题集）
    expect(screen.queryByText("目标适用年龄是？")).toBeNull();
  });
});

describe("J16: ComplianceReportView 检查清单缺省状态为待办（不再全部打勾）", () => {
  function makeChecklistResult(
    checklist: Array<Record<string, unknown>>,
  ): ComplianceReportResult {
    return {
      sessionId: "scan_j16_test",
      scanTime: "2026-09-14T10:00:00Z",
      productCategory: "electronics",
      productName: "Test Product",
      productNameEn: "Test Product",
      targetMarkets: ["EU", "US"],
      complianceScore: 65,
      scoreGrade: "C",
      complianceReport: "## Report",
      complianceStatus: "WARN",
      agentTrace: [],
      loopCount: 0,
      retrievedChunks: [],
      source: "real",
      ...({
        images: [
          {
            imageId: "img1",
            url: "/uploads/1.jpg",
            thumbnail: "/uploads/t1.jpg",
            width: 800,
            height: 600,
          },
        ],
        checklist,
      } as unknown as Partial<ComplianceReportResult>),
    } as ComplianceReportResult;
  }

  it("无 status 字段的清单项渲染待办空心圈，而不是绿色 ✓", () => {
    // 与真实路径一致的形态：ChecklistItem（itemId/category/title/…）没有
    // question/answer/status 字段。旧版默认 status="pass" → 全部绿色打勾。
    const result = makeChecklistResult([
      { id: "chk_001", category: "核心市场", title: "证据补全与产品身份确认", actionRequired: "补齐铭牌照片" },
      { id: "chk_002", category: "实验室", title: "实验室测试申请", actionRequired: "送检 RoHS" },
    ]);
    const { container } = render(
      <TranslationProvider>
        <ComplianceReportView result={result} />
      </TranslationProvider>,
    );

    // 待办空心圈：中性边框样式，非 emerald 实心
    const statusBadge = container.querySelector(".border-slate-500");
    expect(statusBadge).toBeInTheDocument();
    expect(statusBadge?.textContent).toContain("○");
    // 不得出现绿色 pass 徽标
    expect(container.querySelector(".bg-emerald-500")).toBeNull();
  });

  it("来源显式给出 status=pass 的清单项仍然显示绿色 ✓（完成状态独立标记）", () => {
    const result = makeChecklistResult([
      { question: "多语言警示齐全？", answer: "齐全", status: "pass" },
    ]);
    const { container } = render(
      <TranslationProvider>
        <ComplianceReportView result={result} />
      </TranslationProvider>,
    );
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
  });
});

describe("J21: 命名纠正 — 不再宣称 3D/拆解/空间建模", () => {
  it("burning 文案（zh/en）不再包含 拆解 / 3D / 2.5D / Exploded / dismantling / spatial", () => {
    const zh = getCompliPilotCopy("zh");
    const en = getCompliPilotCopy("en");
    const zhText = JSON.stringify(zh.burning);
    const enText = JSON.stringify(en.burning);

    for (const banned of ["拆解", "3D", "2.5D"]) {
      expect(zhText, `zh burning 不应包含 ${banned}`).not.toContain(banned);
    }
    for (const banned of ["Exploded", "dismantling", "spatial", "3D", "2.5D"]) {
      expect(enText, `en burning 不应包含 ${banned}`).not.toContain(banned);
    }
  });

  it("burning analysisSteps 与 6 阶段流水线统一（不再 4 步与 6 阶段并列）", () => {
    const zh = getCompliPilotCopy("zh");
    const en = getCompliPilotCopy("en");
    // 与 components/complipilot/scan-image-stage.tsx PHASE_LABELS 的 6 阶段一致
    expect(zh.burning.analysisSteps).toHaveLength(6);
    expect(en.burning.analysisSteps).toHaveLength(6);
    const titles = zh.burning.analysisSteps.map((s) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining(["上传与预处理", "图像观察", "适用性判断", "报告生成", "引用核对"]),
    );
  });

  it("upload.previewAutoJump 不再指向「3D 拆解页」", () => {
    const zh = getCompliPilotCopy("zh");
    const en = getCompliPilotCopy("en");
    expect(zh.upload.previewAutoJump).toContain("图像证据分析");
    expect(zh.upload.previewAutoJump).not.toContain("3D");
    expect(en.upload.previewAutoJump).not.toContain("3D");
  });
});

describe("J18: 首页/法规入口能力边界诚实标注", () => {
  it("MARKET_IDS 数量与首页 stat 计算口径一致（16，不再是写死的 42）", () => {
    // homepage.tsx 使用 MARKET_IDS.length；该断言锁住数据源本身
    expect(MARKET_IDS).toHaveLength(16);
    expect(MARKET_IDS).not.toContain("IN");
  });
});
