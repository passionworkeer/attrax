import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default function Home({ params }: PageProps) {
  const { locale } = React.use(params);
  return <HomeContent locale={locale} />;
}

function HomeContent({ locale }: { locale: string }) {
  // Import useTranslations at the top level
  const t = useTranslations("home");
  const tCommon = useTranslations("common");

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 rounded-4xl border border-white/60 bg-white/80 px-8 py-12 text-center shadow-[0_30px_120px_rgba(26,26,46,0.12)] backdrop-blur">
        <p className="text-sm font-medium uppercase tracking-[0.28em] text-blaze-red/80">
          Blaze Hawks
        </p>
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl">
            {t("title")}
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>
          <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            {t("description")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl bg-gray-50 p-4 text-center">
            <div className="text-2xl font-bold text-blaze-red">16+</div>
            <div className="text-sm text-gray-500">{t("stats.markets")}</div>
          </div>
          <div className="rounded-xl bg-gray-50 p-4 text-center">
            <div className="text-2xl font-bold text-blaze-red">96</div>
            <div className="text-sm text-gray-500">{t("stats.regulations")}</div>
          </div>
          <div className="rounded-xl bg-gray-50 p-4 text-center">
            <div className="text-2xl font-bold text-blaze-red">12M+</div>
            <div className="text-sm text-gray-500">Characters</div>
          </div>
          <div className="rounded-xl bg-gray-50 p-4 text-center">
            <div className="text-2xl font-bold text-blaze-red">5min</div>
            <div className="text-sm text-gray-500">{t("fastAnalysis")}</div>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/${locale}/upload`}
            className={cn(
              buttonVariants({ size: "lg" }),
              "bg-blaze-red px-6 text-white hover:bg-blaze-red/90"
            )}
          >
            {t("startScanning")}
          </Link>
          <Link
            href={`/${locale}/regulations`}
            className={cn(buttonVariants({ size: "lg", variant: "outline" }), "px-6")}
          >
            {t("regulations.viewAll")}
          </Link>
        </div>
      </section>
    </main>
  );
}

import React from "react";