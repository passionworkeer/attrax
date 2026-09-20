import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CitationChip } from "@/components/regulation/CitationChip";
import { DocViewer } from "@/components/regulation/DocViewer";
import { LinkBackToReport } from "@/components/regulation/LinkBackToReport";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

/**
 * 「返回上一页」传统 web 行为回归：
 *   - 直接打开 / 书签进入（history.length <= 1）→ 退到 /regulations 列表
 *   - 来自站内其他页（history.length > 1）→ 走 window.history.back()
 *   - 同时首页链接永远可用，给直接打开场景一个最稳的兜底
 */
it("returns to /regulations when there is no browser history", () => {
  const back = vi.fn();
  const assign = vi.fn();
  Object.defineProperty(window, "history", {
    configurable: true,
    value: { length: 1, back },
  });
  vi.stubGlobal("location", { ...window.location, assign });
  render(<LinkBackToReport />);
  fireEvent.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(back).not.toHaveBeenCalled();
  expect(assign).toHaveBeenCalledWith("/regulations");
});

it("uses window.history.back() when browser history is non-empty", () => {
  const back = vi.fn();
  const assign = vi.fn();
  Object.defineProperty(window, "history", {
    configurable: true,
    value: { length: 2, back },
  });
  vi.stubGlobal("location", { ...window.location, assign });
  render(<LinkBackToReport />);
  fireEvent.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(back).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
});

it("always exposes a link back to the home page", () => {
  render(<LinkBackToReport />);
  const home = screen.getByRole("link", { name: "返回首页" });
  expect(home.getAttribute("href")).toBe("/");
});
