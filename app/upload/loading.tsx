"use client";
import { useBlazeLocale } from "@/components/blaze-hawks/locale";
import { useEffect, useState } from "react";
import styles from "./upload.module.css";

export default function Loading() {
  const { locale } = useBlazeLocale();
  const [show, setShow] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setShow(true), 180); return () => clearTimeout(timer); }, []);
  return <main className={`${styles.page} complipilot-flow blaze-experience min-h-screen`} aria-busy="true">
    <div className={styles.loadingShell} style={{ visibility: show ? "visible" : "hidden" }}>
      <div className={styles.loadingHeader} aria-hidden="true" />
      <div className={styles.loadingColumns}>
        <section className="blaze-panel p-5 sm:p-7">
          <p className={styles.loadingStatus} role="status">{locale === "zh" ? "正在准备产品上传…" : "Preparing your product upload…"}</p>
          <div className={styles.loadingTitle} aria-hidden="true" />
          <div className={styles.loadingDropzone} aria-hidden="true" />
          <div className={styles.loadingSlots} aria-hidden="true"><span /><span /><span /></div>
        </section>
        <aside className={styles.loadingAside} aria-hidden="true">
          <div className="blaze-panel p-5"><div className={styles.loadingTitle} /><div className={styles.loadingSlots}><span /><span /><span /></div></div>
          <div className="blaze-panel p-5"><div className={styles.loadingTitle} /><div className={styles.loadingDropzone} /></div>
        </aside>
      </div>
    </div>
  </main>;
}
