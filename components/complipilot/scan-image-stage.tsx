"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import styles from "./scan-image-stage.module.css";

type ScanImageStageProps = {
  images: string[];
  progress: number;
  locale: "zh" | "en";
  isPreset?: boolean;
};

type StageStyle = CSSProperties & Record<`--${string}`, string | number>;

const PARTICLES = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  x: 7 + ((index * 37) % 88),
  y: 8 + ((index * 53) % 82),
  size: 2 + (index % 4),
  delay: (index % 8) * -0.45,
  duration: 4.6 + (index % 6) * 0.72,
}));

const layerDepth = [1, 3, 2];

export function ScanImageStage({
  images,
  progress,
  locale,
  isPreset = false,
}: ScanImageStageProps) {
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const visibleImages = useMemo(
    () => images.slice(0, 3).filter((image) => !failedImages.has(image)),
    [failedImages, images]
  );
  const safeProgress = Math.min(Math.max(progress, 0), 100);

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

  return (
    <figure
      className={styles.stage}
      data-count={visibleImages.length}
      onPointerMove={updateTilt}
      onPointerLeave={resetTilt}
      style={{ "--progress": `${safeProgress * 3.6}deg` } as StageStyle}
    >
      <div className={styles.haze} aria-hidden="true" />
      <div className={styles.grid} aria-hidden="true" />
      <div className={styles.particles} aria-hidden="true">
        {PARTICLES.map((particle) => (
          <span
            key={particle.id}
            className={styles.particle}
            style={
              {
                "--particle-x": `${particle.x}%`,
                "--particle-y": `${particle.y}%`,
                "--particle-size": `${particle.size}px`,
                "--particle-delay": `${particle.delay}s`,
                "--particle-duration": `${particle.duration}s`,
              } as StageStyle
            }
          />
        ))}
      </div>

      <div className={styles.orbits} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <div className={styles.progressDial} aria-label={`${safeProgress}%`}>
        <div className={styles.progressDialInner}>
          <strong>{safeProgress}%</strong>
          <span>{locale === "zh" ? "视觉建模" : "visual model"}</span>
        </div>
      </div>

      <div className={styles.scene}>
        {visibleImages.length ? (
          visibleImages.map((image, index) => (
            <div
              key={image}
              className={`${styles.layer} ${styles[`layer${index + 1}`]}`}
              style={{ zIndex: layerDepth[index] ?? index + 1 } as CSSProperties}
            >
              <div
                className={styles.floatLayer}
                style={{ "--float-delay": `${index * -1.35}s` } as StageStyle}
              >
                <div className={styles.imageCard}>
                  <Image
                    src={image}
                    alt={
                      locale === "zh"
                        ? `产品扫描视角 ${index + 1}`
                        : `Product scan angle ${index + 1}`
                    }
                    fill
                    sizes="(max-width: 520px) 61vw, (max-width: 820px) 54vw, 420px"
                    unoptimized
                    onError={() => markImageFailed(image)}
                  />
                  <div className={styles.cardSheen} aria-hidden="true" />
                  <span className={styles.imageIndex}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={styles.imageState}>
                    <i />
                    {locale === "zh" ? "图像已锁定" : "IMAGE LOCKED"}
                  </span>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className={styles.emptyState}>
            <span className={styles.emptyPulse} aria-hidden="true" />
            <strong>{locale === "zh" ? "正在建立产品视图" : "Building product view"}</strong>
            <p>{locale === "zh" ? "安全读取上传素材…" : "Reading uploaded assets securely…"}</p>
          </div>
        )}
      </div>

      <div className={styles.scanBeam} aria-hidden="true" />
      <div className={styles.floorGlow} aria-hidden="true" />

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
