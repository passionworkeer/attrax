"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  LockKeyhole,
  Sparkles,
  WalletCards,
  Zap,
} from "lucide-react";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { buttonVariants } from "@/components/ui/button";
import { SectionEyebrow } from "@/components/blaze-hawks/ui";
import {
  CompliPilotFlowBackdrop,
  CompliPilotFlowFooter,
  CompliPilotFlowHeader,
} from "@/components/complipilot/flow-shell";
import { cn } from "@/lib/utils";
import brightFlow from "@/components/complipilot/bright-flow.module.css";

const planIcons = [FileText, Sparkles, WalletCards] as const;

export default function PricingPage() {
  const { locale } = useBlazeLocale();
  const [selectedPlanIndex, setSelectedPlanIndex] = useState(1);
  const pricingPlans =
    locale === "zh"
      ? [
          {
            title: "单次解锁",
            price: "¥99",
            unit: "/ 次",
            badge: "按次交付",
            // J18: 只列已交付能力。旧的「认证绿色通道 / 专属客服」未实现，
            // 不再列成已包含权益（移到下方「规划中」区块）。
            features: ["单个 SKU 完整合规报告", "利润测算表导出", "风险整改建议", "7 天扫描历史保留"],
          },
          {
            title: "月度会员",
            price: "¥299",
            unit: "/ 月",
            badge: "官方推荐",
            features: [
              "每月 10 个 SKU 完整报告",
              "不限次产品扫描",
              "法规动态示例查看",
              "报告版本对比",
            ],
          },
          {
            title: "年度会员",
            price: "¥2399",
            unit: "/ 年",
            badge: "企业常用",
            features: ["每年 180 个 SKU 完整报告", "专家人工复核 1 次", "优先体验新功能"],
          },
        ]
      : [
          {
            title: "Single unlock",
            price: "¥99",
            unit: "/ run",
            badge: "Pay as you go",
            features: ["One complete SKU compliance report", "Profit sheet export", "Risk remediation advice", "7-day scan history"],
          },
          {
            title: "Monthly member",
            price: "¥299",
            unit: "/ mo",
            badge: "Recommended",
            features: [
              "10 complete SKU reports per month",
              "Unlimited product scans",
              "Regulation update demos",
              "Report revision comparison",
            ],
          },
          {
            title: "Annual member",
            price: "¥2399",
            unit: "/ yr",
            badge: "Team plan",
            features: ["180 complete SKU reports per year", "One expert manual review", "Early access to new features"],
          },
        ];
  const selectedPlan = pricingPlans[selectedPlanIndex] ?? pricingPlans[1];
  // J18: 「包含交付」只保留当前真实可交付的四项产出（旧版把
  // 「认证绿色通道与专属客服」列成已包含权益，未实现，已移除）。
  const unlockItems =
    locale === "zh"
      ? [
          "完整合规总报告 PDF / DOCX",
          "供应商整改路线图 CSV",
          "利润测算与 AI 决策说明",
          "扫描会话证据记录（7 天）",
        ]
      : [
          "Full compliance report PDF / DOCX",
          "Supplier remediation roadmap CSV",
          "Margin analysis and AI decision note",
          "Scan session evidence records (7 days)",
        ];
  // J18: 已交付 / 洽谈中的交付方式。私有化部署尚未交付，移入规划中区块。
  const deliveryModes =
    locale === "zh"
      ? [
          {
            title: "SaaS 订阅",
            price: "¥0-599 / 月",
            body: "注册即可获得 3 次免费扫描；订阅费已覆盖报告生成 Token 成本，不额外收取隐藏费用。",
            fit: "个人卖家 · 中小团队",
            metric: "最快 3 分钟开通",
          },
          {
            title: "API 服务（合作洽谈）",
            price: "¥0.1 / 次起",
            body: "适合 ERP / CRM / 内部选品系统集成，支持高频调用、阶梯折扣和结果回传；按项目对接，需商务洽谈。",
            fit: "平台系统 · 批量任务",
            metric: "按调用量弹性计费",
          },
        ]
      : [
          {
            title: "SaaS subscription",
            price: "¥0-599 / month",
            body: "Each account gets 3 free scans; report generation token cost is included in the subscription.",
            fit: "Sellers · small teams",
            metric: "Live in 3 minutes",
          },
          {
            title: "API service (in talks)",
            price: "from ¥0.1 / call",
            body: "Built for ERP / CRM / sourcing system integration with volume discounts and result callbacks; per-project onboarding via sales.",
            fit: "Platforms · batch jobs",
            metric: "Elastic usage pricing",
          },
        ];
  // J18: 规划中（尚未交付）——如实标注，不与已交付权益混排。
  const plannedItems =
    locale === "zh"
      ? [
          "专属客服支持",
          "认证绿色通道（对接实验室 / 认证机构）",
          "企业级多人协作",
          "私有化部署（法规库与产品数据留在内网）",
          "实时法规监控订阅（当前 /regulations 为静态示例）",
        ]
      : [
          "Dedicated support",
          "Certification fast lane (lab / body matchmaking)",
          "Enterprise multi-user collaboration",
          "Private deployment (rule libraries and product data on-prem)",
          "Live regulation monitoring (current /regulations page is a static demo)",
        ];

  return (
    <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
      <CompliPilotFlowBackdrop tone="bright" />

      <div className="relative z-10">
        <CompliPilotFlowHeader
          backHref="/profit/demo"
          backLabel={locale === "zh" ? "返回利润页" : "Back to profit"}
          flowTitle={locale === "zh" ? "产品方案" : "Product Plans"}
          flowSubtitle={locale === "zh" ? "合规报告 · 成本决策 · 整改路线" : "Reports · cost decisions · remediation roadmap"}
          primaryHref="/upload"
          primaryLabel={locale === "zh" ? "开始检测" : "Start scan"}
          secondaryHref="/profit/demo"
          secondaryLabel={locale === "zh" ? "查看成本示例" : "View cost demo"}
          tone="bright"
        />

      <section className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 pt-6">
        <section className="blaze-panel overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(15,26,51,0.95),rgba(11,20,38,0.92))] px-8 py-12 text-center shadow-[0_28px_80px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:px-10">
          <SectionEyebrow>Page 06</SectionEyebrow>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            {locale === "zh" ? "选择适合你的合规交付方式" : "Choose your compliance delivery plan"}
          </h1>
          <p className="mx-auto mt-4 max-w-4xl text-lg leading-8 text-white/60">
            {locale === "zh"
              ? "每个方案都沿用同一条检测闭环：产品图片、风险证据、法规依据、成本影响与整改路线。"
              : "Every plan follows the same complete flow: product images, risk evidence, citations, cost impact, and remediation."}
          </p>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
            {pricingPlans.map((plan, index) => {
              const Icon = planIcons[index] ?? Sparkles;
              const selected = selectedPlanIndex === index;
              const featured = selected;
              return (
                <article
                  key={plan.title}
                  className={cn(
                    "relative flex min-h-[480px] flex-col overflow-hidden p-7 transition-all duration-300 hover:-translate-y-1",
                    featured
                      ? "z-10 scale-[1.05] rounded-[28px] border border-[rgba(255,143,57,0.5)] bg-[linear-gradient(180deg,rgba(76,39,56,0.85),rgba(25,24,48,0.95))] shadow-[0_0_40px_rgba(255,120,41,0.3)] backdrop-blur-xl"
                      : "blaze-panel-soft",
                    selected && !featured && "outline outline-1 outline-[rgba(255,143,57,0.45)]"
                  )}
                >
                  {featured ? (
                    <div className="absolute left-7 top-7 rounded-full bg-[var(--blaze-red)] px-4 py-2 text-xs font-bold text-white shadow-[0_0_12px_rgba(239,90,49,0.4)]">
                      {plan.badge}
                    </div>
                  ) : null}
                  <div className={cn("mb-7 flex items-start justify-between gap-4", featured && "pt-9")}>
                    <div>
                      {!featured ? (
                        <p className="text-xs uppercase tracking-[0.22em] text-white/38">{plan.badge}</p>
                      ) : null}
                      <h2 className="mt-3 text-3xl font-semibold text-white">{plan.title}</h2>
                      <div className="mt-4 flex items-end gap-1 flex-wrap">
                        <span className="font-mono text-xs text-white/50">¥</span>
                        <span className={cn("font-mono font-bold tracking-tight", featured ? "text-[48px] text-white" : "text-[40px] text-white")}>
                          {plan.price.replace("¥", "")}
                        </span>
                        <span className="pb-1 text-sm text-white/48">{plan.unit}</span>
                        {index === 2 ? (
                          <span className="ml-2 rounded-full border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.12)] px-2.5 py-0.5 text-xs font-semibold text-[#10B981]">
                            {locale === "zh" ? "省 ¥1189" : "Save ¥1189"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/6 p-3 text-[var(--blaze-orange)]">
                      <Icon className="size-5" />
                    </div>
                  </div>

                  <div className="flex-1 space-y-3">
                    {plan.features.map((feature) => (
                      <div
                        key={feature}
                        className={cn(
                          "flex items-center gap-3 rounded-[18px] border px-4 py-3 text-sm font-medium",
                          featured
                            ? "border-[rgba(255,143,57,0.15)] bg-[rgba(255,143,57,0.06)] text-white/80"
                            : "border-white/35 bg-white/22 text-[#073b54]/78"
                        )}
                      >
                        <span className={cn("shrink-0 text-base", featured ? "text-[var(--blaze-orange)]" : "text-white/40")}>
                          {featured ? "⚡" : "✓"}
                        </span>
                        {feature}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedPlanIndex(index)}
                    className={cn(
                      buttonVariants({ size: "lg", variant: selected ? "default" : "ghost" }),
                      "mt-8 w-full rounded-full text-white",
                      featured
                        ? "border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] shadow-[0_12px_40px_rgba(255,120,41,0.3)] hover:opacity-95"
                        : "border border-white/10 bg-white/6 hover:bg-white/10"
                    )}
                  >
                    {selected
                      ? locale === "zh"
                        ? "已选择该方案"
                        : "Selected"
                      : locale === "zh"
                        ? "立即解锁"
                        : "Unlock now"}
                    <Zap className="size-4" />
                  </button>
                </article>
              );
            })}
        </section>

        <section className="blaze-panel overflow-hidden p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-stretch">
            <div className="flex flex-col rounded-[26px] border border-[rgba(255,143,57,0.24)] bg-[linear-gradient(145deg,rgba(255,143,57,0.13),rgba(255,255,255,0.05))] p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <SectionEyebrow>{locale === "zh" ? "当前方案" : "Selected Plan"}</SectionEyebrow>
                  <h2 className="mt-3 text-2xl font-semibold text-white">{selectedPlan.title}</h2>
                  <p className="mt-2 text-sm text-white/52">{selectedPlan.badge}</p>
                </div>
                <div className="rounded-2xl border border-white/12 bg-white/8 p-3 text-[var(--blaze-orange)]">
                  <WalletCards className="size-5" />
                </div>
              </div>
              <div className="mt-6 flex items-end gap-1">
                <span className="text-4xl font-semibold text-white">{selectedPlan.price}</span>
                <span className="pb-1 text-sm text-white/48">{selectedPlan.unit}</span>
              </div>
              <div className="mt-5 space-y-2">
                {selectedPlan.features.slice(0, 2).map((feature) => (
                  <div key={feature} className="flex items-center gap-2.5 text-sm text-white/62">
                    <CheckCircle2 className="size-4 shrink-0 text-[#6ee7dd]" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto pt-6">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#6ee7dd]">
                  <LockKeyhole className="size-4" />
                  {locale === "zh" ? "演示环境 · 不会发起真实支付" : "Demo mode · no real payment"}
                </div>
                <a
                  href="mailto:contact@attrax.example?subject=Entry%20Plan"
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "mt-5 w-full rounded-full border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] text-white shadow-[0_12px_40px_rgba(255,120,41,0.26)] hover:opacity-95"
                  )}
                >
                  {locale === "zh" ? "联系获取参赛计划书" : "Request Entry Plan"}
                </a>
              </div>
            </div>

            <div className="rounded-[26px] border border-white/10 bg-white/[0.045] p-5 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <SectionEyebrow>{locale === "zh" ? "包含交付" : "Included"}</SectionEyebrow>
                  <h2 className="mt-3 text-2xl font-semibold text-white">
                    {locale === "zh" ? "一次解锁，交付完整闭环" : "One unlock, complete delivery"}
                  </h2>
                </div>
                <p className="text-sm text-white/48">04 {locale === "zh" ? "项核心产出" : "core outputs"}</p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {unlockItems.map((item, index) => (
                  <div key={item} className="flex min-h-20 items-center gap-4 rounded-[20px] border border-white/10 bg-white/[0.055] px-4 py-3.5 text-sm text-white/72">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/8 font-mono text-xs text-[#6ee7dd]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="leading-6">{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-white/8 bg-white/[0.035] px-4 py-3">
                <p className="text-sm text-white/56">
                  {locale === "zh" ? "方案切换后，交付范围与价格会在此处同步更新。" : "Plan scope and price update here when selection changes."}
                </p>
                <div className="flex items-center gap-2 text-xs font-semibold text-[#6ee7dd]">
                  <CheckCircle2 className="size-4" />
                  {locale === "zh" ? "已同步当前选择" : "Selection synced"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-white/10 pt-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <SectionEyebrow>{locale === "zh" ? "落地方式" : "Delivery Modes"}</SectionEyebrow>
                <h2 className="mt-3 text-2xl font-semibold text-white">
                  {locale === "zh" ? "按业务阶段选择接入方式" : "Choose how the service fits your operation"}
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-white/50">
                {locale === "zh" ? "从即开即用到内网部署，分析能力与报告口径保持一致。" : "From instant access to private deployment, analysis and reporting stay consistent."}
              </p>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {deliveryModes.map((mode, index) => {
                const ModeIcon = planIcons[index] ?? Sparkles;
                return (
                  <article key={mode.title} className="blaze-panel-soft flex min-h-[300px] flex-col p-6">
                    <div className="relative z-10 flex h-full flex-col">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.2em] text-white/42">0{index + 1}</p>
                          <h3 className="mt-3 text-2xl font-semibold text-white">{mode.title}</h3>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/7 p-3 text-[#6ee7dd]">
                          <ModeIcon className="size-5" />
                        </div>
                      </div>
                      <p className="mt-4 text-3xl font-black leading-tight text-[#073b54]">{mode.price}</p>
                      <p className="mt-5 text-sm leading-7 text-white/58">{mode.body}</p>
                      <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
                        <div className="rounded-[16px] border border-white/8 bg-white/[0.04] px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/36">{locale === "zh" ? "适用" : "Best for"}</p>
                          <p className="mt-1.5 text-xs font-medium text-white/68">{mode.fit}</p>
                        </div>
                        <div className="rounded-[16px] border border-white/8 bg-white/[0.04] px-3 py-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-white/36">{locale === "zh" ? "特点" : "Highlight"}</p>
                          <p className="mt-1.5 text-xs font-medium text-white/68">{mode.metric}</p>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="blaze-panel flex flex-col items-center justify-between gap-6 rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(17,29,55,0.84),rgba(12,22,40,0.82))] px-8 py-7 text-center backdrop-blur-sm md:flex-row md:text-left">
          <div className="max-w-3xl">
            <p className="text-lg font-semibold text-white">
              {locale === "zh"
                ? "演示闭环已覆盖图片上传、风险扫描、法规溯源、成本决策与报告导出"
                : "The demo flow covers image upload, risk scanning, citations, cost decisions, and report export"}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {(locale === "zh"
              ? ["前端闭环", "可解释报告", "本地部署"]
              : ["Complete flow", "Explainable reports", "Local deployment"]
            ).map((label) => (
              <div
                key={label}
                className="flex h-10 min-w-28 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/7 px-4 text-xs font-semibold text-white/64"
              >
                <CheckCircle2 className="size-3.5 text-[#6ee7dd]" />
                {label}
              </div>
            ))}
          </div>
        </section>

        <div className="text-center">
          <Link
            href="/profit/demo"
            className="inline-flex items-center gap-2 border-b border-transparent pb-1 text-sm text-white/58 transition hover:border-[var(--blaze-orange)] hover:text-[var(--blaze-orange)]"
          >
            <ArrowLeft className="size-4" />
            <span>{locale === "zh" ? "返回成本结果页" : "Back to cost result"}</span>
          </Link>
        </div>
      </section>
        <CompliPilotFlowFooter tone="bright" />
      </div>
    </main>
  );
}
