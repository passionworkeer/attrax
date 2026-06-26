/**
 * Tests for ComplianceReportView (P2 #6 split, never covered).
 * Mocks lib/report-export so PDF/DOCX don't actually fire.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { ComplianceReportView } from "@/components/result/ComplianceReportView";
import { TranslationProvider } from "@/lib/i18n";
import type { ComplianceReportResult } from "@/lib/types";

vi.mock("@/lib/report-export", () => ({
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

function makeReport(overrides: Partial<ComplianceReportResult> = {}): ComplianceReportResult {
  return {
    sessionId: "scan_compliance_test",
    scanTime: new Date().toISOString(),
    productCategory: "electronics",
    productName: "Test Product",
    targetMarkets: ["EU", "US"],
    complianceScore: 75,
    scoreGrade: "B",
    complianceReport: "## Full report\nBody text.",
    complianceStatus: "PASS",
    agentTrace: [{ node: "vision", status: "success", duration_ms: 1200 }],
    loopCount: 1,
    retrievedChunks: [
      { regId: "r1", docName: "CE-RED", articleNo: "Art.3", region: "EU", score: 0.91 },
      { regId: "r2", docName: "FCC Part 15", articleNo: "§15.1", region: "US", score: 0.85 },
    ],
    images: undefined,
    documents: [],
    riskPoints: undefined,
    checklist: undefined,
    generatedAt: new Date().toISOString(),
    modelInfo: { ragProvider: "minimax", latencyMs: 2400 },
    ...overrides,
  };
}

describe("ComplianceReportView — STATUS_META mapping", () => {
  it("renders the green/emerald style for PASS", () => {
    const { container } = renderInProvider(
      <ComplianceReportView result={makeReport({ complianceStatus: "PASS" })} />,
    );
    expect(container.querySelector(".text-emerald-400")).toBeInTheDocument();
    expect(container.querySelector(".bg-emerald-500\\/15")).toBeInTheDocument();
  });

  it("renders the amber style for WARN", () => {
    const { container } = renderInProvider(
      <ComplianceReportView result={makeReport({ complianceStatus: "WARN" })} />,
    );
    expect(container.querySelector(".text-amber-400")).toBeInTheDocument();
  });

  it("renders the blaze-red style for REJECTED", () => {
    const { container } = renderInProvider(
      <ComplianceReportView result={makeReport({ complianceStatus: "REJECTED" })} />,
    );
    expect(container.querySelector(".text-blaze-red")).toBeInTheDocument();
  });

  it("falls back to the slate UNKNOWN style for an unknown status", () => {
    const { container } = renderInProvider(
      <ComplianceReportView
        result={makeReport({ complianceStatus: "UNKNOWN" as ComplianceReportResult["complianceStatus"] })}
      />,
    );
    // UNKNOWN -> slate-400 + slate-500/15 + border-white/10
    expect(container.querySelector(".text-slate-400")).toBeInTheDocument();
  });
});

describe("ComplianceReportView — GRADE_COLORS mapping", () => {
  it("renders blaze-cyan for grade B", () => {
    const { container } = renderInProvider(
      <ComplianceReportView result={makeReport({ scoreGrade: "B" })} />,
    );
    expect(container.querySelector(".text-blaze-cyan")).toBeInTheDocument();
  });

  it("renders blaze-red for grade D", () => {
    const { container } = renderInProvider(
      <ComplianceReportView result={makeReport({ scoreGrade: "D" })} />,
    );
    expect(container.querySelector(".text-blaze-red")).toBeInTheDocument();
  });

  it("falls back to text-gray-400 for an unknown grade", () => {
    const { container } = renderInProvider(
      <ComplianceReportView
        result={makeReport({ scoreGrade: "X" as ComplianceReportResult["scoreGrade"] })}
      />,
    );
    expect(container.querySelector(".text-gray-400")).toBeInTheDocument();
  });
});

describe("ComplianceReportView — score + meta header", () => {
  it("renders the compliance score as a tabular number", () => {
    const { container } = renderInProvider(
      <ComplianceReportView result={makeReport({ complianceScore: 88 })} />,
    );
    // The score is rendered as the first <span> with class "tabular-nums"
    const score = container.querySelector(".tabular-nums");
    expect(score).toBeInTheDocument();
    expect(score!.textContent).toBe("88");
  });

  it("renders the modelInfo latency in seconds next to the report title", () => {
    renderInProvider(
      <ComplianceReportView
        result={makeReport({ modelInfo: { ragProvider: "minimax", latencyMs: 3500 } })}
      />,
    );
    expect(screen.getByText(/minimax/)).toBeInTheDocument();
    expect(screen.getByText(/3\.5s/)).toBeInTheDocument();
  });
});

describe("ComplianceReportView — rich sections (images + risks + checklist)", () => {
  function makeRichReport(): ComplianceReportResult {
    const base = makeReport();
    return {
      ...base,
      // ComplianceReportResult.images is typed as undefined, but the component
      // reads `result.images` from the raw object for the rich view.
      ...({
        images: [
          { imageId: "img1", url: "/uploads/1.jpg", thumbnail: "/uploads/t1.jpg", width: 800, height: 600, angleHint: "front" },
          { imageId: "img2", url: "/uploads/2.jpg", thumbnail: "/uploads/t2.jpg", width: 800, height: 600, angleHint: "side" },
        ],
        riskPoints: [
          {
            riskId: "risk-1",
            title: "CE/DoC 缺失",
            description: "未见 CE 标识和符合性声明。",
            severity: "critical",
            confidence: 0.92,
            imageId: "img1",
            bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
            matched_regulations: [{ name: "CE-RED 2014/53", article: "Art.3" }],
            suggestions: "补齐 DoC 文件",
          },
        ],
        checklist: [
          { question: "包装含 CE 标识？", answer: "缺失", status: "fail" },
          { question: "多语言警示齐全？", answer: "齐全", status: "pass" },
        ],
        totalRisks: 1,
        passItems: 1,
        warnItems: 0,
      } as unknown as Partial<ComplianceReportResult>),
    };
  }

  it("renders the image carousel when images array is non-empty", () => {
    const { container } = renderInProvider(<ComplianceReportView result={makeRichReport()} />);
    // Carousel shows 1 / 2 index badge
    expect(container.textContent).toContain("1 / 2");
  });

  it("renders the risk-point details with severity-based color (critical -> blaze-red)", () => {
    const { container } = renderInProvider(<ComplianceReportView result={makeRichReport()} />);
    expect(container.textContent).toContain("CE/DoC 缺失");
    // Critical severity -> border-blaze-red/40 + bg-blaze-red/5
    expect(container.querySelector(".border-blaze-red\\/40")).toBeInTheDocument();
    expect(container.querySelector(".bg-blaze-red\\/5")).toBeInTheDocument();
  });

  it("renders the checklist with pass/fail/warn status icons", () => {
    const { container } = renderInProvider(<ComplianceReportView result={makeRichReport()} />);
    expect(container.textContent).toContain("包装含 CE 标识？");
    expect(container.textContent).toContain("多语言警示齐全？");
    // Pass -> bg-emerald-500; Fail -> bg-blaze-red
    expect(container.querySelector(".bg-emerald-500")).toBeInTheDocument();
    expect(container.querySelector(".bg-blaze-red")).toBeInTheDocument();
  });

  it("renders the stats counters (passed / warnings / failed) when richStats present", () => {
    const { container } = renderInProvider(<ComplianceReportView result={makeRichReport()} />);
    // passItems=1, warnItems=0, totalRisks=1
    const stats = container.querySelector(".text-emerald-400.font-semibold");
    expect(stats).toBeInTheDocument();
    expect(stats!.textContent).toBe("1");
  });
});

describe("ComplianceReportView — agent trace + retrieved chunks", () => {
  it("renders the agent trace timeline when agentTrace is non-empty", () => {
    const { container } = renderInProvider(
      <ComplianceReportView
        result={makeReport({
          agentTrace: [
            { node: "vision", status: "success", duration_ms: 1200 },
            { node: "retrieve", status: "success", duration_ms: 800 },
          ],
        })}
      />,
    );
    expect(container.textContent).toContain("vision");
    expect(container.textContent).toContain("retrieve");
  });

  it("renders the retrieved-chunks section", () => {
    const { container } = renderInProvider(
      <ComplianceReportView
        result={makeReport({
          retrievedChunks: [
            { regId: "r1", docName: "CE-RED", articleNo: "Art.3", region: "EU", score: 0.91 },
          ],
        })}
      />,
    );
    expect(container.textContent).toContain("CE-RED");
    expect(container.textContent).toContain("Art.3");
  });
});