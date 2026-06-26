/**
 * Tests for ReportPanels (Decision + Roadmap) — extracted in P2 #6 result-page
 * split, never covered. Mocks lib/report-export so PDF/DOCX don't actually fire.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { DecisionReportPanel, RoadmapReportPanel } from "@/components/result/ReportPanels";
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

import * as reportExport from "@/lib/report-export";

function renderInProvider(node: React.ReactNode) {
  return render(<TranslationProvider>{node}</TranslationProvider>);
}

function makeReport(overrides: Partial<ComplianceReportResult> = {}): ComplianceReportResult {
  return {
    sessionId: "scan_panel_test",
    scanTime: new Date().toISOString(),
    productCategory: "electronics",
    productName: "Test",
    targetMarkets: ["EU"],
    complianceScore: 68,
    scoreGrade: "C",
    complianceReport: "# Compliance Report",
    complianceStatus: "WARN",
    agentTrace: [
      { node: "vision", status: "success", duration_ms: 1200 },
      { node: "retrieve", status: "success", duration_ms: 850 },
    ],
    loopCount: 1,
    retrievedChunks: [
      { regId: "r1", docName: "CE-RED", articleNo: "Art.3", region: "EU", score: 0.91 },
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

describe("DecisionReportPanel", () => {
  it("renders the AI 决策报告 heading in Chinese by default", () => {
    const { container } = renderInProvider(<DecisionReportPanel result={makeReport()} />);
    // The panel header is the first <h3>; the markdown may also contain a
    // "## AI 决策报告" inside, so we look for the <h3> specifically.
    const header = container.querySelector("h3");
    expect(header).toBeInTheDocument();
    expect(header!.textContent).toBe("AI 决策报告");
  });

  it("renders the execution trace + retrieved evidence in the fallback markdown", () => {
    // No reportPackage -> buildDecisionMarkdown takes the fallback path which
    // includes agentTrace (node + status + duration) and retrieved chunks.
    const { container } = renderInProvider(<DecisionReportPanel result={makeReport()} />);
    expect(container.textContent).toContain("vision: success");
    expect(container.textContent).toContain("EU · CE-RED · Art.3");
  });

  it("renders the decision-verdict table when reportPackage.decisionView is present", () => {
    const result = makeReport({
      reportPackage: {
        decisionView: {
          verdict: "REJECTED",
          riskLevel: "HIGH",
          summary: "文档缺失",
          keyFindings: ["CE/DoC 缺失", "责任人信息不足"],
          recommendedAction: "补齐认证文件",
          nodes: [
            { type: "vision", label: "Vision analysis", status: "success", confidence: 0.92, reasoning: "ok" },
          ],
        },
      },
    });
    const { container } = renderInProvider(<DecisionReportPanel result={result} />);
    // Markdown tables render as <table>
    const tables = container.querySelectorAll("table");
    expect(tables.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("REJECTED");
    expect(container.textContent).toContain("HIGH");
  });

  it("invokes the PDF downloader with locale when the PDF button is clicked", () => {
    const pdfSpy = vi.spyOn(reportExport, "downloadDecisionReportAsPdf");
    renderInProvider(<DecisionReportPanel result={makeReport()} />);
    // The DownloadButtons label is t("result.decisionShort")
    const pdfBtns = screen.getAllByText(/决策.*PDF|Decision.*PDF|PDF EN|PDF ZH/i);
    expect(pdfBtns.length).toBeGreaterThan(0);
    fireEvent.click(pdfBtns[0]);
    expect(pdfSpy).toHaveBeenCalled();
    pdfSpy.mockRestore();
  });

  it("invokes the DOCX downloader with locale when the Word button is clicked", () => {
    const docxSpy = vi.spyOn(reportExport, "downloadDecisionReportAsDocx");
    renderInProvider(<DecisionReportPanel result={makeReport()} />);
    const wordBtns = screen.getAllByText(/Word EN|Word ZH/i);
    expect(wordBtns.length).toBeGreaterThan(0);
    fireEvent.click(wordBtns[0]);
    expect(docxSpy).toHaveBeenCalled();
    docxSpy.mockRestore();
  });
});

describe("RoadmapReportPanel", () => {
  it("renders the 合规路线图 heading by default", () => {
    renderInProvider(<RoadmapReportPanel result={makeReport()} />);
    expect(screen.getByText("合规路线图")).toBeInTheDocument();
  });

  it("renders roadmap items from reportPackage.roadmap", () => {
    const result = makeReport({
      reportPackage: {
        roadmap: {
          totalDays: 30,
          totalCost: "¥50,000",
          items: [
            { title: "资料冻结", status: "pending", estimatedDays: 5, cost: "¥5,000", documents: ["BOM"] },
            { title: "标签整改", status: "in_progress", estimatedDays: 7, cost: "¥8,000", documents: ["包装设计稿"] },
          ],
        },
      },
    });
    const { container } = renderInProvider(<RoadmapReportPanel result={result} />);
    expect(container.textContent).toContain("资料冻结");
    expect(container.textContent).toContain("标签整改");
    expect(container.textContent).toContain("30"); // totalDays
  });

  it("falls back to complianceScore + status when no reportPackage.roadmap", () => {
    const result = makeReport({ complianceScore: 85, complianceStatus: "PASS" });
    const { container } = renderInProvider(<RoadmapReportPanel result={result} />);
    // Fallback list includes the compliance score and status
    expect(container.textContent).toContain("85");
    expect(container.textContent).toContain("PASS");
  });

  it("invokes the PDF downloader when the PDF button is clicked", () => {
    const pdfSpy = vi.spyOn(reportExport, "downloadRoadmapReportAsPdf");
    renderInProvider(<RoadmapReportPanel result={makeReport()} />);
    const pdfBtns = screen.getAllByText(/PDF EN|PDF ZH/i);
    fireEvent.click(pdfBtns[0]);
    expect(pdfSpy).toHaveBeenCalled();
    pdfSpy.mockRestore();
  });

  it("invokes the DOCX downloader when the Word button is clicked", () => {
    const docxSpy = vi.spyOn(reportExport, "downloadRoadmapReportAsDocx");
    renderInProvider(<RoadmapReportPanel result={makeReport()} />);
    const wordBtns = screen.getAllByText(/Word EN|Word ZH/i);
    fireEvent.click(wordBtns[0]);
    expect(docxSpy).toHaveBeenCalled();
    docxSpy.mockRestore();
  });
});