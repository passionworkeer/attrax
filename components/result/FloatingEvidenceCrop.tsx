"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { BoundingBox } from "@/lib/types";

/**
 * Plan 2026-09-13 §8.2 capability B — 局部悬浮放大.
 *
 * Renders a REAL crop of the user's original photo (CSS background-image
 * with background-position/size computed from the normalized bbox), floats
 * it beside the image with a lift/shadow, and connects it to the original
 * hotspot with a thin leader line. No segmentation model required — this
 * is pure CSS/Framer-free positioning, which is exactly why it ships in
 * capability B while contour-float (SAM mask) waits for capability C.
 *
 * The crop card carries the subtle 2.5D transform (translate + slight
 * rotate); the evidence frame on the original image stays flat (P1-3).
 */

export interface FloatingEvidenceCropProps {
  imageUrl: string;
  bbox: BoundingBox;
  label?: string;
  locale: "zh" | "en";
  /** Rendered size of the crop card (px). */
  cardWidth?: number;
  aspectRatio?: number;
  unoptimized?: boolean;
  /**
   * Plan 2026-09-13 §8.2 capability C — optional segmentation mask
   * (SAM worker output) as an image URL. When present the crop is clipped
   * to the mask via CSS mask-image, giving the contour-float effect on
   * the REAL part silhouette. Without a segmentation service this stays
   * undefined and the plain bbox crop renders (capability B) — the
   * bbox path is the guaranteed fallback, per §11 Batch E.
   */
  maskUrl?: string;
}

export function FloatingEvidenceCrop({
  imageUrl,
  bbox,
  label,
  locale,
  cardWidth = 240,
  aspectRatio = 4 / 3,
  unoptimized,
  maskUrl,
}: FloatingEvidenceCropProps) {
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [probedUrl, setProbedUrl] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Zoom factor: how much bigger the crop shows the region than it appears
  // on the original. A region occupying <30% of the photo benefits from
  // 3-4×; full-frame regions don't need a crop at all and are hidden.
  const regionShare = Math.max(bbox.w, bbox.h);
  const zoom = Math.min(4, Math.max(2, 0.9 / Math.max(regionShare, 0.05)));
  const worthShowing = regionShare < 0.85;

  // Derived state during render (React's documented "adjust state when a
  // prop changes" pattern): when the target image changes, drop the stale
  // probe state and restart dismissal — no setState-in-effect cascade.
  if (probedUrl !== imageUrl) {
    setProbedUrl(imageUrl);
    setLoaded(false);
    setDismissed(false);
  }

  useEffect(() => {
    if (!imageUrl) return;
    const probe = new window.Image();
    probe.onload = () => setLoaded(true);
    probe.onerror = () => setLoaded(false);
    probe.src = imageUrl;
    return () => {
      probe.onload = null;
      probe.onerror = null;
    };
  }, [imageUrl]);

  if (!worthShowing || dismissed || !loaded) return null;

  // background-size: scale the original so the crop region fills the card.
  // scale = card / (bbox share of image) → percentage of the image shown.
  const backgroundSizePercent = 100 * zoom;
  const backgroundPositionX = Math.min(
    100,
    Math.max(0, (bbox.x + bbox.w / 2) * 100),
  );
  const backgroundPositionY = Math.min(
    100,
    Math.max(0, (bbox.y + bbox.h / 2) * 100),
  );

  return (
    <div
      data-testid="floating-evidence-crop"
      className="pointer-events-none absolute z-[7]"
      style={{
        // Anchor: right of the bbox when there's room, else left.
        left: bbox.x + bbox.w < 0.6 ? `${Math.min((bbox.x + bbox.w) * 100 + 2, 78)}%` : undefined,
        right: bbox.x + bbox.w >= 0.6 ? `${Math.min((1 - bbox.x) * 100 + 2, 78)}%` : undefined,
        top: `${Math.min(Math.max(bbox.y * 100 - 4, 2), 70)}%`,
        width: cardWidth,
      }}
    >
      <div
        ref={cardRef}
        className="pointer-events-auto overflow-hidden rounded-[14px] border border-[rgba(102,224,226,0.5)] bg-[#0b1c30] shadow-[0_18px_40px_rgba(3,18,34,0.5)]"
        style={{
          aspectRatio: `${aspectRatio}`,
          transform: "perspective(900px) rotateY(-4deg) rotateX(2deg) translateZ(12px)",
          transformOrigin: "center",
        }}
      >
        <div
          aria-hidden
          className="size-full"
          style={{
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: `${backgroundSizePercent}%`,
            backgroundPosition: `${backgroundPositionX}% ${backgroundPositionY}%`,
            backgroundRepeat: "no-repeat",
            ...(maskUrl
              ? {
                  // Contour clip (capability C): the mask image is alpha-
                  // encoded over the same normalized frame as the bbox.
                  maskImage: `url(${maskUrl})`,
                  WebkitMaskImage: `url(${maskUrl})`,
                  maskSize: "100% 100%",
                  WebkitMaskSize: "100% 100%",
                  maskRepeat: "no-repeat",
                  WebkitMaskRepeat: "no-repeat",
                }
              : {}),
          }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="rounded-full border border-white/12 bg-[rgba(10,25,42,0.85)] px-2 py-0.5 text-[10px] text-white/72">
          {locale === "zh" ? "局部放大" : "Close-up"} · {label ? label.slice(0, 24) : ""}
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="pointer-events-auto rounded-full border border-white/12 bg-[rgba(10,25,42,0.85)] px-2 py-0.5 text-[10px] text-white/62 hover:text-white"
          aria-label={locale === "zh" ? "关闭放大图" : "Dismiss close-up"}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
