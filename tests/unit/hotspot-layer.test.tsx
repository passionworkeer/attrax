import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HotspotLayer, isRenderableBbox } from "@/components/result/HotspotLayer";

const mkHotspot = (overrides: Partial<Parameters<typeof HotspotLayer>[0]["hotspots"][number]> = {}) => ({
  id: "rp_01",
  label: "铭牌无 3C 标志",
  severity: "critical" as const,
  bbox: { x: 0.71, y: 0.14, w: 0.16, h: 0.22 },
  regulationRef: "CN-CCC",
  ...overrides,
});

describe("isRenderableBbox", () => {
  it("accepts a valid normalized bbox", () => {
    expect(isRenderableBbox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe(true);
  });

  it("rejects the historical all-zero placeholder (audit P1.7)", () => {
    expect(isRenderableBbox({ x: 0, y: 0, w: 0, h: 0 })).toBe(false);
  });

  it("rejects undefined/null and out-of-range boxes", () => {
    expect(isRenderableBbox(undefined)).toBe(false);
    expect(isRenderableBbox(null)).toBe(false);
    expect(isRenderableBbox({ x: 0.9, y: 0.2, w: 0.3, h: 0.4 })).toBe(false); // x+w > 1.02
  });
});

describe("HotspotLayer", () => {
  it("renders nothing when there are no renderable hotspots (fail-safe)", () => {
    const { container } = render(
      <HotspotLayer hotspots={[mkHotspot({ bbox: { x: 0, y: 0, w: 0, h: 0 } })]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one tilted frame per renderable hotspot", () => {
    render(
      <HotspotLayer
        hotspots={[
          mkHotspot(),
          mkHotspot({ id: "rp_02", label: "接口无 CE 标记", severity: "warning", bbox: { x: 0.1, y: 0.5, w: 0.2, h: 0.15 } }),
        ]}
      />,
    );
    expect(screen.getByTestId("hotspot-layer")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText(/铭牌无 3C 标志/)).toBeInTheDocument();
    expect(screen.getByText(/接口无 CE 标记/)).toBeInTheDocument();
  });

  it("positions each frame by its normalized bbox percentage", () => {
    render(<HotspotLayer hotspots={[mkHotspot()]} />);
    const wrapper = screen.getByText(/铭牌无 3C 标志/).closest("div.absolute");
    expect(wrapper).toHaveStyle({ left: "71%", top: "14%" });
  });

  it("keeps the evidence frame flat — no perspective/rotate/scale on the bbox (audit P1-3)", () => {
    render(<HotspotLayer hotspots={[mkHotspot()]} />);
    const layer = screen.getByTestId("hotspot-layer");
    const frame = layer.querySelector("div[aria-hidden]") as HTMLElement;
    const style = frame.getAttribute("style") ?? "";
    // The 2.5D transforms moved to the floating crop card
    // (FloatingEvidenceCrop); the evidence frame must stay glued to the
    // grounded region. See plan 2026-09-13 §8.
    expect(style).not.toContain("perspective(");
    expect(style).not.toContain("rotateX(");
    expect(style).not.toContain("rotateY(");
    expect(style).not.toContain("scale(");
  });

  it("fires onHotspotClick with the hotspot id when the chip is clicked", () => {
    const onClick = vi.fn();
    render(<HotspotLayer hotspots={[mkHotspot()]} onHotspotClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledWith("rp_01");
  });

  it("dims inactive hotspots when an activeId is provided", () => {
    render(
      <HotspotLayer
        hotspots={[
          mkHotspot(),
          mkHotspot({ id: "rp_02", label: "second", bbox: { x: 0.2, y: 0.6, w: 0.2, h: 0.2 } }),
        ]}
        activeId="rp_02"
      />,
    );
    // Both still render; the wrapper of the inactive one is dimmed.
    expect(screen.getByText(/铭牌无 3C 标志/)).toBeInTheDocument();
    expect(screen.getByText(/second/)).toBeInTheDocument();
  });

  it("exposes an accessible label combining severity, label, and view-detail hint", () => {
    render(
      <HotspotLayer
        hotspots={[mkHotspot()]}
        localizedLabel={() => "高危"}
        viewDetailLabel="查看风险详情"
      />,
    );
    expect(screen.getByRole("button")).toHaveAccessibleName("高危: 铭牌无 3C 标志 — 查看风险详情");
  });
});