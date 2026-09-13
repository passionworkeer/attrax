import { describe, it, expect } from "vitest";
import {
  containRect,
  intrinsicRect,
  isUsableRect,
} from "@/lib/inspection/image-coordinate";

/**
 * Plan 2026-09-13 §8.1 — coordinate math for the inspection canvas.
 * The legacy page put an object-cover image in a fixed 4:3 box and
 * anchored hotspots by container percentage; cropping shifted the boxes
 * away from their grounded regions (audit P1-2).
 */
describe("image-coordinate", () => {
  describe("intrinsicRect (canvas ratio == image ratio)", () => {
    it("maps normalized bbox to percentage positions 1:1", () => {
      const rect = intrinsicRect({ x: 0.25, y: 0.5, w: 0.3, h: 0.2 });
      expect(rect).toEqual({
        left: 25,
        top: 50,
        width: 30,
        height: 20,
      });
    });
  });

  describe("containRect (fixed container + letterboxing)", () => {
    it("computes letterbox offsets and scale per the plan formula", () => {
      // Wide image (16:9) in a squarish container → letterboxed top/bottom.
      const rect = containRect(
        { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
        { width: 800, height: 800 },
        { width: 1600, height: 900 },
      );
      // scale = min(800/1600, 800/900) = 0.5
      // offsetX = (800 - 1600×0.5)/2 = 0; offsetY = (800 - 900×0.5)/2 = 175
      expect(rect.left).toBeCloseTo(0 + 0.5 * 1600 * 0.5, 5); // 400
      expect(rect.top).toBeCloseTo(175 + 0.5 * 900 * 0.5, 5); // 400
      expect(rect.width).toBeCloseTo(0.25 * 1600 * 0.5, 5); // 200
      expect(rect.height).toBeCloseTo(0.25 * 900 * 0.5, 5); // 112.5
    });

    it("handles tall images in wide containers (side letterboxing)", () => {
      const rect = containRect(
        { x: 0, y: 0, w: 1, h: 1 },
        { width: 1000, height: 500 },
        { width: 500, height: 1000 },
      );
      // scale = min(1000/500, 500/1000) = 0.5
      // offsetX = (1000 - 500×0.5)/2 = 375; offsetY = 0
      expect(rect.left).toBeCloseTo(375, 5);
      expect(rect.top).toBeCloseTo(0, 5);
      expect(rect.width).toBeCloseTo(250, 5);
      expect(rect.height).toBeCloseTo(500, 5);
    });

    it("returns a zero rect for degenerate image dimensions", () => {
      const rect = containRect(
        { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        { width: 800, height: 600 },
        { width: 0, height: 0 },
      );
      expect(rect).toEqual({ left: 0, top: 0, width: 0, height: 0 });
      expect(isUsableRect(rect)).toBe(false);
    });
  });

  describe("isUsableRect", () => {
    it("rejects sub-pixel rects", () => {
      expect(isUsableRect({ left: 0, top: 0, width: 0.5, height: 3 })).toBe(false);
      expect(isUsableRect({ left: 0, top: 0, width: 3, height: 0.5 })).toBe(false);
      expect(isUsableRect({ left: 0, top: 0, width: 5, height: 5 })).toBe(true);
    });
  });
});
