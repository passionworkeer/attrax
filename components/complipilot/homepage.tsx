"use client";

import Image from "next/image";
import Link from "next/link";
import { FileCheck2, Route, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import styles from "./homepage.module.css";

export function CompliPilotHome() {
  const { locale, setLocale } = useBlazeLocale();
  const isZh = locale === "zh";
  const markets = [
    { id: "eu", label: isZh ? "欧盟" : "EU" },
    { id: "uk", label: isZh ? "英国" : "UK" },
    { id: "na", label: isZh ? "北美" : "North America" },
  ] as const;
  const capabilities = isZh
    ? ["图像识别", "风险扫描", "法规溯源", "可解释报告"]
    : ["Visual recognition", "Risk scanning", "Rule traceability", "Explainable reports"];
  const [market, setMarket] = useState<"eu" | "uk" | "na">("eu");
  const [dialog, setDialog] = useState<"about" | "capabilities" | null>(null);

  useEffect(() => {
    if (!dialog) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDialog(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [dialog]);

  return (
    <div className={styles.page}>
      <div className={styles.ocean} aria-hidden="true">
        <Image
          className={styles.poster}
          src="/complipilot/ocean-poster.png"
          alt=""
          fill
          priority
          sizes="100vw"
        />
        <video
          className={styles.video}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/complipilot/ocean-poster.png"
        >
          <source src="/complipilot/ocean-hero.mp4" type="video/mp4" />
        </video>
      </div>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.navWrap}>
        <nav className={`${styles.topbar} ${styles.liquid}`} aria-label={isZh ? "主导航" : "Primary navigation"}>
          <Link className={styles.brand} href="/" aria-label={isZh ? "规航AI首页" : "CompliPilot home"}>
            <Image src="/complipilot/logo.png" alt={isZh ? "规航AI" : "CompliPilot"} width={32} height={32} priority />
          </Link>
          <div className={styles.navLinks}>
            <a className={`${styles.navTextLink} ${styles.navLinkActive}`} href="#product">
              {isZh ? "产品" : "Product"}
            </a>
            <button
              type="button"
              className={styles.navTextLink}
              aria-haspopup="dialog"
              aria-expanded={dialog === "capabilities"}
              onClick={() => setDialog("capabilities")}
            >
              {isZh ? "能做什么" : "Capabilities"}
            </button>
            <Link className={styles.navTextLink} href="/result/demo">
              {isZh ? "演示流程" : "Demo flow"}
            </Link>
            <Link className={styles.navTextLink} href="/pricing">
              {isZh ? "产品方案" : "Plans"}
            </Link>
            <button
              type="button"
              className={styles.navTextLink}
              aria-haspopup="dialog"
              aria-expanded={dialog === "about"}
              onClick={() => setDialog("about")}
            >
              {isZh ? "关于" : "About"}
            </button>
            <div className={styles.localeSwitch} role="group" aria-label={isZh ? "语言切换" : "Language switcher"}>
              <button type="button" aria-pressed={isZh} className={isZh ? styles.localeActive : undefined} onClick={() => setLocale("zh")}>中</button>
              <button type="button" aria-pressed={!isZh} className={!isZh ? styles.localeActive : undefined} onClick={() => setLocale("en")}>EN</button>
            </div>
            <Link className={`${styles.navCta} ${styles.liquidStrong}`} href="/upload">
              {isZh ? "开始检测" : "Start scan"}
            </Link>
          </div>
        </nav>
      </header>

      {dialog === "capabilities" ? (
        <div
          className={styles.aboutOverlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDialog(null);
            }
          }}
        >
          <section
            className={`${styles.aboutDialog} ${styles.liquidStrong}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="capabilities-title"
          >
            <button
              type="button"
              className={styles.aboutClose}
              onClick={() => setDialog(null)}
              aria-label={isZh ? "关闭能力说明" : "Close capabilities"}
              autoFocus
            >
              <X aria-hidden="true" />
            </button>
            <p className={styles.aboutEyebrow}>CORE CAPABILITIES</p>
            <h2 id="capabilities-title">{isZh ? "上传一张产品图，系统会为你完成这四步" : "Upload one product image. CompliPilot completes four checks."}</h2>
            <p className={styles.aboutLead}>
              {isZh
                ? "从图片里的产品线索出发，系统将目标市场要求转化为可以核对、可以追溯、可以执行的预检结果。"
                : "Starting from visible product evidence, the system turns market requirements into verifiable, traceable, and actionable pre-check results."}
            </p>
            <div className={styles.aboutFacts}>
              <article>
                <FileCheck2 aria-hidden="true" />
                <span><b>{isZh ? "01 识别产品线索" : "01 Read product evidence"}</b><small>{isZh ? "读取外观、铭牌、接口、包装与警示信息" : "Inspect appearance, labels, ports, packaging, and warnings"}</small></span>
              </article>
              <article>
                <Route aria-hidden="true" />
                <span><b>{isZh ? "02 匹配目标市场" : "02 Match target markets"}</b><small>{isZh ? "按欧盟、英国或北美建立适用法规清单" : "Build an applicable rule set for the EU, UK, or North America"}</small></span>
              </article>
              <article>
                <ShieldCheck aria-hidden="true" />
                <span><b>{isZh ? "03 定位风险缺口" : "03 Locate compliance gaps"}</b><small>{isZh ? "标出标签、资料、认证与准入方面的风险" : "Flag labeling, documentation, certification, and market-access risks"}</small></span>
              </article>
              <article>
                <FileCheck2 aria-hidden="true" />
                <span><b>{isZh ? "04 生成行动清单" : "04 Generate an action plan"}</b><small>{isZh ? "输出依据、风险等级、整改建议与下一步路线" : "Deliver evidence, severity, remediation advice, and next steps"}</small></span>
              </article>
            </div>
            <p className={styles.aboutNote}>
              {isZh
                ? "你最终拿到的不是一个简单分数，而是一份可以继续整改、送检和内部沟通的预检报告。"
                : "The result is more than a score: it is a pre-check report your team can use for remediation, testing, and internal review."}
            </p>
            <div className={styles.aboutActions}>
              <button type="button" onClick={() => setDialog(null)}>{isZh ? "返回首页" : "Back to home"}</button>
              <Link href="/upload">{isZh ? "用一张产品图试试" : "Try a product image"}</Link>
            </div>
          </section>
        </div>
      ) : null}

      {dialog === "about" ? (
        <div
          className={styles.aboutOverlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDialog(null);
            }
          }}
        >
          <section
            className={`${styles.aboutDialog} ${styles.liquidStrong}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
          >
            <button
              type="button"
              className={styles.aboutClose}
              onClick={() => setDialog(null)}
              aria-label={isZh ? "关闭关于规航AI" : "Close About CompliPilot"}
              autoFocus
            >
              <X aria-hidden="true" />
            </button>
            <p className={styles.aboutEyebrow}>ABOUT COMPLIPILOT</p>
            <h2 id="about-title">{isZh ? "把合规判断提前到备货和上架之前" : "Move compliance checks before stocking and listing"}</h2>
            <p className={styles.aboutLead}>
              {isZh
                ? "很多出海团队直到送检、备货甚至上架后，才发现标签、资料或认证缺口。规航AI希望把这次检查提前，让产品、运营与合规人员更早看见风险，并围绕同一份依据做决策。"
                : "Many export teams discover labeling, documentation, or certification gaps only after testing, stocking, or listing. CompliPilot moves that check earlier so product, operations, and compliance teams can act on the same evidence."}
            </p>
            <div className={styles.aboutFacts}>
              <article>
                <ShieldCheck aria-hidden="true" />
                <span><b>{isZh ? "服务对象" : "Built for"}</b><small>{isZh ? "跨境品牌、制造商与平台卖家" : "Cross-border brands, manufacturers, and marketplace sellers"}</small></span>
              </article>
              <article>
                <Route aria-hidden="true" />
                <span><b>{isZh ? "产品角色" : "Product role"}</b><small>{isZh ? "送检前的首轮筛查与决策助手" : "First-pass screening and decisions before formal testing"}</small></span>
              </article>
              <article>
                <FileCheck2 aria-hidden="true" />
                <span><b>{isZh ? "设计原则" : "Design principle"}</b><small>{isZh ? "依据可追溯，判断可解释，结果可复核" : "Traceable evidence, explainable decisions, reviewable results"}</small></span>
              </article>
            </div>
            <p className={styles.aboutNote}>
              {isZh
                ? "规航AI不替代实验室检测、认证机构结论或正式法律意见，而是帮助团队更早、更低成本地做好送检准备。"
                : "CompliPilot does not replace laboratory testing, certification decisions, or formal legal advice. It helps teams prepare earlier and at lower cost."}
            </p>
            <div className={styles.aboutActions}>
              <button type="button" onClick={() => setDialog("capabilities")}>{isZh ? "查看能做什么" : "View capabilities"}</button>
              <Link href="/result/demo">{isZh ? "体验合规检测" : "Try compliance scan"}</Link>
            </div>
          </section>
        </div>
      ) : null}

      <main className={styles.main}>
        <section className={styles.hero} id="product" aria-labelledby="hero-title">
          <div className={`${styles.badge} ${styles.liquid} ${styles.reveal}`}>
            <span className={styles.badgeNew}>{isZh ? "全新" : "NEW"}</span>
            <span>{isZh ? "合规航线测试版已开放" : "Compliance Navigator beta is now open"}</span>
          </div>

          <p className={`${styles.kicker} ${styles.reveal}`}>AI COMPLIANCE NAVIGATOR</p>

          <h1 id="hero-title" className={`${styles.title} ${styles.reveal}`}>
            {isZh ? "先合规，" : "Comply first."}<span>{isZh ? "再出海" : "Expand with confidence."}</span>
          </h1>

          <p className={`${styles.lead} ${styles.reveal}`}>
            {isZh
              ? "规航AI是一款面向跨境出海企业的AI合规预检工具。上传产品照片，即可定位目标市场风险，并生成带法规依据和整改建议的可解释报告。"
              : "CompliPilot is an AI compliance pre-check for cross-border teams. Upload product photos to identify target-market risks and generate an explainable report with regulatory evidence and remediation guidance."}
          </p>

          <div className={`${styles.marketSelect} ${styles.liquid} ${styles.reveal}`} aria-label={isZh ? "目标市场" : "Target market"}>
            {markets.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={market === item.id}
                className={market === item.id ? styles.marketActive : styles.marketOption}
                onClick={() => setMarket(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className={`${styles.actions} ${styles.reveal}`}>
            <Link className={`${styles.primary} ${styles.liquid}`} href="/upload">
              {isZh ? "开始合规检测" : "Start compliance scan"}
            </Link>
            {/* Demo entry: jump directly to the prebuilt /result/demo page
                rather than /upload, which previously forced an extra tab. */}
            <Link className={styles.secondary} href="/result/demo">
              {isZh ? "查看 60 秒演示" : "Watch the 60-sec demo"}
            </Link>
          </div>

          <div className={`${styles.stats} ${styles.reveal}`}>
            <article className={`${styles.stat} ${styles.liquid}`}>
              <span>{isZh ? "覆盖市场" : "Markets covered"}</span>
              <strong className={styles.statValue}>
                <span className={styles.statNumber}>42</span>
              </strong>
              <p>{isZh ? "持续更新的法规航线" : "Continuously updated rule routes"}</p>
            </article>
            <article className={`${styles.stat} ${styles.liquid}`}>
              <span>{isZh ? "完整流程" : "Complete workflow"}</span>
              <strong className={styles.statValue}>
                <span className={styles.statNumber}>4</span>
                <span className={styles.statUnit}>{isZh ? "步" : " steps"}</span>
              </strong>
              <p>{isZh ? "从图片到可解释报告" : "From images to explainable reports"}</p>
            </article>
          </div>
        </section>

        <footer className={styles.proof}>
          <span className={`${styles.trustChip} ${styles.liquid}`}>
            {isZh ? "与全球出海团队一起，让合规决策更清晰" : "Clearer compliance decisions for global teams"}
          </span>
          <div className={styles.proofItems}>
            {capabilities.map((item, index) => (
              <span key={item}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                {item}
              </span>
            ))}
          </div>
        </footer>
      </main>
    </div>
  );
}
