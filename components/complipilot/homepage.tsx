"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { MARKET_IDS } from "@/lib/types";
import styles from "./homepage.module.css";
import { UploadEntryLabel } from "./upload-entry-label";

export function CompliPilotHome({ initialLocale }: { initialLocale?: "zh" | "en" } = {}) {
  const { locale: contextLocale, setLocale } = useBlazeLocale();
  const locale = initialLocale ?? contextLocale;
  const isZh = locale === "zh";

  useEffect(() => {
    if (initialLocale && initialLocale !== contextLocale) {
      setLocale(initialLocale);
    }
  }, [initialLocale, contextLocale, setLocale]);

  const capabilities = isZh
    ? ["图像识别", "风险扫描", "法规溯源", "可解释报告"]
    : ["Visual recognition", "Risk scanning", "Rule traceability", "Explainable reports"];
  // J18: 市场数量从 lib/types 的 MARKET_IDS 计算（与上传页/后端 allow-list
  // 同源），不再写死营销数字（旧值「42」远超实际支持的 16 个市场）。
  const supportedMarketCount = MARKET_IDS.length;

  return (
    <div className={styles.page}>
      <header className={styles.navWrap}>
        <nav className={`${styles.topbar} ${styles.liquid}`} aria-label={isZh ? "主导航" : "Primary navigation"}>
          <Link className={styles.brand} href="/" aria-label={isZh ? "规航AI首页" : "CompliPilot home"}>
            <Image src="/complipilot/logo.png" alt={isZh ? "规航AI" : "CompliPilot"} width={32} height={32} priority />
          </Link>
          <div className={styles.navLinks}>
            <Link className={styles.navTextLink} href="/pricing">
              {isZh ? "产品方案" : "Plans"}
            </Link>
            <Link className={styles.navTextLink} href="/regulations">
              {isZh ? "法规资料" : "Regulation resources"}
            </Link>
            <Link className={styles.navTextLink} href="/admin">
              {isZh ? "管理后台" : "Admin"}
            </Link>
            <div className={styles.localeSwitch} role="group" aria-label={isZh ? "语言切换" : "Language switcher"}>
              <button type="button" aria-pressed={isZh} className={isZh ? styles.localeActive : undefined} onClick={() => setLocale("zh")}>中</button>
              <button type="button" aria-pressed={!isZh} className={!isZh ? styles.localeActive : undefined} onClick={() => setLocale("en")}>EN</button>
            </div>
            <Link className={`${styles.navCta} ${styles.liquidStrong}`} href="/upload">
              <UploadEntryLabel isZh={isZh} label={isZh ? "开始检测" : "Start scan"} />
            </Link>
          </div>
        </nav>
      </header>

      <main className={styles.main}>
        <section className={styles.hero} id="product" aria-labelledby="hero-title">
          <div className={`${styles.badge} ${styles.liquid} ${styles.reveal}`}>
            <span className={styles.badgeNew}>{isZh ? "全新" : "NEW"}</span>
            <span>{isZh ? "产品合规预检 · 让出海更有把握" : "Product compliance pre-check for global markets"}</span>
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
            <Link className={styles.primary} href="/upload">
              <UploadEntryLabel isZh={isZh} label={isZh ? "开始合规检测" : "Start compliance scan"} />
            </Link>
          </div>

          <div className={`${styles.stats} ${styles.reveal}`}>
            {/* Keep the coverage count aligned with the upload market options. */}
            <article className={`${styles.stat} ${styles.liquid}`}>
              <span>{isZh ? "支持扫描市场" : "Scannable markets"}</span>
              <strong className={styles.statValue}>
                <span className={styles.statNumber}>{supportedMarketCount}</span>
              </strong>
              <p>
                {isZh
                  ? "支持欧盟、美国、日本等重点市场"
                  : "Supporting key markets including the EU, US and Japan"}
              </p>
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
