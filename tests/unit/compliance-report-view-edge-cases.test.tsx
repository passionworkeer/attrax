import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ComplianceReportView } from "@/components/result/ComplianceReportView";
import { TranslationProvider } from "@/lib/i18n";
import type { ComplianceReportResult } from "@/lib/types";

vi.mock("@/lib/report-download", () => ({
  downloadReportAsDocx: vi.fn(),
  downloadReportAsPdf: vi.fn(),
  downloadDecisionReportAsDocx: vi.fn(),
  downloadDecisionReportAsPdf: vi.fn(),
  downloadRoadmapReportAsDocx: vi.fn(),
  downloadRoadmapReportAsPdf: vi.fn(),
}));

function renderInProvider(node: React.ReactNode) {
  return render(<TranslationProvider>{node}</TranslationProvider>);
}

describe("ComplianceReportView Edge Cases & Defensive Rendering", () => {
  const baseResult: ComplianceReportResult = {
    sessionId: "test_view_001",
    scanTime: "2026-09-13T10:00:00Z",
    productCategory: "electronics",
    productName: "Test GaN Charger",
    productNameEn: "Test GaN Charger",
    targetMarkets: ["EU", "US"],
    complianceScore: 78,
    scoreGrade: "B",
    complianceReport: "# Compliance Overview\n\nAll primary checks completed.",
    complianceStatus: "WARN",
    agentTrace: [{ node: "vision", label: "Image analyzed" }],
    loopCount: 1,
    retrievedChunks: [],
    source: "real",
  };

  it("renders safely when riskPoints have undefined matched_regulations (legacy or demo format)", () => {
    const resultWithRawRisks = {
      ...baseResult,
      images: [
        {
          imageId: "img_001",
          url: "/mock-fixtures/preset-charger-photo.png",
          filename: "charger.png",
          ocrTexts: [],
        },
      ],
      riskPoints: [
        {
          riskId: "risk_001",
          title: "Missing CE Mark",
          titleEn: "Missing CE Mark",
          description: "Shell has no CE label visible.",
          descriptionEn: "Shell has no CE label visible.",
          severity: "critical" as const,
          // matched_regulations is undefined!
          regulations: [
            {
              regId: "REG_EMC_001",
              name: "EMC Directive",
              nameEn: "EMC Directive 2014/30/EU",
              article: "Article 6",
            },
          ],
          confidence: 0.92,
          imageId: "img_001",
          bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
        },
      ],
    };

    renderInProvider(<ComplianceReportView result={resultWithRawRisks as unknown as ComplianceReportResult} />);

    expect(screen.getByText(/Missing CE Mark|未找到 CE 标识/i)).toBeDefined();
    expect(screen.getByText(/EMC Directive/i)).toBeDefined();
    expect(screen.getByText(/92%/)).toBeDefined();
  });

  it("renders safely when confidence is missing without producing NaN%", () => {
    const resultMissingConfidence = {
      ...baseResult,
      images: [
        {
          imageId: "img_002",
          url: "/mock-fixtures/preset-charger-photo.png",
          filename: "charger.png",
          ocrTexts: [],
        },
      ],
      riskPoints: [
        {
          riskId: "risk_002",
          title: "Voltage Spec Missing",
          description: "Output voltage ratings are omitted.",
          severity: "warning" as const,
          confidence: undefined, // missing confidence
          matched_regulations: [],
        },
      ],
    };

    renderInProvider(<ComplianceReportView result={resultMissingConfidence as unknown as ComplianceReportResult} />);

    expect(screen.queryByText(/NaN%/)).toBeNull();
    // Default fallback 95%
    expect(screen.getByText(/95%/)).toBeDefined();
  });

  it("renders checklist items safely when question/answer use title/actionRequired", () => {
    const resultChecklist = {
      ...baseResult,
      images: [
        {
          imageId: "img_003",
          url: "/mock-fixtures/preset-charger-photo.png",
          filename: "charger.png",
          ocrTexts: [],
        },
      ],
      checklist: [
        {
          id: "chk_001",
          category: "labeling",
          title: "Check Warning Icons",
          titleEn: "Check Warning Icons",
          actionRequired: "Ensure exclamation triangle is present",
          actionRequiredEn: "Ensure exclamation triangle is present",
          // question and answer undefined
        },
      ],
    };

    renderInProvider(<ComplianceReportView result={resultChecklist as unknown as ComplianceReportResult} />);

    expect(screen.getByText(/Check Warning Icons/i)).toBeDefined();
    expect(screen.getByText(/Ensure exclamation triangle is present/i)).toBeDefined();
  });

  it("renders citations list and evidence pack button when citations exist in reportPackage", () => {
    const resultWithCitations: ComplianceReportResult = {
      ...baseResult,
      reportPackage: {
        sessionId: "test_view_001",
        generatedAt: "2026-09-13T10:00:00Z",
        citations: [
          {
            doc_id: "EU-2023-1542",
            article_id: "art-13",
            official_citation: "Regulation (EU) 2023/1542",
            quote: "Batteries must be labelled with the CE mark.",
            match_status: "matched",
          },
        ],
      },
    };

    renderInProvider(<ComplianceReportView result={resultWithCitations} />);

    expect(screen.getByRole("link", { name: /Regulation \(EU\) 2023\/1542/i })).toBeDefined();
    expect(screen.getByText(/Batteries must be labelled with the CE mark/i)).toBeDefined();
    expect(screen.getByText(/证据包 PDF|Evidence Pack/i)).toBeDefined();
  });
});
