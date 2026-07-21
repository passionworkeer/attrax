import { describe, expect, it } from "vitest";
import { resolveScanStageImages } from "@/lib/complipilot/scan-stage";

describe("resolveScanStageImages", () => {
  it("returns at most the first three authenticated scan asset URLs", () => {
    expect(
      resolveScanStageImages({
        sessionId: "scan_abc",
        imageCount: 5,
      }),
    ).toEqual([
      "/api/scan/scan_abc/asset/0",
      "/api/scan/scan_abc/asset/1",
      "/api/scan/scan_abc/asset/2",
    ]);
  });

  it("never duplicates missing upload angles", () => {
    expect(
      resolveScanStageImages({ sessionId: "scan_abc", imageCount: 1 }),
    ).toEqual(["/api/scan/scan_abc/asset/0"]);
  });

  it.each([
    ["charger", "/mock-fixtures/preset-charger-photo.png"],
    ["humidifier", "/mock-fixtures/preset-humidifier-photo.png"],
    ["toy", "/mock-fixtures/preset-toy-blocks-photo.png"],
  ] as const)("maps the %s demo to one matching product image", (preset, image) => {
    expect(
      resolveScanStageImages({
        sessionId: "demo",
        imageCount: 3,
        preset,
      }),
    ).toEqual([image]);
  });
});
