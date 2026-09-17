import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GlassScore } from "@/components/result/glass-score";

const originalResizeObserver = globalThis.ResizeObserver;
const originalMatchMedia = window.matchMedia;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
  globalThis.requestAnimationFrame = callback => {
    callback(performance.now());
    return 1;
  };
  globalThis.cancelAnimationFrame = vi.fn();
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  window.matchMedia = originalMatchMedia;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
});

describe("GlassScore", () => {
  it("binds the live assessment values to the glass meter and evidence segments", async () => {
    const { container } = render(
      <GlassScore score={62} supported={5} blocked={3} unresolved={0} applicableCount={8} locale="zh" />,
    );

    const meter = screen.getByRole("meter", { name: "62 / 100" });
    expect(meter).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByText("中等可信度")).toBeInTheDocument();
    expect(screen.getByText("8 / 8")).toBeInTheDocument();
    expect(screen.getByText("5 项有证据")).toBeInTheDocument();
    expect(screen.getByText("3 项需补证")).toBeInTheDocument();

    expect(container.querySelectorAll('[data-state="supported"]')).toHaveLength(6);
    const segments = screen.getByLabelText("5 项有证据，3 项需补证，0 项尚未判断");
    expect(segments.querySelectorAll('[data-state="blocked"]')).toHaveLength(3);
    expect([...container.querySelectorAll("feDisplacementMap")].map(node => node.getAttribute("scale"))).toEqual(["-180", "-170", "-160"]);
    expect(container.querySelector("feGaussianBlur")).toHaveAttribute("stdDeviation", "0.5");

    await waitFor(() => expect(meter).toHaveTextContent("62/ 100"));
  });

  it("replays the score animation without replacing the real score", async () => {
    render(<GlassScore score={74} supported={6} blocked={2} unresolved={0} applicableCount={8} locale="zh" />);
    const meter = screen.getByRole("meter", { name: "74 / 100" });

    await waitFor(() => expect(meter).toHaveTextContent("74/ 100"));
    fireEvent.click(screen.getByRole("button", { name: "重播动效" }));
    await waitFor(() => expect(meter).toHaveTextContent("74/ 100"));
  });

  it("keeps the pending state legible inside the square glass", () => {
    render(<GlassScore score={null} supported={0} blocked={0} unresolved={0} applicableCount={0} locale="zh" />);

    const meter = screen.getByRole("meter", { name: "尚无适用检查可评分" });
    expect(meter).toHaveTextContent("待评估");
    expect(meter).not.toHaveTextContent("/ 100");
  });
});
