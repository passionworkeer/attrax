"use client";

/**
 * components/result/ObservationHotspotLayer.tsx
 *
 * Plan 2026-09-14 §4.3 (J03) — the observation-driven hotspot layer.
 *
 * The legacy `<HotspotLayer>` renders `RiskPoint.bbox` (the decisionView
 * pipeline shape). Checklist-mode scans ground their evidence on
 * `InspectionObservation.region` (normalized bbox on the canonical image),
 * which never flows through riskPoints — so findings with real boxes were
 * invisible on the image stage. This component draws THOSE anchors:
 *
 *   - SVG rect per anchor bbox (normalized 0..1 → viewBox 0..100)
 *   - numbered index chip + short title (plan §5.2: 热点默认编号＋短名称)
 *   - the active anchor (selectedObservationId) gets the emphasis style;
 *     others dim slightly so the selected region reads immediately
 *   - clickable → reports back the observationId so the page can open the
 *     matching checklist/detail row (bidirectional selection linkage)
 *
 * Coordinate discipline: coordinates stay normalized; the SVG fills the
 * canvas with preserveAspectRatio="none", matching the image's intrinsic
 * aspect-ratio box captured by the page (object-contain + natural size →
 * cover==contain). No fabricated anchors are ever passed in — the VM
 * guarantees anchorsByImage only contains region-bearing observations.
 */

import { cn } from "@/lib/utils";
import type { LocatedAnchorVM } from "@/lib/result/inspection-view-model";

export interface ObservationHotspotLayerProps {
  /** Anchors for the CURRENTLY displayed image (vm.anchorsByImage[imageId]). */
  anchors: LocatedAnchorVM[];
  /** Selection linkage: the observation the page considers selected. */
  activeObservationId?: string | null;
  /** Selection linkage: finding whose row is selected (matches anchor.findingId). */
  activeFindingId?: string | null;
  onAnchorClick?: (anchor: LocatedAnchorVM) => void;
  /** Accessible label prefix, localized by the caller. */
  anchorLabel?: string;
  className?: string;
}

const SEVERITY_FRAME: Record<string, { stroke: string; fill: string; chip: string }> = {
  critical: {
    stroke: "rgba(239,68,68,0.9)",
    fill: "rgba(239,68,68,0.14)",
    chip: "border-red-400/70 bg-red-500/85",
  },
  high: {
    stroke: "rgba(255,107,53,0.88)",
    fill: "rgba(255,107,53,0.13)",
    chip: "border-[var(--blaze-orange)]/70 bg-[var(--blaze-orange)]/85",
  },
  medium: {
    stroke: "rgba(251,191,36,0.82)",
    fill: "rgba(251,191,36,0.12)",
    chip: "border-amber-400/70 bg-amber-400/85",
  },
  low: {
    stroke: "rgba(56,189,248,0.78)",
    fill: "rgba(56,189,248,0.1)",
    chip: "border-sky-400/70 bg-sky-400/85",
  },
  unknown: {
    stroke: "rgba(94,234,222,0.66)",
    fill: "rgba(94,234,222,0.08)",
    chip: "border-teal-300/60 bg-teal-400/70",
  },
  // observation-only anchors (no finding attached) — neutral evidence tone
  null: {
    stroke: "rgba(148,163,184,0.6)",
    fill: "rgba(148,163,184,0.07)",
    chip: "border-slate-400/50 bg-slate-500/70",
  },
};

// viewBox coordinate scale — keep in sync with the rect math below.
const VIEW = 100;

export function ObservationHotspotLayer({
  anchors,
  activeObservationId,
  activeFindingId,
  onAnchorClick,
  anchorLabel = "观察点",
  className,
}: ObservationHotspotLayerProps) {
  if (anchors.length === 0) return null;

  return (
    <div
      data-testid="observation-hotspot-layer"
      className={cn("pointer-events-none absolute inset-0 z-[5]", className)}
    >
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
        aria-hidden
      >
        {anchors.map((anchor) => {
          const frame = SEVERITY_FRAME[anchor.severity ?? "null"] ?? SEVERITY_FRAME.unknown;
          const isActive =
            anchor.observationId === activeObservationId ||
            (!!activeFindingId && anchor.findingId === activeFindingId);
          return (
            <rect
              key={anchor.observationId}
              x={anchor.bbox.x * VIEW}
              y={anchor.bbox.y * VIEW}
              width={anchor.bbox.w * VIEW}
              height={anchor.bbox.h * VIEW}
              rx={2.2}
              fill={frame.fill}
              stroke={frame.stroke}
              strokeWidth={isActive ? 1.4 : 0.8}
              strokeDasharray={anchor.findingId ? undefined : "2 1.5"}
              className="transition-opacity duration-300"
              style={{ opacity: activeObservationId && !isActive ? 0.35 : 0.95 }}
            />
          );
        })}
      </svg>
      {/* Numbered chips are DOM (not SVG) so text stays crisp and the touch
          targets stay >= 44px-ish through padding. Plan §5.2: 编号＋短标题，
          选中显示完整说明由清单行承担。 */}
      {anchors.map((anchor, index) => {
        const frame = SEVERITY_FRAME[anchor.severity ?? "null"] ?? SEVERITY_FRAME.unknown;
        const isActive =
          anchor.observationId === activeObservationId ||
          (!!activeFindingId && anchor.findingId === activeFindingId);
        // Chip position: top-left of the bbox, flip below the box when the
        // box hugs the top edge (avoid overflow clipping).
        const nearTop = anchor.bbox.y < 0.08;
        const style = nearTop
          ? { left: `${anchor.bbox.x * 100}%`, top: `calc(${(anchor.bbox.y + anchor.bbox.h) * 100}% + 6px)` }
          : { left: `${anchor.bbox.x * 100}%`, top: `calc(${anchor.bbox.y * 100}% - 26px)` };
        return (
          <button
            key={`chip-${anchor.observationId}`}
            type="button"
            onClick={() => onAnchorClick?.(anchor)}
            aria-label={`${anchorLabel} ${index + 1}：${anchor.shortTitle}`}
            className={cn(
              "pointer-events-auto absolute z-[6] flex max-w-[70%] items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold text-white shadow-lg backdrop-blur-md transition hover:brightness-110",
              frame.chip,
              isActive && "ring-2 ring-white/80",
            )}
            style={style}
          >
            <span className="font-mono">{index + 1}</span>
            <span className="truncate">{anchor.shortTitle}</span>
          </button>
        );
      })}
    </div>
  );
}
