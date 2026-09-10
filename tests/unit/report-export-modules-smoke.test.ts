import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComplianceReportResult } from "@/lib/types";
import type { DecisionContent } from "@/lib/report-export-modules/decision";
import type { RoadmapContent } from "@/lib/report-export-modules/roadmap";

/**
 * Export 链路冒烟测试（2026-09-10 审计 4.2）：
 * compliance / decision / roadmap 三条导出是付费用户关键功能，
 * 此前无任何针对产物生成的覆盖。这里 mock downloadBlob 捕获产物，
 * 断言：不抛错 + 产物为非空 Blob（PDF 走真实 jsPDF、DOCX 走真实 Packer）。
 */

const captured: Array<{ name: string; blob: Blob }> = [];

vi.mock("@/lib/report-export-modules/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/report-export-modules/shared")>();
  return {
    ...actual,
    downloadBlob: vi.fn((blob: Blob, name: string) => {
      captured.push({ name, blob });
    }),
  };
});

// 复用 report-export.test.ts 的成熟夹具形状（字段以类型为准）
const complianceInput = {
  sessionId: "scan_test",
  scanTime: "2026-09-10T10:00:00.000Z",
  productCategory: "electronics" as const,
  productName: "USB 加湿器",
  targetMarkets: ["EU", "US"] as const[],
  complianceScore: 78,
  scoreGrade: "B" as const,
  complianceReport: "# 概述\n\n测试报告。\n\n## 风险点\n\n- 缺少 CE 标识",
  complianceStatus: "PASS" as const,
  agentTrace: [],
  loopCount: 0,
  retrievedChunks: [
    { chunkId: "c1", region: "EU", docName: "EU 指令", articleNo: "Art.4", score: 0.92, text: "..." },
  ],
  images: undefined,
  documents: [{ name: "manual.pdf", nameEn: "manual.pdf", type: "pdf", size: 2048 }],
  riskPoints: undefined,
  checklist: undefined,
  generatedAt: "2026-09-10T10:00:00.000Z",
  modelInfo: { ragProvider: "mock", latencyMs: 100 },
} as unknown as ComplianceReportResult;

const decisionContent: DecisionContent = {
  sessionId: "scan_test",
  verdict: "HOLD",
  riskLevel: "high",
  summary: "两项高危缺失",
  keyFindings: ["缺少 CE 标志", "说明书语言不合规"],
  recommendedAction: "补齐 CE 认证后复审",
};

const roadmapContent: RoadmapContent = {
  sessionId: "scan_test",
  currentStatus: "整改中",
  totalDays: 30,
  totalCost: "¥ 18,000",
  items: [
    { title: "CE 认证", titleEn: "CE marking", cost: "¥ 12,000", days: 20, status: "进行中" },
    { title: "说明书改版", titleEn: "Manual update", cost: "¥ 6,000", days: 10, status: "待开始" },
  ],
};

describe("export 模块冒烟（产物生成）", () => {
  beforeEach(() => {
    // PDF 路径 fetch 真实中文字体（public/fonts/NotoSansSC-Regular.ttf），
    // 让 jsPDF 走真实渲染管线 —— 冒烟价值高于 mock。
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("NotoSansSC")
          ? readFile(join(process.cwd(), "public/fonts/NotoSansSC-Regular.ttf")).then((buf) => ({
              ok: true,
              arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
            }))
          : Promise.reject(new Error(`unexpected fetch: ${url}`))
      )
    );
  });

  afterEach(() => {
    captured.length = 0;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("compliance PDF 导出生成非空 Blob", async () => {
    const { downloadReportAsPdf } = await import("@/lib/report-export-modules/compliance");
    await downloadReportAsPdf(complianceInput, "zh");
    const hit = captured.find((c) => c.name.endsWith(".pdf"));
    expect(hit).toBeDefined();
    expect(hit!.blob.size).toBeGreaterThan(500);
  });

  it("compliance DOCX 导出生成非空 Blob", async () => {
    const { downloadReportAsDocx } = await import("@/lib/report-export-modules/compliance");
    await downloadReportAsDocx(complianceInput, "zh");
    const hit = captured.find((c) => c.name.endsWith(".docx"));
    expect(hit).toBeDefined();
    expect(hit!.blob.size).toBeGreaterThan(2000); // OOXML zip 有固定开销
  });

  it("decision PDF 导出生成非空 Blob", async () => {
    const { downloadDecisionReportAsPdf } = await import("@/lib/report-export-modules/decision");
    await downloadDecisionReportAsPdf(decisionContent, "zh");
    expect(captured.find((c) => c.name.endsWith(".pdf"))).toBeDefined();
  });

  it("decision DOCX 导出生成非空 Blob", async () => {
    const { downloadDecisionReportAsDocx } = await import("@/lib/report-export-modules/decision");
    await downloadDecisionReportAsDocx(decisionContent, "zh");
    expect(captured.find((c) => c.name.endsWith(".docx"))).toBeDefined();
  });

  it("roadmap PDF 导出生成非空 Blob", async () => {
    const { downloadRoadmapReportAsPdf } = await import("@/lib/report-export-modules/roadmap");
    await downloadRoadmapReportAsPdf(roadmapContent, "zh");
    expect(captured.find((c) => c.name.endsWith(".pdf"))).toBeDefined();
  });

  it("roadmap DOCX 导出生成非空 Blob", async () => {
    const { downloadRoadmapReportAsDocx } = await import("@/lib/report-export-modules/roadmap");
    await downloadRoadmapReportAsDocx(roadmapContent, "zh");
    expect(captured.find((c) => c.name.endsWith(".docx"))).toBeDefined();
  });
});
