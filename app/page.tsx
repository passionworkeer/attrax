"use client";

import Link from "next/link";
import { Flame, Rocket, ShieldCheck, Zap, ArrowRight, ScanLine } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

const STATS = [
  { value: "16+", labelKey: "home.stats.markets" },
  { value: "96", labelKey: "home.stats.regulations" },
  { value: "12M+", labelKey: "home.charactersStat" },
  { value: "5min", labelKey: "home.features.fastAnalysis" },
] as const;

const FEATURES = [
  {
    icon: Rocket,
    titleKey: "home.features.multiMarket",
    descKey: "home.features.multiMarketDesc",
  },
  {
    icon: Zap,
    titleKey: "home.features.fastAnalysis",
    descKey: "home.features.fastAnalysisDesc",
  },
  {
    icon: ShieldCheck,
    titleKey: "home.features.preciseCitations",
    descKey: "home.features.preciseCitationsDesc",
  },
  {
    icon: ScanLine,
    titleKey: "home.features.actionableAdvice",
    descKey: "home.features.actionableAdviceDesc",
  },
];

export default function Home() {
  const { t, locale } = useTranslation();
  const isEn = locale === "en";

  return (
    <main className="relative min-h-[calc(100vh-5rem)] overflow-hidden">
      {/* Hero Section */}
      <section className="relative min-h-[calc(100vh-5rem)] flex items-center overflow-hidden">
        {/* Background glows */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <div className="absolute top-1/4 -right-1/4 w-[800px] h-[800px] bg-blaze-red rounded-full blur-[160px] opacity-15" />
          <div className="absolute bottom-1/4 -left-1/4 w-[600px] h-[600px] bg-blaze-cyan rounded-full blur-[140px] opacity-[0.05]" />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
              maskImage: "radial-gradient(ellipse 80% 50% at 50% 50%, #000 10%, transparent 100%)",
              WebkitMaskImage: "radial-gradient(ellipse 80% 50% at 50% 50%, #000 10%, transparent 100%)",
            }}
          />
        </div>

        <div className="max-w-[1440px] mx-auto px-6 sm:px-12 w-full relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            {/* Left column */}
            <div className="md:col-span-7 flex flex-col gap-6">
              <div className="space-y-3">
                <p className="data-mono text-xs tracking-[0.2em] uppercase text-blaze-orange">
                  Burn Before You Fly.
                </p>
                <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white leading-[1.05]">
                  {isEn ? (
                    <>
                      {t("home.subtitleLead")}
                      <br />
                      <span className="text-blaze-red text-glow">{t("home.subtitleHighlight")}</span>
                    </>
                  ) : (
                    <>
                      {t("home.subtitleLead")}
                      <span className="text-blaze-red text-glow">{t("home.subtitleHighlight")}</span>
                    </>
                  )}
                </h1>
              </div>

              <div className="space-y-4 max-w-2xl">
                <p className="text-lg sm:text-xl font-semibold text-white border-l-4 border-blaze-red pl-4">
                  {isEn
                    ? "LEC AI powered · UK 48 Group strategic partner · China-Europe full-chain AI infrastructure"
                    : "LEC AI 深度驱动 · 英国48家集团战略合作 · 中国-欧洲全链路出海 AI 原生基础设施"}
                </p>
                <p className="text-base text-slate-400 leading-relaxed">
                  {isEn
                    ? "Covering selection, compliance, growth, fulfillment, and risk — complete the full overseas launch in 12 hours, compressing the 6-month entry barrier down to 72 hours."
                    : "以合规智能为入口，覆盖选品-合规-增长-履约-风控全链路，12小时完成出海全流程准备，把中国企业落地欧洲市场的门槛从6个月降到72小时。"}
                </p>
              </div>

              <div className="flex flex-wrap gap-3 mt-2">
                <Link
                  href="/upload"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blaze-red px-6 py-3.5 text-base font-bold text-white shadow-[0_0_25px_rgba(217,58,26,0.5)] transition-all hover:shadow-[0_0_40px_rgba(217,58,26,0.7)] hover:scale-[1.02] active:scale-[0.98] border border-blaze-red/50 min-w-[240px]"
                >
                  <Flame className="h-5 w-5" fill="white" />
                  {isEn ? "Scan · Calculate Profit" : "立即体验 Demo"}
                </Link>
                <Link
                  href="/regulations"
                  className="inline-flex items-center justify-center gap-2 rounded-lg glass-panel px-6 py-3.5 text-base font-semibold text-white transition-all hover:bg-slate-800/60 hover:border-blaze-red/40 min-w-[200px]"
                >
                  {isEn ? "View Regulations" : "查看法规更新"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            {/* Right column: Eagle logo with flame halo */}
            <div className="md:col-span-5 relative h-[520px] hidden md:flex items-center justify-center">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(217,58,26,0.25)_0%,transparent_65%)] rounded-full" />
              <div className="relative h-64 w-64 flex items-center justify-center rounded-full">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blaze-red via-blaze-orange to-blaze-gold opacity-90 blur-2xl animate-pulse" />
                <div className="relative h-56 w-56 rounded-full bg-gradient-to-br from-blaze-red via-blaze-red-bright to-blaze-orange shadow-[0_0_80px_rgba(217,58,26,0.7)] flex items-center justify-center border-4 border-blaze-gold/30">
                  <Flame className="h-28 w-28 text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.6)]" fill="white" strokeWidth={1.5} />
                </div>
                <div className="absolute inset-0 rounded-full border-2 border-blaze-red/40 animate-ping" style={{ animationDuration: "3s" }} />
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {STATS.map((stat) => (
              <div
                key={stat.value}
                className="glass-panel rounded-2xl p-4 text-center transition-all hover:border-blaze-red/40 hover:shadow-[0_0_20px_rgba(217,58,26,0.2)]"
              >
                <div className="text-2xl sm:text-3xl font-black text-blaze-red data-mono">
                  {stat.value}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  {t(stat.labelKey)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom flame divider */}
        <div className="absolute bottom-0 left-0 w-full h-[20px] flame-divider" />
      </section>

      {/* Features Section */}
      <section className="py-20 relative">
        <div className="max-w-[1440px] mx-auto px-6 sm:px-12">
          <div className="mb-10 text-center">
            <p className="label-caps text-xs text-blaze-red/80 mb-2">
              {isEn ? "Core Capabilities" : "核心功能"}
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              {isEn ? "Engineered for High-Velocity Precision" : "硬核赛博工业风·全链路合规"}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {FEATURES.map((feature, idx) => {
              const Icon = feature.icon;
              const isWide = idx === 1 || idx === 3;
              return (
                <div
                  key={feature.titleKey}
                  className={`glass-panel rounded-xl p-6 flex flex-col gap-3 transition-all hover:border-blaze-red/40 hover:shadow-[0_0_25px_rgba(217,58,26,0.2)] hover:-translate-y-0.5 ${
                    isWide ? "md:col-span-8" : "md:col-span-4"
                  }`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blaze-red/15 border border-blaze-red/30">
                    <Icon className="h-6 w-6 text-blaze-red" />
                  </div>
                  <h3 className="text-xl font-bold text-white">{t(feature.titleKey)}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{t(feature.descKey)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-16 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6 sm:px-12">
          <div className="mb-8">
            <div className="text-xl font-black italic tracking-tighter text-white">
              Attrax
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            <div className="flex flex-col gap-3">
              <Link href="/" className="text-sm text-slate-400 hover:text-blaze-red transition-colors">
                {isEn ? "Solutions" : "产品方案"}
              </Link>
              <Link href="/upload" className="text-sm text-slate-400 hover:text-blaze-red transition-colors">
                {isEn ? "Demo" : "Demo 演示"}
              </Link>
            </div>
            <div className="flex flex-col gap-3">
              <Link href="/regulations" className="text-sm text-slate-400 hover:text-blaze-red transition-colors">
                {isEn ? "Regulations" : "法规更新"}
              </Link>
              <Link href="/trace" className="text-sm text-slate-400 hover:text-blaze-red transition-colors">
                {isEn ? "Trace" : "智能体轨迹"}
              </Link>
            </div>
            <div className="flex flex-col gap-3">
              <Link href="/roadmap" className="text-sm text-slate-400 hover:text-blaze-red transition-colors">
                {isEn ? "Roadmap" : "合规路线图"}
              </Link>
              <span className="text-sm text-slate-400 hover:text-blaze-red transition-colors cursor-pointer">
                {isEn ? "Resources" : "合作资源"}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-sm text-slate-400 hover:text-blaze-red transition-colors cursor-pointer">
                {isEn ? "About" : "关于我们"}
              </span>
              <span className="text-sm text-slate-400 hover:text-blaze-red transition-colors cursor-pointer">
                {isEn ? "Contact" : "联系我们"}
              </span>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-white/10">
            <p className="text-sm text-slate-400">
              © 2026 Attrax. {isEn ? "Engineered for High-Velocity Precision." : "硬核赛博工业风·全链路出海合规。"}
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
