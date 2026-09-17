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
    assets: [
      {
        kind: "image",
        index: 0,
        name: "front.png",
        contentType: "image/png",
        size: 1024,
      },
    ],
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
          content: "A".repeat(2_000),
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
              severity: "medium",
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
    expect(result?.riskPoints[0].regulations[0].summary.length).toBeLessThanOrEqual(600);
    expect(result?.checklist[0]).toMatchObject({
      itemId: "label-fix",
      title: "补齐输入输出标识",
      estimatedCost: "¥500",
    });
    expect(result?.images).toEqual([
      expect.objectContaining({
        imageId: "scan_real1-image-0",
        url: "/api/scan/scan_real1/asset/0",
        fileName: "front.png",
      }),
    ]);
    expect(result?.reportPackage?.auditMetadata?.provider).toBe("minimax");
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

  it("preserves battery category and the configured qwen provider", () => {
    const result = normalizeV1ScanResult(
      session({
        category: "battery",
        result: {
          productCategory: "battery",
          targetMarkets: ["EU"],
          complianceStatus: "WARN",
          reportPackage: {
            auditMetadata: { provider: "qwen" },
          },
        },
      }),
    );

    expect(result?.productCategory).toBe("battery");
    expect(result?.modelInfo?.visionProvider).toBe("qwen");
  });

  it("does not silently replace a real session with the demo fixture", async () => {
    const source = await readFile("app/result/[sessionId]/page.tsx", "utf8");
    const profitSource = await readFile("app/profit/[sessionId]/profit-page-content.tsx", "utf8");

    expect(source).not.toContain("setResult(mockScanResult)");
    const imageSource = await readFile("components/result/review-image.tsx", "utf8");
    expect(imageSource).toContain('src={image.url}');
    expect(source).toContain("isDemoSession ? scanResultToComplianceView");
    expect(profitSource).not.toContain("setResult(mockScanResult)");
  });

  // ── J04-b (plan 2026-09-14 §4.4, first layer): legacy sessions persisted by
  // the OLD backend build carry camelCased citation keys (docId/articleId) —
  // that's what rendered "Citation undefined (matched)" →
  // /regulations/undefined. The BFF now re-asserts snake_case at the boundary,
  // but stored legacy sessions pass through `normalizeV1ScanResult`, which
  // must normalize BOTH casing shapes and drop id-less entries.
  it("normalizes legacy camelCase citation keys to the snake_case contract", () => {
    const result = normalizeV1ScanResult(
      session({
        result: {
          sessionId: "scan_real1",
          productName: "USB charger",
          productCategory: "electronics",
          targetMarkets: ["EU"],
          complianceStatus: "WARN",
          retrievedChunks: [],
          reportPackage: {
            citations: [
              {
                // Legacy camelCase shape stored by the old build.
                docId: "EU-2014-35",
                articleId: "art-7",
                officialCitation: "LVD Art. 7",
                quote: "Electrical equipment must be safe.",
                quoteSpan: [4, 36],
                matchStatus: "matched",
              },
              // Missing ids → dropped, never rendered as an undefined chip.
              { docId: "", articleId: "", matchStatus: "matched" },
            ],
            evidencePack: [
              {
                docId: "EU-2014-35",
                articleId: "art-7",
                matchStatus: "matched",
              },
            ],
            auditMetadata: { provider: "minimax", generatedAt: "2026-07-17T08:01:00Z" },
          },
        },
      }),
    );

    const citations = result?.reportPackage?.citations ?? [];
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      doc_id: "EU-2014-35",
      article_id: "art-7",
      official_citation: "LVD Art. 7",
      match_status: "matched",
      quote_span: [4, 36],
    });
    // The camel twins must not survive — CitationChip reads doc_id directly.
    expect(citations[0]).not.toHaveProperty("docId");
    expect(citations[0]).not.toHaveProperty("articleId");

    const evidencePack = result?.reportPackage?.evidencePack ?? [];
    expect(evidencePack).toHaveLength(1);
    expect(evidencePack[0]).toMatchObject({ doc_id: "EU-2014-35", article_id: "art-7" });
  });

  it("keeps native snake_case citations unchanged (no double conversion)", () => {
    const result = normalizeV1ScanResult(
      session({
        result: {
          sessionId: "scan_real1",
          productName: "USB charger",
          productCategory: "electronics",
          targetMarkets: ["EU"],
          complianceStatus: "WARN",
          retrievedChunks: [],
          reportPackage: {
            citations: [
              {
                doc_id: "EU-2009-48",
                article_id: "art-5",
                official_citation: "Directive 2009/48/EC, Art. 5",
                quote: "Toy safety requirements.",
                quote_span: [0, 24],
                match_status: "fallback_article_only",
              },
            ],
            auditMetadata: { provider: "minimax", generatedAt: "2026-07-17T08:01:00Z" },
          },
        },
      }),
    );

    const citations = result?.reportPackage?.citations ?? [];
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      doc_id: "EU-2009-48",
      article_id: "art-5",
      match_status: "fallback_article_only",
      quote_span: [0, 24],
    });
  });

  it("drops citation entries without usable doc/article ids (no undefined chips)", () => {
    const result = normalizeV1ScanResult(
      session({
        result: {
          sessionId: "scan_real1",
          productName: "USB charger",
          productCategory: "electronics",
          targetMarkets: ["EU"],
          complianceStatus: "WARN",
          retrievedChunks: [],
          reportPackage: {
            citations: [
              { docId: "EU-X", articleId: "" }, // article missing → drop
              { docId: "", articleId: "art-9" }, // doc missing → drop
              { quote: "orphan quote" }, // both missing → drop
            ],
            auditMetadata: { provider: "minimax", generatedAt: "2026-07-17T08:01:00Z" },
          },
        },
      }),
    );

    expect(result?.reportPackage?.citations).toEqual([]);
    expect(result?.reportPackage?.evidencePack).toEqual([]);
  });
});
