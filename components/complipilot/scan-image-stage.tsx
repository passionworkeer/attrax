"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import styles from "./scan-image-stage.module.css";

type ScanImageStageProps = {
  images: string[];
  progress: number;
  locale: "zh" | "en";
  stageKey?: string;
  isPreset?: boolean;
};

type StageStyle = CSSProperties & Record<`--${string}`, string | number>;

/**
 * 2.5D disassembly-stage: the uploaded product image is the visual anchor;
 * six severity-coded hotspot pins fade in as `progress` advances so the
 * user sees the vision scan "landing" on parts of the product. A live
 * regulation-check feed on the right ticks regulations off as the
 * retrieval phase advances. Both feeds are deterministic (no random layout)
 * so that two concurrent scans do not drift apart visually.
 */
const HOTSPOT_SLOTS: ReadonlyArray<{ left: string; top: string; severity: "critical" | "warning" | "info" }> = [
  { left: "18%", top: "22%", severity: "critical" },
  { left: "62%", top: "18%", severity: "warning" },
  { left: "76%", top: "52%", severity: "info" },
  { left: "44%", top: "44%", severity: "critical" },
  { left: "12%", top: "66%", severity: "warning" },
  { left: "58%", top: "78%", severity: "info" },
];

const REGULATION_FEED: ReadonlyArray<{ code: string; market: string }> = [
  { code: "EU 2023/1542", market: "EU" },
  { code: "GPSR (EU) 2023/988", market: "EU" },
  { code: "EN IEC 62368-1", market: "EU" },
  { code: "FCC §15B", market: "US" },
  { code: "CPSIA", market: "US" },
  { code: "ASTM F963", market: "US" },
  { code: "UKCA — Electrical", market: "UK" },
  { code: "GB 31241-2022", market: "CN" },
  { code: "UN 38.3", market: "INTL" },
  { code: "PSE (METI)", market: "JP" },
];

/** Each hotspot completes at this progress fraction. */
const HOTSPOT_UNLOCK_AT = [0.18, 0.28, 0.36, 0.46, 0.56, 0.66];
/** Each regulation completes at this progress fraction. */
const REG_UNLOCK_AT = [0.12, 0.22, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.88];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const SEVERITY_LABEL: Record<"critical" | "warning" | "info", { zh: string; en: string }> = {
  critical: { zh: "高危", en: "Critical" },
  warning: { zh: "警告", en: "Warning" },
  info: { zh: "提示", en: "Info" },
};

