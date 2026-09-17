import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CitationChip } from "@/components/regulation/CitationChip";
import { DocViewer } from "@/components/regulation/DocViewer";

afterEach(() => { window.history.replaceState(null, "", "/"); vi.restoreAllMocks(); });

it("places highlight parameters before the fragment and highlights the selected article only", () => {
  const citation = { doc_id: "EU-test", article_id: "art-4", quote_span: [0, 4] as [number, number], match_status: "matched" as const };
  const { unmount } = render(<CitationChip citation={citation} />);
  expect(screen.getByRole("link").getAttribute("href")).toBe("/regulations/EU-test?hl=0%2C4#art-4");
  unmount();
  window.history.replaceState(null, "", "/regulations/EU-test?hl=0%2C4#art-4");
  Element.prototype.scrollIntoView = vi.fn();
  const { container } = render(<DocViewer regulation={{ id: "EU-test", official_citation: "Test", region: "EU", license: "public", schema_version: 1,
    articles: [{ id: "art-4", title: "Title", text: "Read this article" }, { id: "art-5", title: "Other", text: "No highlight" }] }}
    hl={{ articleId: "", start: 0, end: 4 }} />);
  expect(container.querySelector("mark")?.textContent).toBe("Read");
  expect(container.querySelectorAll('[id="art-4"]')).toHaveLength(1);
});
