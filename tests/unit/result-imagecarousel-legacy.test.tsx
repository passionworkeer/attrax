/**
 * Tests for ImageCarousel + LegacyResultView (P2 #6 result-page split, never covered).
 * Pattern follows tests/unit/result-extracted-components.test.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { ImageCarousel, type ProductImage } from "@/components/result/ImageCarousel";
import { LegacyResultView } from "@/components/result/LegacyResultView";
import { TranslationProvider } from "@/lib/i18n";
import type { ScanResult } from "@/lib/types";

function renderInProvider(node: React.ReactNode) {
  return render(<TranslationProvider>{node}</TranslationProvider>);
}

function makeImage(overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    imageId: "img-1",
    url: "/uploads/full-1.jpg",
    thumbnail: "/uploads/thumb-1.jpg",
    width: 800,
    height: 600,
    ...overrides,
  };
}

describe("ImageCarousel", () => {
  it("renders the first image's index badge (1 / N)", () => {
    const images = [makeImage({ imageId: "a" }), makeImage({ imageId: "b" })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    expect(container.textContent).toContain("1 / 2");
  });

  it("hides navigation arrows when there is only one image", () => {
    const { container } = renderInProvider(<ImageCarousel images={[makeImage()]} />);
    // Use locale-aware matcher (default zh = "上一张" / "下一张")
    expect(screen.queryByLabelText(/^(上一张|下一张)$/)).not.toBeInTheDocument();
  });

  it("advances to the next image when the next button is clicked", () => {
    const images = [makeImage({ imageId: "a" }), makeImage({ imageId: "b" }), makeImage({ imageId: "c" })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    fireEvent.click(screen.getByLabelText("下一张"));
    expect(container.textContent).toContain("2 / 3");
    fireEvent.click(screen.getByLabelText("下一张"));
    expect(container.textContent).toContain("3 / 3");
  });

  it("wraps from last to first when next is clicked", () => {
    const images = [makeImage({ imageId: "a" }), makeImage({ imageId: "b" })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    fireEvent.click(screen.getByLabelText("下一张"));
    expect(container.textContent).toContain("2 / 2");
    fireEvent.click(screen.getByLabelText("下一张"));
    expect(container.textContent).toContain("1 / 2");
  });

  it("wraps from first to last when prev is clicked", () => {
    const images = [makeImage({ imageId: "a" }), makeImage({ imageId: "b" })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    fireEvent.click(screen.getByLabelText("上一张"));
    expect(container.textContent).toContain("2 / 2");
  });

  it("switches image when a thumbnail is clicked", () => {
    const images = [makeImage({ imageId: "a" }), makeImage({ imageId: "b" }), makeImage({ imageId: "c" })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    // 3 thumbnail buttons rendered (one per image)
    const thumbs = container.querySelectorAll("button img");
    expect(thumbs.length).toBe(3);
    // Click the 3rd thumbnail by finding its parent button
    const buttons = Array.from(container.querySelectorAll("button")).filter((b) =>
      b.querySelector("img") && !b.getAttribute("aria-label"),
    );
    fireEvent.click(buttons[2]);
    expect(container.textContent).toContain("3 / 3");
  });

  it("responds to ArrowRight keyboard navigation", () => {
    const images = [makeImage({ imageId: "a" }), makeImage({ imageId: "b" })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(container.textContent).toContain("2 / 2");
  });

  it("responds to ArrowLeft keyboard navigation", () => {
    const images = [makeImage({ imageId: "a" }), makeImage({ imageId: "b" })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(container.textContent).toContain("2 / 2");
  });

  it("renders the bbox overlay when bbox is provided", () => {
    const images = [makeImage({ bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    const overlay = container.querySelector(".border-blaze-red");
    expect(overlay).toBeInTheDocument();
    expect((overlay as HTMLElement).style.left).toBe("10%");
    expect((overlay as HTMLElement).style.top).toBe("20%");
    expect((overlay as HTMLElement).style.width).toBe("50%");
  });

  it("renders matched regulations joined with commas when angleHint is present", () => {
    const images = [makeImage({ angleHint: "front_view", matchedRegulations: ["CE-RED-2014/53", "RoHS 2011/65"] })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    expect(container.textContent).toContain("CE-RED-2014/53, RoHS 2011/65");
  });

  it("omits the matched regulations text when none provided", () => {
    const images = [makeImage({ angleHint: "front" })];
    const { container } = renderInProvider(<ImageCarousel images={images} />);
    // No "matchedRegulations" label suffix when array is missing
    expect(container.textContent).not.toContain(":");
  });
});

function makeLegacyResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    sessionId: "scan_test_legacy",
    scanTime: new Date().toISOString(),
    productCategory: "electronics",
    productName: "Test Product",
    targetMarkets: ["EU", "US"],
    complianceScore: 72,
    scoreGrade: "C",
    images: [],
    documents: [],
    riskPoints: [],
    checklist: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("LegacyResultView", () => {
  it("renders the localized JSON dump in a <pre> block", () => {
    const result = makeLegacyResult({ sessionId: "scan_legacy_001" });
    const { container } = renderInProvider(<LegacyResultView result={result} />);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre!.textContent).toContain("scan_legacy_001");
    expect(pre!.textContent).toContain("electronics");
  });

  it("omits the documents section when there are no documents", () => {
    const result = makeLegacyResult({ documents: [] });
    const { container } = renderInProvider(<LegacyResultView result={result} />);
    expect(container.querySelector("section")).not.toBeInTheDocument();
  });

  it("renders a document link for each uploaded document", () => {
    const result = makeLegacyResult({
      documents: [
        { documentId: "d1", name: "ce-cert.pdf", size: 2048, type: "pdf", mimeType: "application/pdf", url: "/files/d1.pdf" },
        { documentId: "d2", name: "lab-report.docx", size: 4096, type: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", url: "/files/d2.docx" },
      ],
    });
    const { container } = renderInProvider(<LegacyResultView result={result} />);
    const links = container.querySelectorAll('a[target="_blank"]');
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe("/files/d1.pdf");
    expect(links[1].getAttribute("href")).toBe("/files/d2.docx");
    expect(links[0].textContent).toContain("PDF · 2.0 KB");
    expect(links[1].textContent).toContain("DOCX · 4.0 KB");
  });

  it("opens document links in a new tab with rel=noopener", () => {
    const result = makeLegacyResult({
      documents: [{ documentId: "d1", name: "x.pdf", size: 100, type: "pdf", mimeType: "application/pdf", url: "/u" }],
    });
    const { container } = renderInProvider(<LegacyResultView result={result} />);
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders the document count in the section header", () => {
    const result = makeLegacyResult({
      documents: [
        { documentId: "d1", name: "a.pdf", size: 100, type: "pdf", mimeType: "application/pdf", url: "/u1" },
        { documentId: "d2", name: "b.pdf", size: 200, type: "pdf", mimeType: "application/pdf", url: "/u2" },
        { documentId: "d3", name: "c.pdf", size: 300, type: "pdf", mimeType: "application/pdf", url: "/u3" },
      ],
    });
    renderInProvider(<LegacyResultView result={result} />);
    // The count appears as "{t('result.documentCount', { count: 3 })}" which
    // renders to a localized string; just confirm "3" appears in the section
    // header (which uses h2) and not via JSON-dump "match" elsewhere.
    const section = document.querySelector("section");
    expect(section).toBeTruthy();
    expect(section!.textContent).toMatch(/3/);
  });
});