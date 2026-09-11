import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CitationChip, CitationsList } from "@/components/regulation/CitationChip";

const baseCitation = {
  doc_id: "EU-2023-1542",
  article_id: "art-77",
  official_citation: "(EU) 2023/1542 Art. 77",
  quote: "The Commission shall establish a system for the electronic record.",
  quote_span: [10, 25] as [number, number],
  match_status: "matched" as const,
};

describe("CitationChip", () => {
  it("renders the official citation when present", () => {
    const { container } = render(<CitationChip citation={baseCitation} />);
    const link = container.querySelector("a");
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("(EU) 2023/1542 Art. 77");
  });

  it("falls back to doc_id + article_id when official_citation is missing", () => {
    const { container } = render(
      <CitationChip
        citation={{
          ...baseCitation,
          official_citation: "",
          quote_span: null,
          match_status: "fallback_article_only",
        }}
      />,
    );
    expect(container.textContent).toContain("EU-2023-1542");
    expect(container.textContent).toContain("art-77");
  });

  it("includes hl param in the URL when matched with a quote_span", () => {
    const { container } = render(<CitationChip citation={baseCitation} />);
    const link = container.querySelector("a");
    const href = link?.getAttribute("href") ?? "";
    expect(href).toContain("/regulations/EU-2023-1542");
    expect(href).toContain("#art-77");
    expect(href).toContain("hl=10%2C25");
  });

  it("omits hl param when match_status is not matched", () => {
    const { container } = render(
      <CitationChip
        citation={{
          ...baseCitation,
          match_status: "fallback_article_only",
          quote_span: null,
        }}
      />,
    );
    const link = container.querySelector("a");
    const href = link?.getAttribute("href") ?? "";
    expect(href).not.toContain("hl=");
  });

  it("uses the matched icon and emerald tone for matched status", () => {
    const { container } = render(<CitationChip citation={baseCitation} />);
    expect(container.textContent).toContain("✓");
    expect(container.querySelector("a")?.className).toMatch(/emerald/);
  });

  it("uses the warn icon for fallback_article_only", () => {
    const { container } = render(
      <CitationChip
        citation={{
          ...baseCitation,
          match_status: "fallback_article_only",
          quote_span: null,
        }}
      />,
    );
    expect(container.textContent).toContain("⚠");
  });

  it("uses the cross icon for unmatched", () => {
    const { container } = render(
      <CitationChip
        citation={{
          ...baseCitation,
          match_status: "unmatched",
          quote_span: null,
        }}
      />,
    );
    expect(container.textContent).toContain("✗");
  });
});

describe("CitationsList", () => {
  it("renders nothing when citations is empty and no hint given", () => {
    const { container } = render(<CitationsList citations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows hint when no citations", () => {
    const { container } = render(
      <CitationsList citations={[]} emptyHint="No citations" />,
    );
    expect(container.textContent).toBe("No citations");
  });

  it("renders one chip per citation entry", () => {
    const { container } = render(
      <CitationsList
        citations={[
          baseCitation,
          {
            ...baseCitation,
            doc_id: "EU-2014-53",
            article_id: "art-3",
            official_citation: "Directive 2014/53/EU Art. 3",
            quote_span: null,
            match_status: "fallback_article_only",
          },
        ]}
      />,
    );
    const chips = container.querySelectorAll("a");
    expect(chips.length).toBe(2);
  });
});