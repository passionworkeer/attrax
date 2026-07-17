import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { normalizeV1ScanResult } from "@/lib/rag-client/v1-result-adapter";
import type { V1SessionData } from "@/lib/rag-client/v1-adapter";

function session(overrides: Partial<V1SessionData> = {}): V1SessionData {
  return {
    sessionId: "scan_real1",
    status: "ready",
    progress: 100,
    stageText: "complete",
    category: "electronics",
    markets: ["EU"],
    createdAt: "2026-07-17T08:00:00Z",
    updatedAt: "2026-07-17T08:01:00Z",
    result: {
      sessionId: "scan_real1",
      productName: "USB charger",
      productCategory: "electronics",
      targetMarkets: ["EU"],
      complianceStatus: "WARN",
      retrievedChunks: [
        {
          id: "rule-1",
          docName: "EU LVD",
          articleNo: "Article 5",
          region: "EU",
          score: 0.91,
          url: "https://eur-lex.europa.eu/",
        },
      ],
      reportPackage: {
        roadmap: {
          items: [
            {
              id: "label-fix",
              title: "补齐输入输出标识",
              description: "在铭牌中补齐参数",
              cost: "¥500",
              estimatedDays: 2,
              documents: ["铭牌稿"],
            },
          ],
        },
        decisionView: {
          nodes: [
            {
              id: "risk-label",
              label: "铭牌信息不完整",
              reasoning: "输入输出参数缺失",
              status: "warning",
              confidence: 0.86,
            },
          ],
        },
        auditMetadata: { provider: "minimax", generatedAt: "2026-07-17T08:01:00Z" },
      },
    },
    error: null,
    ...overrides,
  };
}

describe("normalizeV1ScanResult", () => {
  it("derives visible risks and checklist from backend evidence", () => {
    const result = normalizeV1ScanResult(session());

    expect(result).toMatchObject({
      sessionId: "scan_real1",
      productName: "USB charger",
      complianceScore: 65,
      scoreGrade: "C",
      source: "real",
      modelInfo: { visionProvider: "minimax" },
    });
    expect(result?.riskPoints[0]).toMatchObject({
      riskId: "risk-label",
      title: "铭牌信息不完整",
      description: "输入输出参数缺失",
    });
    expect(result?.riskPoints[0].regulations[0].code).toBe("Article 5");
    expect(result?.checklist[0]).toMatchObject({
      itemId: "label-fix",
      title: "补齐输入输出标识",
      estimatedCost: "¥500",
    });
    expect(result?.financialSummary).toBeUndefined();
  });

  it("marks degraded backend output without inventing mock data", () => {
    const degraded = normalizeV1ScanResult(
      session({ status: "degraded", result: { complianceStatus: "DEMO" } }),
    );

    expect(degraded?.source).toBe("fallback");
    expect(degraded?.riskPoints).toEqual([]);
    expect(degraded?.checklist).toEqual([]);
    expect(degraded?.financialSummary).toBeUndefined();
  });

  it("does not silently replace a real session with the demo fixture", async () => {
    const source = await readFile("app/result/[sessionId]/page.tsx", "utf8");

    expect(source).not.toContain("setResult(mockScanResult)");
  });
});
