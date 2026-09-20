import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CitationChip } from "@/components/regulation/CitationChip";
import { DocViewer } from "@/components/regulation/DocViewer";
import { LinkBackToReport } from "@/components/regulation/LinkBackToReport";
import { IN_SITE_MARKER_KEY } from "@/lib/regulation/back-navigation";

const ORIGIN = "http://localhost:3000";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  delete (window as { navigation?: unknown }).navigation;
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
 * 「返回上一页」行为回归（2026-09-20 两轮）：
 *   - Navigation API 可用：按上一历史条目的 URL 归属决定回退或回列表
 *   - 无 Navigation API：按 sessionStorage 标记决定
 *   任何情况下都不得把用户带出本站（回退目标只能是本站页面）。
 */
function stubHistoryAndLocation({ historyLength }: { historyLength: number }) {
  const back = vi.fn();
  const assign = vi.fn();
  Object.defineProperty(window, "history", {
    configurable: true,
    value: { length: historyLength, back },
  });
  vi.stubGlobal("location", { ...window.location, origin: ORIGIN, assign });
  return { back, assign };
}

function stubNavigationApi(index: number, urls: string[]) {
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: {
      currentEntry: { index },
      entries: () => urls.map((url) => ({ url })),
    },
  });
}

it("Navigation API：直接打开（index=0）→ 回法规列表，不回退", () => {
  stubNavigationApi(0, [`${ORIGIN}/regulations/US-16-CFR-1263#guidance`]);
  const { back, assign } = stubHistoryAndLocation({ historyLength: 2 });
  render(<LinkBackToReport />);
  fireEvent.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(back).not.toHaveBeenCalled();
  expect(assign).toHaveBeenCalledWith("/regulations");
});

it("Navigation API：上一页是本站页面 → history.back()", () => {
  stubNavigationApi(1, [`${ORIGIN}/regulations`, `${ORIGIN}/regulations/US-16-CFR-1263`]);
  const { back, assign } = stubHistoryAndLocation({ historyLength: 3 });
  render(<LinkBackToReport />);
  fireEvent.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(back).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
});

it("Navigation API：上一页是外部站点 → 回法规列表，不外跳", () => {
  stubNavigationApi(1, ["https://github.com/some/repo", `${ORIGIN}/regulations/US-16-CFR-1263`]);
  const { back, assign } = stubHistoryAndLocation({ historyLength: 2 });
  render(<LinkBackToReport />);
  fireEvent.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(back).not.toHaveBeenCalled();
  expect(assign).toHaveBeenCalledWith("/regulations");
});

it("无 Navigation API：本标签页来过本站（标记存在）→ history.back()", () => {
  window.sessionStorage.setItem(IN_SITE_MARKER_KEY, "1");
  const { back, assign } = stubHistoryAndLocation({ historyLength: 3 });
  render(<LinkBackToReport />);
  fireEvent.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(back).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
});

it("无 Navigation API：直接打开（无标记）→ 回法规列表，哪怕 history.length > 1", () => {
  const { back, assign } = stubHistoryAndLocation({ historyLength: 2 });
  render(<LinkBackToReport />);
  fireEvent.click(screen.getByRole("button", { name: "返回上一页" }));
  expect(back).not.toHaveBeenCalled();
  expect(assign).toHaveBeenCalledWith("/regulations");
});

it("always exposes a link back to the home page", () => {
  render(<LinkBackToReport />);
  const home = screen.getByRole("link", { name: "返回首页" });
  expect(home.getAttribute("href")).toBe("/");
});
