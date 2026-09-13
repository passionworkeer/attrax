"use client";

import Image from "next/image";
import Link from "next/link";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import styles from "./homepage.module.css";

export function CompliPilotHome() {
  const { locale, setLocale } = useBlazeLocale();
  const isZh = locale === "zh";
  const capabilities = isZh
    ? ["图像识别", "风险扫描", "法规溯源", "可解释报告"]
    : ["Visual recognition", "Risk scanning", "Rule traceability", "Explainable reports"];

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
            <Link className={styles.navTextLink} href="/upload">
              {isZh ? "开始扫描" : "Start scan"}
            </Link>
            <Link className={styles.navTextLink} href="/result/demo">
              {isZh ? "演示流程" : "Demo flow"}
            </Link>
            <Link className={styles.navTextLink} href="/pricing">
              {isZh ? "产品方案" : "Plans"}
            </Link>
            <Link className={styles.navTextLink} href="/regulations">
              {isZh ? "法规更新" : "Regulation updates"}
            </Link>
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
