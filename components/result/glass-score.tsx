"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import styles from "./glass-score.module.css";

type GlassScoreProps = {
  score: number | null;
  supported: number;
  blocked: number;
  unresolved: number;
  applicableCount: number;
  locale: "zh" | "en";
};

type SegmentState = "supported" | "blocked" | "unresolved";

const GLASS_PARAMETERS = {
  borderWidth: 0.07,
  brightness: 50,
  opacity: 0.93,
  blur: 11,
  displace: 0.5,
  distortionScale: -180,
  redOffset: 0,
  greenOffset: 10,
  blueOffset: 20,
  backgroundOpacity: 0.1,
  saturation: 1,
} as const;

function confidenceLabel(score: number | null, locale: "zh" | "en") {
  if (score === null) return locale === "zh" ? "待评估" : "Pending";
  if (score >= 80) return locale === "zh" ? "较高可信度" : "Higher confidence";
  if (score >= 50) return locale === "zh" ? "中等可信度" : "Medium confidence";
  return locale === "zh" ? "有限可信度" : "Limited confidence";
}

function buildSegments(props: Pick<GlassScoreProps, "supported" | "blocked" | "applicableCount">): SegmentState[] {
  return Array.from({ length: props.applicableCount }, (_, index) => {
    if (index < props.supported) return "supported";
    if (index < props.supported + props.blocked) return "blocked";
    return "unresolved";
  });
}

