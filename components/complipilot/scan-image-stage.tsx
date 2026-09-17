"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import styles from "./scan-image-stage.module.css";

type ScanImageStageProps = {
  images: string[];
  progress: number;
  cacheHits?: number;
  locale: "zh" | "en";
  stageKey?: string;
  isPreset?: boolean;
};

type StageStyle = CSSProperties & Record<`--${string}`, string | number>;

/**
 * J21: 图像证据舞台（原「2.5D disassembly-stage」命名已纠正——系统只做
 * 图像观察，没有 3D/拆解/空间重建能力）。the uploaded product image is the
 * visual anchor.
 *
 * Audit 2026-09-13 §4.3: the old version decorated the loading page with
 * severity-coded hotspot pins (高危/警告) at fixed positions and a fake
 * regulation checklist that ticked off EU 2023/1542 / FCC §15B / … as the
 * progress bar advanced — none of that was real; no findings exist while
 * the scan runs. Both decorations are gone. What remains is honest:
 * the photo, the phase the pipeline is actually in, the images analyzed,
 * and neutral scan motion (beam / tilt / ring). Real hotspots appear only
 * on the result page, grounded to model-emitted bboxes.
 */

/** Neutral scan waypoints — no severity, no fabricated findings. */
const SCAN_WAYPOINTS: ReadonlyArray<{ left: string; top: string }> = [
  { left: "18%", top: "22%" },
  { left: "62%", top: "18%" },
  { left: "76%", top: "52%" },
  { left: "44%", top: "44%" },
  { left: "12%", top: "66%" },
  { left: "58%", top: "78%" },
];

/** Each waypoint lights up at this progress fraction. */
const WAYPOINT_UNLOCK_AT = [0.18, 0.28, 0.36, 0.46, 0.56, 0.66];

/** Real pipeline phases — what the stage indicator actually reports. */
const PHASE_LABELS = [
  { key: "prepare", zh: "准备证据", en: "Prepare evidence" },
  { key: "generate", zh: "综合分析", en: "Analyze evidence" },
  { key: "verify", zh: "核对与交付", en: "Verify & deliver" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const STAGE_TO_PHASE_INDEX: Record<string, number> = {
  queued: 0, vision: 0, retrieval: 0, applicability: 0,
  report: 1, generate: 1, verify: 2, persist: 2, done: 2, failed: 0,
};

export function ScanImageStage({
  images,
  progress,
  locale,
  stageKey = "vision",
  isPreset = false,
  cacheHits = 0,
}: ScanImageStageProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const visibleImages = useMemo(
    () => images.slice(0, 3).filter((image) => !failedImages.has(image)),
    [failedImages, images]
  );
  const safeProgress = clamp(progress, 0, 100);
  const progressRatio = safeProgress / 100;

  // Image-evidence stage motion parameters — driven by progress:
  // 0   → image sits flat, no tilt, waypoints invisible, no fragments
  // 50  → card tilts ~14°, waypoints 1..3 visible, first half of phases lit
  // 100 → card tilts back to neutral, all waypoints visible, all phases lit
  // (J21: visual tilt only — this is NOT a 3D/spatial reconstruction.)
  const tiltX = clamp((progressRatio - 0.05) * 14, -2, 14);
  const explodeScale = clamp(0.96 + (progressRatio - 0.2) * 0.18, 0.96, 1.16);
  const ringOpacity = clamp((progressRatio - 0.12) * 1.6, 0, 1);
  const waypointOpacityBase = clamp((progressRatio - 0.16) * 1.8, 0, 1);

  const activePhaseIndex =
    STAGE_TO_PHASE_INDEX[stageKey] ?? STAGE_TO_PHASE_INDEX.vision;

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

  // Pick the first non-failed image as the "primary" image for the evidence
  // card; remaining images show as ghosted orbit slices so we don't waste the
  // data the user uploaded.
  const primaryImage = visibleImages[0];

  return (
    <figure
      className={styles.stage}
      data-count={visibleImages.length}
      onPointerMove={updateTilt}
      onPointerLeave={resetTilt}
      style={{
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

                {SCAN_WAYPOINTS.map((slot, index) => {
                  const unlocked = progressRatio >= WAYPOINT_UNLOCK_AT[index];
                  if (!unlocked) return null;
                  return (
                    <div
                      key={`scan-waypoint-${index}`}
                      className={styles.hotspotPin}
                      style={{
                        left: slot.left,
                        top: slot.top,
                        opacity: waypointOpacityBase,
                      } as StageStyle}
                      aria-hidden="true"
                    >
                      <span className={styles.ping} aria-hidden="true" />
                      <span className={styles.dot} aria-hidden="true" />
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
              {locale === "zh" ? "处理阶段" : "PIPELINE"}
            </span>
            <strong>
              {activePhaseIndex + 1}
              <span className={styles.feedSlash}>/</span>
              {PHASE_LABELS.length}
            </strong>
          </header>
          <ul className={styles.feedList}>
            {PHASE_LABELS.map((phase, index) => {
              const done = index < activePhaseIndex;
              const active = index === activePhaseIndex;
              return (
                <li
                  key={phase.key}
                  className={`${styles.feedRow} ${done ? styles.feedRowDone : ""}`}
                  aria-current={active ? "step" : undefined}
                >
                  <span className={styles.feedDot} aria-hidden="true">
                    {done ? "✓" : ""}
                  </span>
                  <span className={styles.feedCode}>
                    {locale === "zh" ? phase.zh : phase.en}
                    <small className={styles.phaseDetail}>{locale === "zh" ? (index === 0 ? (done ? (cacheHits > 0 ? `${cacheHits} 张识别结果已复用 · 检查范围已准备` : "图片识别与检查范围已准备") : "整理照片与检查范围") : index === 1 ? (done ? "报告内容已生成" : active ? "正在生成报告，等待模型返回" : "等待证据准备") : (active ? "核对引用并保存报告" : "报告生成后开始")) : (done ? "Completed" : active ? "Processing" : "Up next")}</small>
                  </span>
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
              ? "DEMO PRODUCT · 单图图像分析"
              : "DEMO PRODUCT · SINGLE IMAGE ANALYSIS"
            : locale === "zh"
              ? `${visibleImages.length} 个真实视角 · 图像证据分析`
              : `${visibleImages.length} REAL ANGLES · IMAGE EVIDENCE ANALYSIS`}
        </span>
        <strong>{locale === "zh" ? "AI 证据整理中" : "AI EVIDENCE ANALYSIS"}</strong>
      </figcaption>
    </figure>
  );
}
