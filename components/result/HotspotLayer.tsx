"use client";

import type { BoundingBox } from "@/lib/types";

/**
 * Feature 1 (2.5D hotspots): renders vision-anchored risk regions as
 * slightly-tilted rectangles on top of the product image canvas.
 *
 * Visual language: each hotspot is a CSS `perspective(800px)` +
 * `rotateX/rotateY` transformed rectangle with a multi-layer box-shadow and
 * a translucent gradient fill. The tilt gives a subtle "2.5D sticker"
 * feel — the box reads as floating *over* the photo rather than being
 * burned into it. Severity drives the accent color.
 *
 * Data source: `vision.py` emits `issues[].bbox` (normalized 0..1); the
 * generator injects them into `decisionView.nodes[].bbox`; the v1 adapter
 * surfaces them on `RiskPoint.bbox`. Callers filter out all-zero boxes
 * before rendering (they mean "no visual location").
 */

export interface Hotspot {
  id: string;
  label: string;
  severity: "critical" | "high" | "medium" | "low" | "warning" | "info";
  bbox: BoundingBox;
  regulationRef?: string | null;
}

const SEVERITY_STYLES: Record<
  Hotspot["severity"],
  { border: string; shadow: string; gradient: string; dot: string; tag: string }
> = {
  critical: {
    border: "rgba(239,68,68,0.85)",
    shadow: "rgba(239,68,68,0.5)",
    gradient: "rgba(239,68,68,0.16)",
    dot: "bg-red-500",
    tag: "border-red-400/70 bg-red-500/85",
  },
  high: {
    border: "rgba(255,107,53,0.85)",
    shadow: "rgba(255,107,53,0.45)",
    gradient: "rgba(255,107,53,0.14)",
    dot: "bg-[var(--blaze-orange)]",
    tag: "border-[var(--blaze-orange)]/70 bg-[var(--blaze-orange)]/85",
  },
  warning: {
    border: "rgba(251,191,36,0.8)",
    shadow: "rgba(251,191,36,0.4)",
    gradient: "rgba(251,191,36,0.12)",
    dot: "bg-amber-400",
    tag: "border-amber-400/70 bg-amber-400/85",
  },
  medium: {
    border: "rgba(251,191,36,0.8)",
    shadow: "rgba(251,191,36,0.4)",
    gradient: "rgba(251,191,36,0.12)",
    dot: "bg-amber-400",
    tag: "border-amber-400/70 bg-amber-400/85",
  },
  low: {
    border: "rgba(56,189,248,0.75)",
    shadow: "rgba(56,189,248,0.35)",
    gradient: "rgba(56,189,248,0.1)",
    dot: "bg-sky-400",
    tag: "border-sky-400/70 bg-sky-400/85",
  },
  info: {
    border: "rgba(56,189,248,0.75)",
    shadow: "rgba(56,189,248,0.35)",
    gradient: "rgba(56,189,248,0.1)",
    dot: "bg-sky-400",
    tag: "border-sky-400/70 bg-sky-400/85",
  },
};

export function isRenderableBbox(bbox: BoundingBox | undefined | null): bbox is BoundingBox {
  if (!bbox) return false;
  const { x, y, w, h } = bbox;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof w === "number" &&
    typeof h === "number" &&
    w > 0.001 &&
    h > 0.001 &&
    x >= 0 &&
    y >= 0 &&
    x + w <= 1.02 &&
    y + h <= 1.02
  );
}

// Round to 2 decimals so the emitted CSS percentages are stable
// (0.14 * 100 === 14.000000000000002 in IEEE-754) and snapshot-friendly.
function pct(value: number): string {
  return `${Math.round(value * 10000) / 100}%`;
}

export function HotspotLayer({
  hotspots,
  activeId,
  onHotspotClick,
  localizedLabel,
  viewDetailLabel,
}: {
  hotspots: Hotspot[];
  activeId?: string | null;
  onHotspotClick?: (id: string) => void;
  localizedLabel?: (severity: Hotspot["severity"]) => string;
  viewDetailLabel?: string;
}) {
  const renderable = hotspots.filter((spot) => isRenderableBbox(spot.bbox));
  if (renderable.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5]" data-testid="hotspot-layer">
      {renderable.map((spot, index) => {
        const style = SEVERITY_STYLES[spot.severity] ?? SEVERITY_STYLES.medium;
        const isActive = spot.id === activeId;
        return (
          <div
            key={spot.id}
            className="absolute transition-[opacity,filter] duration-300"
            style={{
              left: pct(spot.bbox.x),
              top: pct(spot.bbox.y),
              width: pct(spot.bbox.w),
              height: pct(spot.bbox.h),
              opacity: activeId && !isActive ? 0.45 : 1,
            }}
          >
            {/* 2.5D tilted frame — the visual hotspot itself is not a click
                target (pointer-events-none on the layer keeps the canvas
                image draggable); the label chip below is the button. */}
            <div
              aria-hidden
              className="absolute inset-0 rounded-[10px] backdrop-blur-[1.5px]"
              style={{
                transform: `perspective(800px) rotateX(7deg) rotateY(-6deg) scale(${isActive ? 1.06 : 1})`,
                transformOrigin: "center center",
                border: `1.5px solid ${style.border}`,
                background: `linear-gradient(135deg, ${style.gradient}, transparent 70%)`,
                boxShadow: `0 0 0 1.5px ${style.border}, 12px 22px 32px -8px ${style.shadow}, inset 0 0 24px ${style.gradient}`,
              }}
            />
            {/* Corner ticks — cheap "targeting reticle" affordance */}
            <span
              aria-hidden
              className="absolute -left-px -top-px size-2.5 rounded-tl-[10px]"
              style={{ borderTop: `2px solid ${style.border}`, borderLeft: `2px solid ${style.border}` }}
            />
            <span
              aria-hidden
              className="absolute -right-px -bottom-px size-2.5 rounded-br-[10px]"
              style={{ borderBottom: `2px solid ${style.border}`, borderRight: `2px solid ${style.border}` }}
            />
            {/* Clickable severity chip pinned to the top-left of the frame */}
            <button
              type="button"
              onClick={() => onHotspotClick?.(spot.id)}
              className={`pointer-events-auto absolute -top-2.5 left-2 flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold text-white shadow-lg backdrop-blur-md transition hover:brightness-110 ${style.tag}`}
              style={{ transform: "perspective(800px) rotateX(7deg) rotateY(-6deg)" }}
              aria-label={`${localizedLabel?.(spot.severity) ?? spot.severity}: ${spot.label}${viewDetailLabel ? ` — ${viewDetailLabel}` : ""}`}
            >
              <span className={`inline-block size-1.5 shrink-0 rounded-full ${style.dot}`} />
              <span className="truncate">
                {index + 1}. {spot.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}