export function GlassScore({ score, supported, blocked, unresolved, applicableCount, locale }: GlassScoreProps) {
  const filterId = `score-glass-${useId().replaceAll(":", "")}`;
  const glassRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<SVGFEImageElement>(null);
  const animationFrame = useRef<number | null>(null);
  const [animationRun, setAnimationRun] = useState(0);
  const [displayScore, setDisplayScore] = useState<number | null>(score);
  const [fallback, setFallback] = useState(false);
  const segments = buildSegments({ supported, blocked, applicableCount });
  const zh = locale === "zh";

  useEffect(() => {
    const glass = glassRef.current;
    const map = mapRef.current;
    if (!glass || !map) return;

    const filterValue = `url(#${filterId})`;
    const probe = document.createElement("div");
    probe.style.backdropFilter = filterValue;
    const svgBackdropSupported = probe.style.backdropFilter !== "";
    setFallback(!svgBackdropSupported);

    const updateMap = () => {
      const rect = glass.getBoundingClientRect();
      const width = Math.max(1, rect.width || 218);
      const height = Math.max(1, rect.height || 218);
      const computedRadius = Number.parseFloat(getComputedStyle(glass).borderRadius) || 44;
      const edgeSize = Math.min(width, height) * (GLASS_PARAMETERS.borderWidth * 0.5);
      const innerWidth = Math.max(1, width - edgeSize * 2);
      const innerHeight = Math.max(1, height - edgeSize * 2);
      const displacementMap = `
        <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="red-gradient" x1="100%" y1="0%" x2="0%" y2="0%">
              <stop offset="0%" stop-color="#0000"/>
              <stop offset="100%" stop-color="red"/>
            </linearGradient>
            <linearGradient id="blue-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#0000"/>
              <stop offset="100%" stop-color="blue"/>
            </linearGradient>
          </defs>
          <rect width="${width}" height="${height}" fill="black"/>
          <rect width="${width}" height="${height}" rx="${computedRadius}" fill="url(#red-gradient)"/>
          <rect width="${width}" height="${height}" rx="${computedRadius}" fill="url(#blue-gradient)" style="mix-blend-mode:difference"/>
          <rect x="${edgeSize}" y="${edgeSize}" width="${innerWidth}" height="${innerHeight}" rx="${computedRadius}" fill="hsl(0 0% ${GLASS_PARAMETERS.brightness}% / ${GLASS_PARAMETERS.opacity})" style="filter:blur(${GLASS_PARAMETERS.blur}px)"/>
        </svg>`;

      map.setAttribute("href", `data:image/svg+xml,${encodeURIComponent(displacementMap)}`);
      glass.style.setProperty("--score-filter", filterValue);
      glass.style.setProperty("--score-glass-opacity", String(GLASS_PARAMETERS.backgroundOpacity));
      glass.style.setProperty("--score-glass-saturation", String(GLASS_PARAMETERS.saturation));
    };

    updateMap();
    const observer = new ResizeObserver(updateMap);
    observer.observe(glass);
    return () => observer.disconnect();
  }, [animationRun, filterId]);

  useEffect(() => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = 1200;
    animationFrame.current = requestAnimationFrame(started => {
      if (score === null || reduceMotion) {
        setDisplayScore(score);
        return;
      }
      setDisplayScore(0);
      const tick = (now: number) => {
        const progress = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayScore(Math.round(score * eased));
        if (progress < 1) animationFrame.current = requestAnimationFrame(tick);
      };
      animationFrame.current = requestAnimationFrame(tick);
    });
    return () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    };
  }, [animationRun, score]);

  const confidence = confidenceLabel(score, locale);
  const meterLabel = score === null
    ? (zh ? "尚无适用检查可评分" : "No applicable checks to score")
    : `${score} / 100`;
  const coverageLabel = zh
    ? `${supported} 项有证据，${blocked} 项需补证，${unresolved} 项尚未判断`
    : `${supported} supported, ${blocked} need evidence, ${unresolved} unresolved`;

  return <div className={styles.scoreCard}>
    <div className={styles.scoreHeader}>
      <span>{zh ? "AI 合规评估" : "AI compliance assessment"}</span>
      <span className={styles.confidence} data-level={score === null ? "pending" : score >= 80 ? "high" : score >= 50 ? "medium" : "limited"}>
        <i aria-hidden="true" />{confidence}
      </span>
    </div>

    <div
      key={animationRun}
      ref={glassRef}
      className={`${styles.scoreGlass} ${fallback ? styles.scoreGlassFallback : styles.scoreGlassSvg}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score ?? undefined}
      aria-label={meterLabel}
      data-glass-mode={fallback ? "fallback" : "svg"}
    >
      <svg className={styles.filterSvg} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter id={filterId} colorInterpolationFilters="sRGB" x="0%" y="0%" width="100%" height="100%">
            <feImage ref={mapRef} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" scale={GLASS_PARAMETERS.distortionScale + GLASS_PARAMETERS.redOffset} result="displacedRed" />
            <feColorMatrix in="displacedRed" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
            <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" scale={GLASS_PARAMETERS.distortionScale + GLASS_PARAMETERS.greenOffset} result="displacedGreen" />
            <feColorMatrix in="displacedGreen" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
            <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" scale={GLASS_PARAMETERS.distortionScale + GLASS_PARAMETERS.blueOffset} result="displacedBlue" />
            <feColorMatrix in="displacedBlue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
            <feBlend in="red" in2="green" mode="screen" result="redGreen" />
            <feBlend in="redGreen" in2="blue" mode="screen" result="output" />
            <feGaussianBlur in="output" stdDeviation={GLASS_PARAMETERS.displace} />
          </filter>
        </defs>
      </svg>
      <div className={`${styles.scoreContent} ${score === null ? styles.scoreContentPending : ""}`} aria-hidden="true">
        <strong>{displayScore ?? (zh ? "待评估" : "Pending")}</strong>
        {score !== null && <span>/ 100</span>}
      </div>
    </div>

    <p className={styles.scoreCaption}>{score === null ? (zh ? "尚无适用检查可评分" : "No applicable checks to score") : (zh ? "当前证据支持度" : "Current evidence support")}</p>

    <div className={styles.coverageTitle}>
      <span>{zh ? "核验覆盖" : "Coverage"}</span>
      <strong>{applicableCount - unresolved} / {applicableCount}</strong>
    </div>
    <div className={styles.segments} aria-label={coverageLabel} style={{ gridTemplateColumns: `repeat(${Math.max(1, applicableCount)}, minmax(4px, 1fr))` }}>
      {segments.map((state, index) => <i key={`${animationRun}-${index}`} data-state={state} />)}
    </div>
    <div className={styles.legend}>
      <span data-state="supported"><i aria-hidden="true" />{supported} {zh ? "项有证据" : "supported"}</span>
      <span data-state="blocked"><i aria-hidden="true" />{blocked} {zh ? "项需补证" : "need evidence"}</span>
      {unresolved > 0 && <span data-state="unresolved"><i aria-hidden="true" />{unresolved} {zh ? "项待判断" : "unresolved"}</span>}
    </div>
    <div className={styles.scoreNote}>
      <span>{zh ? "分数反映证据完备度" : "Score reflects evidence completeness"}</span>
      <button type="button" onClick={() => setAnimationRun(run => run + 1)}>
        <RotateCcw size={13} aria-hidden="true" />{zh ? "重播动效" : "Replay"}
      </button>
    </div>
  </div>;
}
