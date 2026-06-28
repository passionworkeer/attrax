"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

export interface ProductImage {
  imageId: string;
  url: string;
  thumbnail: string;
  width: number;
  height: number;
  angleHint?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  matchedRegulations?: string[];
}

// Interactive elements that should own their own arrow-key behavior. When one
// of these is focused, the carousel must NOT hijack ArrowLeft/ArrowRight — this
// is what previously broke result-page tables and form inputs.
const INTERACTIVE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""], td, th, [role="gridcell"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tab"]';

/**
 * Image carousel with prev/next navigation, keyboard arrow support,
 * risk-region bbox overlay, thumbnail strip, and matched-regulations label.
 *
 * Arrow-key handlers are mounted globally but suppressed whenever an interactive
 * element (form input, table cell, menu/tab item) is focused, so the carousel
 * no longer swallows navigation keys that other widgets on the result page need.
 */
export function ImageCarousel({ images }: { images: ProductImage[] }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);

  const prev = useCallback(
    () => setCurrent((c) => (c > 0 ? c - 1 : images.length - 1)),
    [images.length],
  );
  const next = useCallback(
    () => setCurrent((c) => (c < images.length - 1 ? c + 1 : 0)),
    [images.length],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const active = document.activeElement as Element | null;
      if (active && active.closest(INTERACTIVE_SELECTOR)) {
        return; // Let the focused interactive element handle the key.
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  const img = images[current];
  const regList = img.matchedRegulations?.join(", ");

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label={t("result.productImageAnalysis")}
      className="space-y-3"
    >
      {/* Main carousel */}
      <div className="relative rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden">
        <div className="relative aspect-[4/3] w-full">
          <Image src={img.url} alt={img.angleHint ?? img.imageId} fill className="object-contain" />
          {/* Risk region highlight */}
          {img.bbox && (
            <div
              className="absolute border-2 border-blaze-red bg-blaze-red/10 rounded-sm"
              style={{
                left: `${img.bbox.x * 100}%`,
                top: `${img.bbox.y * 100}%`,
                width: `${img.bbox.w * 100}%`,
                height: `${img.bbox.h * 100}%`,
              }}
            />
          )}
        </div>
        {/* Navigation arrows */}
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/70 border border-white/20 p-2 text-white hover:bg-blaze-red/80 hover:border-blaze-red transition-colors"
              aria-label={t("upload.prevImage")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/70 border border-white/20 p-2 text-white hover:bg-blaze-red/80 hover:border-blaze-red transition-colors"
              aria-label={t("upload.nextImage")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </>
        )}
        {/* Index badge */}
        <div className="absolute bottom-3 right-3 rounded-full bg-black/70 border border-white/20 px-3 py-1 text-xs font-medium text-white data-mono">
          {current + 1} / {images.length}
        </div>
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((im, i) => (
            <button
              key={im.imageId}
              type="button"
              onClick={() => setCurrent(i)}
              className={cn(
                "relative shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                i === current ? "border-blaze-red" : "border-white/10 opacity-60 hover:opacity-90",
              )}
            >
              <Image
                src={im.thumbnail}
                alt={im.angleHint ?? im.imageId}
                width={64}
                height={64}
                className="h-16 w-16 object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Image metadata + matched regulations */}
      {img.angleHint && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="rounded-full bg-slate-800/60 border border-white/10 px-2.5 py-1 capitalize">
            {img.angleHint.replace("_", " ")}
          </span>
          {regList && (
            <>
              <span>·</span>
              <span className="text-blaze-red/70">
                {t("result.matchedRegulations")}: {regList}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
