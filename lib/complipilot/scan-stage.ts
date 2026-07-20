export type ScanStagePreset = "charger" | "humidifier" | "toy";

const PRESET_IMAGES: Record<ScanStagePreset, string> = {
  charger: "/mock-fixtures/preset-charger-photo.png",
  humidifier: "/mock-fixtures/preset-humidifier-photo.png",
  toy: "/mock-fixtures/preset-toy-blocks-photo.png",
};

type ScanStageImageInput = {
  sessionId: string;
  imageCount: number;
  preset?: ScanStagePreset | null;
};

export function resolveScanStageImages({
  sessionId,
  imageCount,
  preset,
}: ScanStageImageInput) {
  if (preset) {
    return [PRESET_IMAGES[preset]];
  }

  const visibleCount = Math.min(Math.max(Math.trunc(imageCount), 0), 3);
  const safeSessionId = encodeURIComponent(sessionId);

  return Array.from(
    { length: visibleCount },
    (_, index) => `/api/scan/${safeSessionId}/asset/${index}`,
  );
}
