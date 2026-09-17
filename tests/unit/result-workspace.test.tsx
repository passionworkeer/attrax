import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResultWorkspace } from "@/app/result/[sessionId]/result-workspace";

afterEach(() => { window.history.replaceState(null, "", "/"); vi.restoreAllMocks(); });

it("starts with checks and supports keyboard switching without losing mounted contents", () => {
  render(<ResultWorkspace locale="zh" actions={<input aria-label="审核备注" />} evidence={<p>原图</p>} report={<p>导出</p>} />);
  expect(screen.getByRole("tab", {name: "审核清单"})).toHaveAttribute("aria-selected", "true");
  fireEvent.change(screen.getByLabelText("审核备注"), {target: {value: "需复核"}});
  fireEvent.keyDown(screen.getByRole("tab", {name: "审核清单"}), {key: "ArrowRight"});
  expect(screen.getByText("原图")).toBeVisible();
  expect(screen.getByText("导出")).not.toBeVisible();
  fireEvent.click(screen.getByRole("tab", {name: "审核清单"}));
  expect(screen.getByLabelText("审核备注")).toHaveValue("需复核");
});

it("routes old export and supplement anchors to the report panel", () => {
  render(<ResultWorkspace locale="zh" actions={<p>清单</p>} evidence={<p>原图</p>} report={<p>导出</p>} />);
  act(() => { window.history.replaceState(null, "", "#supplement-evidence"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(screen.getByText("导出")).toBeVisible();
  act(() => { window.history.replaceState(null, "", "#evidence"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  expect(screen.getByText("原图")).toBeVisible();
});
