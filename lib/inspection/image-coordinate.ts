/**
 * Image coordinate math for the inspection canvas (plan 2026-09-13 §8.1).
 *
 * Two supported layouts:
 *
 * 1. **Intrinsic-ratio canvas** (preferred): the container's aspect-ratio
 *    equals the canonical image's width/height. The image fills the box
 *    exactly, so a normalized bbox maps to the same percentages on the
 *    container — `intrinsicRect()` below. No letterboxing, no cropping.
 *
 * 2. **Fixed-ratio container + object-contain**: when a layout must keep a
 *    fixed container ratio, the image is letterboxed inside and the bbox
 *    percentages must be offset by the letterbox margins and scaled by the
 *    contain factor — `containRect()` implements the plan's formula:
 *
 *      s = min(cw / iw, ch / ih)
 *      offsetX = (cw - iw × s) / 2
 *      offsetY = (ch - ih × s) / 2
 *      left = offsetX + bbox.x × iw × s
 *
 * The legacy result page used object-cover in a fixed 4:3 box and
 * positioned boxes by container percentage — cropping made the boxes point
 * at the wrong spots (audit P1-2). Use layout 1 wherever possible.
 */

export interface NormalizedBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Layout 1 — canvas ratio == image ratio. Percent positions map 1:1. */
export function intrinsicRect(bbox: NormalizedBbox): PixelRect {
  return {
    left: bbox.x * 100,
    top: bbox.y * 100,
    width: bbox.w * 100,
    height: bbox.h * 100,
  };
}

/**
 * Layout 2 — fixed container + object-contain letterboxing.
 * `container` and `image` are in the same unit (usually px).
 */
export function containRect(
  bbox: NormalizedBbox,
  container: { width: number; height: number },
  image: { width: number; height: number },
): PixelRect {
  if (image.width <= 0 || image.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(
    container.width / image.width,
    container.height / image.height,
  );
  const offsetX = (container.width - image.width * scale) / 2;
  const offsetY = (container.height - image.height * scale) / 2;
  return {
    left: offsetX + bbox.x * image.width * scale,
    top: offsetY + bbox.y * image.height * scale,
    width: bbox.w * image.width * scale,
    height: bbox.h * image.height * scale,
  };
}

/** Guard: is the rect usable (non-degenerate, within a small tolerance)? */
export function isUsableRect(rect: PixelRect): boolean {
  return rect.width > 1 && rect.height > 1;
}