export function ScanImageStage({
  images,
  progress,
  locale,
  stageKey = "vision",
  isPreset = false,
}: ScanImageStageProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const visibleImages = useMemo(
    () => images.slice(0, 3).filter((image) => !failedImages.has(image)),
    [failedImages, images]
  );
  const safeProgress = clamp(progress, 0, 100);
  const progressRatio = safeProgress / 100;

  // 2.5D disassembly parameters — driven by progress:
  // 0   → image sits flat, no tilt, hotspots invisible, no fragments
  // 50  → card tilts ~14°, hotspots 1..3 visible, first half of regs checked
  // 100 → card tilts back to neutral, all hotspots visible, all regs checked
  const tiltX = clamp((progressRatio - 0.05) * 14, -2, 14);
  const explodeScale = clamp(0.96 + (progressRatio - 0.2) * 0.18, 0.96, 1.16);
  const ringOpacity = clamp((progressRatio - 0.12) * 1.6, 0, 1);
  const hotspotOpacityBase = clamp((progressRatio - 0.16) * 1.8, 0, 1);

  function updateTilt(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.setProperty("--tilt-x", `${x * 6}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${y * -4.5}deg`);
  }

  function resetTilt(event: PointerEvent<HTMLElement>) {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  }

  function markImageFailed(image: string) {
    setFailedImages((current) => {
      const next = new Set(current);
      next.add(image);
      return next;
    });
  }

  // Pick the first non-failed image as the "primary" image for the 2.5D card;
  // remaining images show as ghosted orbit slices so we don't waste the
  // data the user uploaded.
  const primaryImage = visibleImages[0];

  return (
    <figure
      className={styles.stage}
      data-count={visibleImages.length}
      onPointerMove={updateTilt}
      onPointerLeave={resetTilt}
      style={{
        "--progress": `${safeProgress * 3.6}deg`,
        "--tilt-x": "0deg",
        "--tilt-y": "0deg",
      } as StageStyle}
    >
      <div className={styles.haze} aria-hidden="true" />
      <div className={styles.grid} aria-hidden="true" />

      <div
        className={styles.disassembleRing}
        aria-hidden="true"
        style={{ opacity: ringOpacity } as StageStyle}
      >
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className={styles.progressDial} aria-label={`${safeProgress}%`}>
        <div className={styles.progressDialInner}>
          <strong>{safeProgress}%</strong>
          <span>
            {stageKey === "queued"
              ? locale === "zh" ? "排队中" : "queued"
              : stageKey === "vision"
                ? locale === "zh" ? "视觉建模" : "vision"
                : stageKey === "retrieval"
                  ? locale === "zh" ? "法规检索" : "retrieval"
                  : stageKey === "report"
                    ? locale === "zh" ? "报告生成" : "report"
                    : stageKey === "done"
                      ? locale === "zh" ? "完成" : "done"
                      : locale === "zh"
                        ? "视觉建模"
                        : "vision"}
          </span>
        </div>
      </div>

      <div className={styles.stageLayout}>
        <div
          className={styles.scene}
          style={{
            transform: `perspective(1300px) rotateY(${tiltX}deg) rotateX(${tiltX * 0.4}deg)`,
          } as StageStyle}
        >
          {primaryImage ? (
            <div
              className={styles.cardWrap}
              style={{
                transform: `scale(${explodeScale})`,
              } as StageStyle}
            >
              <div className={styles.imageCard} data-active={progressRatio > 0.6 ? "true" : "false"}>
                <Image
                  src={primaryImage}
                  alt={
                    locale === "zh"
                      ? `产品扫描视角 1`
                      : `Product scan angle 1`
                  }
                  fill
                  sizes="(max-width: 820px) 80vw, 420px"
                  unoptimized
                  priority
                  onError={() => markImageFailed(primaryImage)}
                />
                <div className={styles.cardSheen} aria-hidden="true" />
                <span className={styles.imageIndex}>01</span>
                <span className={styles.imageState}>
                  <i />
                  {locale === "zh" ? "图像已锁定" : "IMAGE LOCKED"}
                </span>

                {HOTSPOT_SLOTS.map((slot, index) => {
                  const unlocked = progressRatio >= HOTSPOT_UNLOCK_AT[index];
                  if (!unlocked) return null;
                  const localized = SEVERITY_LABEL[slot.severity];
                  const label = locale === "zh" ? localized.zh : localized.en;
                  return (
                    <div
                      key={`hotspot-${index}`}
                      className={`${styles.hotspotPin} ${styles[`pin_${slot.severity}`]}`}
                      style={{
                        left: slot.left,
                        top: slot.top,
                        opacity: hotspotOpacityBase,
                      } as StageStyle}
                      aria-label={`${label} ${index + 1}`}
                    >
                      <span className={styles.ping} aria-hidden="true" />
                      <span className={styles.dot} aria-hidden="true" />
                      <span className={styles.chip}>
                        {String(index + 1).padStart(2, "0")} ·{" "}
                        {locale === "zh" ? localized.zh : localized.en}
                      </span>
                    </div>
                  );
                })}

                {visibleImages.length > 1 ? (
                  <div
                    className={styles.orbitSlivers}
                    style={{ opacity: clamp(progressRatio * 1.4, 0, 0.8) } as StageStyle}
                    aria-hidden="true"
                  >
                    {visibleImages.slice(1, 3).map((image, index) => (
                      <div
                        key={image}
                        className={`${styles.sliver} ${styles[`sliver${index + 2}`]}`}
                      >
                        <Image
                          src={image}
                          alt=""
                          fill
                          sizes="120px"
                          unoptimized
                          onError={() => markImageFailed(image)}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.emptyPulse} aria-hidden="true" />
              <strong>{locale === "zh" ? "正在建立产品视图" : "Building product view"}</strong>
              <p>{locale === "zh" ? "安全读取上传素材…" : "Reading uploaded assets securely…"}</p>
            </div>
          )}

          <div className={styles.scanBeam} aria-hidden="true" />
          <div className={styles.floorGlow} aria-hidden="true" />
        </div>

        <aside className={styles.feed} aria-live="polite">
          <header className={styles.feedHeader}>
            <span className={styles.feedEyebrow}>
              {locale === "zh" ? "法规检索" : "REG SCAN"}
            </span>
            <strong>
              {REGULATION_FEED.filter((_, i) => progressRatio >= REG_UNLOCK_AT[i]).length}
              <span className={styles.feedSlash}>/</span>
              {REGULATION_FEED.length}
            </strong>
          </header>
          <ul className={styles.feedList}>
            {REGULATION_FEED.map((reg, index) => {
              const done = progressRatio >= REG_UNLOCK_AT[index];
              return (
                <li
                  key={reg.code}
                  className={`${styles.feedRow} ${done ? styles.feedRowDone : ""}`}
                >
                  <span className={styles.feedDot} aria-hidden="true">
                    {done ? "✓" : ""}
                  </span>
                  <span className={styles.feedMarket}>{reg.market}</span>
                  <span className={styles.feedCode}>{reg.code}</span>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>

      <figcaption className={styles.caption}>
        <span>
          {isPreset
            ? locale === "zh"
              ? "DEMO PRODUCT · 单图扫描建模"
              : "DEMO PRODUCT · SINGLE IMAGE MODEL"
            : locale === "zh"
              ? `${visibleImages.length} 个真实视角 · 2.5D 空间建模`
              : `${visibleImages.length} REAL ANGLES · 2.5D SPATIAL MODEL`}
        </span>
        <strong>{locale === "zh" ? "AI 证据重建中" : "AI EVIDENCE RECONSTRUCTION"}</strong>
      </figcaption>
    </figure>
  );
}
