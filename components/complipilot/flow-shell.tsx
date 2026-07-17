"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, Languages } from "lucide-react";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./flow-shell.module.css";

type FlowHeaderProps = {
  backHref?: string;
  backLabel?: string;
  flowTitle: string;
  flowSubtitle?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  statusLabel?: string;
  tone?: "default" | "bright";
};

type FlowToneProps = {
  tone?: "default" | "bright";
};

type FlowFooterProps = FlowToneProps & {
  sessionId?: string;
};

export function CompliPilotFlowBackdrop({ tone = "default" }: FlowToneProps) {
  return (
    <div
      className={`${styles.backdrop} ${tone === "bright" ? styles.backdropBright : ""}`}
      aria-hidden="true"
    >
      <Image
        src="/complipilot/ocean-poster.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className={styles.poster}
      />
      <video
        className={styles.video}
        src="/complipilot/ocean-hero.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
      <div className={styles.tint} />
      <div className={styles.light} />
    </div>
  );
}

export function CompliPilotFlowHeader({
  backHref = "/",
  backLabel,
  flowTitle,
  flowSubtitle,
  primaryHref = "/upload",
  primaryLabel = "开始检测",
  secondaryHref = "/result/demo",
  secondaryLabel = "查看演示",
  statusLabel,
  tone = "default",
}: FlowHeaderProps) {
  const { locale, setLocale } = useBlazeLocale();

  return (
    <header className={styles.header}>
      <div className={`${styles.headerInner} ${tone === "bright" ? styles.headerBright : ""}`}>
        <div className={styles.identityGroup}>
          <Link href={backHref} className={styles.backLink}>
            <ChevronLeft className="size-4" />
            <span className="hidden sm:inline">
              {backLabel ?? (locale === "zh" ? "返回" : "Back")}
            </span>
          </Link>

          <Link href="/" className={styles.brand}>
            <span className={styles.logoWrap}>
              <Image
                src="/complipilot/logo.png"
                alt="规航AI"
                width={40}
                height={40}
                className={styles.logo}
              />
            </span>
            <span className={styles.brandCopy}>
              <span className={styles.brandName}>规航AI · CompliPilot</span>
              <strong>{flowTitle}</strong>
              {flowSubtitle ? <small>{flowSubtitle}</small> : null}
            </span>
          </Link>
        </div>

        <div className={styles.actions}>
          <div className={styles.languageSwitch}>
            <Languages className="size-3.5" />
            <button
              type="button"
              aria-pressed={locale === "zh"}
              className={locale === "zh" ? styles.languageActive : undefined}
              onClick={() => setLocale("zh")}
            >
              中
            </button>
            <button
              type="button"
              aria-pressed={locale === "en"}
              className={locale === "en" ? styles.languageActive : undefined}
              onClick={() => setLocale("en")}
            >
              EN
            </button>
          </div>

          {statusLabel ? (
            <span className={styles.status}>{statusLabel}</span>
          ) : (
            <Link
              href={secondaryHref}
              className={cn(
                buttonVariants({ variant: "ghost", size: "lg" }),
                styles.secondaryAction
              )}
            >
              {secondaryLabel}
            </Link>
          )}

          <Link
            href={primaryHref}
            className={cn(buttonVariants({ size: "lg" }), styles.primaryAction)}
          >
            {primaryLabel}
          </Link>
        </div>
      </div>
    </header>
  );
}

export function CompliPilotFlowFooter({ tone = "default", sessionId }: FlowFooterProps) {
  const { locale } = useBlazeLocale();
  const resultHref = sessionId ? `/result/${sessionId}` : "/result/demo";

  return (
    <footer className={`${styles.footer} ${tone === "bright" ? styles.footerBright : ""}`}>
      <div className={styles.footerInner}>
        <Link href="/" className={styles.footerBrand}>
          <Image src="/complipilot/logo.png" alt="" width={34} height={34} />
          <span>
            <strong>规航AI</strong>
            <small>
              {locale === "zh"
                ? "让每一次出海都有合规航线"
                : "A compliance route for every market"}
            </small>
          </span>
        </Link>
        <nav aria-label={locale === "zh" ? "流程导航" : "Workflow navigation"}>
          <Link href="/upload">{locale === "zh" ? "图像识别" : "Image review"}</Link>
          <Link href={resultHref}>{locale === "zh" ? "风险扫描" : "Risk scan"}</Link>
          <Link href={`${resultHref}#reports`}>
            {locale === "zh" ? "法规溯源" : "Citations"}
          </Link>
          <Link href={`${resultHref}#report-previews`}>
            {locale === "zh" ? "可解释报告" : "Reports"}
          </Link>
        </nav>
        <p>
          {locale === "zh"
            ? "演示原型 · 结论需结合专业机构复核"
            : "Demo prototype · Validate conclusions with qualified professionals"}
        </p>
      </div>
    </footer>
  );
}
