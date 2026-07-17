"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronLeft, Flame, Globe2, Languages, Sparkles } from "lucide-react";
import { getBlazeCopy } from "@/lib/mock/blaze-copy";
import { buttonVariants } from "@/components/ui/button";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import {
  blazeFeaturePills,
  blazeHeroCopy,
  blazeNavigation,
} from "@/lib/mock/blaze-scenario";
import { cn } from "@/lib/utils";

export function BlazeAtmosphere({
  variant = "home",
}: {
  variant?: "home" | "flow";
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("blaze-atmosphere", variant === "flow" && "blaze-atmosphere-flow")}
    >
      <div className="blaze-atmosphere-grid" />
      <div className="blaze-atmosphere-scan" />
      <div className="blaze-atmosphere-heat" />
      <div className="blaze-atmosphere-rail blaze-atmosphere-rail-one" />
      <div className="blaze-atmosphere-rail blaze-atmosphere-rail-two" />
    </div>
  );
}

export function BlazeHeader({
  primaryHref = "/upload",
  primaryLabel,
  secondaryHref = "/result/demo",
  secondaryLabel,
  variant = "site",
  flowTitle,
  flowSubtitle,
  backHref = "/",
  backLabel,
  statusLabel,
}: {
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  variant?: "site" | "flow";
  flowTitle?: string;
  flowSubtitle?: string;
  backHref?: string;
  backLabel?: string;
  statusLabel?: string;
}) {
  const { locale, setLocale } = useBlazeLocale();
  const copy = getBlazeCopy(locale);

  const languageSwitch = (
    <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/6 p-1 md:flex">
      <button
        type="button"
        onClick={() => setLocale("zh")}
        className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs transition ${
          locale === "zh" ? "bg-white/12 text-white" : "text-white/55"
        }`}
      >
        <Languages className="size-3.5" />
        中文
      </button>
      <button
        type="button"
        onClick={() => setLocale("en")}
        className={`rounded-full px-3 py-1.5 text-xs transition ${
          locale === "en" ? "bg-white/12 text-white" : "text-white/55"
        }`}
      >
        EN
      </button>
    </div>
  );

  if (variant === "flow") {
    return (
      <header className="border-b border-white/7 bg-[rgba(13,19,36,0.78)] shadow-[0_18px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-4">
            <Link
              href={backHref}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/62 transition hover:bg-white/9 hover:text-white"
            >
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">
                {backLabel ?? (locale === "zh" ? "返回首页" : "Back")}
              </span>
            </Link>
            <div className="hidden h-8 w-px shrink-0 bg-white/10 sm:block" />
            <Link href="/" className="flex min-w-0 items-center gap-3">
              <div className="hidden size-10 shrink-0 items-center justify-center rounded-2xl border border-white/14 bg-white/8 text-white shadow-[0_10px_40px_rgba(255,120,41,0.18)] sm:flex">
                <Flame className="size-5 text-[var(--blaze-orange)]" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.22em] text-[var(--blaze-orange)]/80">
                  Blaze Hawks
                </p>
                <p className="truncate text-lg font-semibold leading-tight text-white sm:text-xl">
                  {flowTitle ?? (locale === "zh" ? "出海合规全流程扫描" : "Compliance Scan Flow")}
                </p>
                {flowSubtitle ? (
                  <p className="hidden truncate text-xs text-white/44 md:block">{flowSubtitle}</p>
                ) : null}
              </div>
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {languageSwitch}
            {statusLabel ? (
              <span className="hidden rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm font-medium text-white/70 md:inline-flex">
                {statusLabel}
              </span>
            ) : (
              <Link
                href={secondaryHref}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "lg" }),
                  "hidden rounded-full border border-white/12 bg-white/6 px-4 text-white hover:bg-white/10 md:inline-flex"
                )}
              >
                {secondaryLabel ?? copy.header.secondary}
              </Link>
            )}
            <Link
              href={primaryHref}
              className={cn(
                buttonVariants({ size: "lg" }),
                "rounded-full border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] px-4 text-white shadow-[0_10px_35px_rgba(255,120,41,0.35)] hover:opacity-95 sm:px-5"
              )}
            >
              {primaryLabel ?? copy.header.primary}
            </Link>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-6 px-6 py-6">
      <Link href="/" className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl border border-white/14 bg-white/8 text-white shadow-[0_10px_40px_rgba(255,120,41,0.18)]">
          <Flame className="size-5 text-[var(--blaze-orange)]" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-[0.22em] text-white">
            Blaze Hawks
          </p>
          <p className="truncate text-xs text-white/48">BURN BEFORE YOU FLY</p>
        </div>
      </Link>

      <nav className="hidden items-center gap-6 xl:flex">
        {blazeNavigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-sm text-white/58 transition hover:text-white"
          >
            {item.label[locale]}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {languageSwitch}
        <Link
          href={secondaryHref}
          className={cn(
            buttonVariants({ variant: "ghost", size: "lg" }),
            "hidden rounded-full border border-white/12 bg-white/6 px-4 text-white hover:bg-white/10 md:inline-flex"
          )}
        >
          {secondaryLabel ?? copy.header.secondary}
        </Link>
        <Link
          href={primaryHref}
          className={cn(
            buttonVariants({ size: "lg" }),
            "rounded-full border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] px-5 text-white shadow-[0_10px_35px_rgba(255,120,41,0.35)] hover:opacity-95"
          )}
        >
          {primaryLabel ?? copy.header.primary}
        </Link>
      </div>
    </header>
  );
}

export function GlowPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/7 px-3 py-1.5 text-xs text-white/70">
      {children}
    </span>
  );
}

export function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[var(--blaze-orange)]/88">
      {children}
    </p>
  );
}

export function ProductPreviewCard({
  imageSrc = "/mock-fixtures/blaze-hero-global-charger.png",
  compact = false,
}: {
  imageSrc?: string;
  compact?: boolean;
}) {
  const { locale } = useBlazeLocale();
  const copy = getBlazeCopy(locale);

  return (
    <div className={cn("blaze-panel overflow-hidden", compact ? "p-4" : "p-5")}>
      <div className="flex items-center justify-between">
        <div>
          <SectionEyebrow>{copy.productPreview.heroPreview}</SectionEyebrow>
          <h3 className={cn("mt-3 font-semibold text-white", compact ? "text-lg" : "text-2xl")}>
            {locale === "zh" ? blazeHeroCopy.productCn : blazeHeroCopy.productEn}
          </h3>
        </div>
        <GlowPill>
          <Globe2 className="size-3.5 text-[var(--blaze-orange)]" />
          {locale === "zh" ? blazeHeroCopy.marketLabel : blazeHeroCopy.marketLabelEn}
        </GlowPill>
      </div>

      <div className="blaze-preview-frame mt-5 rounded-[28px] p-4">
        <div className={cn(
          "blaze-preview-canvas relative overflow-hidden rounded-[24px] border border-white/6",
          compact ? "aspect-[1.45/1]" : "aspect-[1.34/1]"
        )}>
          <Image
            src={imageSrc}
            alt="Blaze Hawks product preview"
            fill
            sizes="(min-width: 1280px) 32vw, (min-width: 768px) 42vw, 92vw"
            className="object-cover"
            priority
          />
          <div className="absolute inset-x-5 bottom-4 flex items-center justify-between rounded-full border border-white/10 bg-[rgba(8,13,25,0.84)] px-4 py-2 text-xs text-white/65 backdrop-blur">
            <span>{copy.productPreview.targetMarket}</span>
            <span>{copy.productPreview.riskHotspots}</span>
            <span>{copy.productPreview.netProfit}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeatureStrip() {
  const { locale } = useBlazeLocale();
  const pills =
    locale === "zh"
      ? blazeFeaturePills
      : ["Multi-angle Upload", "Live Vision Analysis", "Flame Hotspots", "Margin Board"];

  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {pills.map((pill) => (
        <GlowPill key={pill}>
          <Sparkles className="size-3.5 text-[var(--blaze-orange)]" />
          {pill}
        </GlowPill>
      ))}
    </div>
  );
}

export function CtaCluster() {
  const { locale } = useBlazeLocale();
  const copy = getBlazeCopy(locale);

  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <Link
        href="/upload"
        className={cn(
          buttonVariants({ size: "lg" }),
          "rounded-full border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] px-6 text-white shadow-[0_12px_40px_rgba(255,120,41,0.32)] hover:opacity-95"
        )}
      >
        {copy.home.ctaPrimary}
        <ArrowRight className="size-4" />
      </Link>
      <Link
        href="/result/demo"
        className={cn(
          buttonVariants({ variant: "ghost", size: "lg" }),
          "rounded-full border border-white/12 bg-white/6 px-6 text-white hover:bg-white/10"
        )}
      >
        {copy.home.ctaSecondary}
      </Link>
      <a
        href="/api/reference/entry-plan"
        download
        className={cn(
          buttonVariants({ variant: "ghost", size: "lg" }),
          "rounded-full border border-white/12 bg-transparent px-6 text-white/88 hover:bg-white/10"
        )}
      >
        {copy.home.ctaDownload}
      </a>
    </div>
  );
}
