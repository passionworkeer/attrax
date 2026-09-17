"use client";

import { useEffect, useState, type ReactNode } from "react";
import styles from "./result-workspace.module.css";

export function sectionForHash(hash: string) {
  if (["#evidence"].includes(hash)) return "evidence";
  if (["#reports", "#compliance-report", "#report-previews", "#supplement-evidence", "#action", "#profit-impact"].includes(hash)) return "report";
  return "actions";
}

export function ResultWorkspace({ locale, actions, evidence, report }: {
  locale: "zh" | "en"; actions: ReactNode; evidence: ReactNode; report: ReactNode;
}) {
  const [active, setActive] = useState("actions");
  useEffect(() => {
    const sync = () => {
      setActive(sectionForHash(window.location.hash));
      requestAnimationFrame(() => {
        const id = window.location.hash.slice(1);
        const target = id && document.getElementById(id);
        if (target) {
          let parent: HTMLElement | null = target;
          while (parent) {
            if (parent instanceof HTMLDetailsElement) parent.open = true;
            parent = parent.parentElement;
          }
          target.scrollIntoView({ block: "start" });
        }
      });
    };
    sync();
    const repeatAnchor = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (anchor?.getAttribute("href") === window.location.hash) sync();
    };
    window.addEventListener("hashchange", sync);
    document.addEventListener("click", repeatAnchor);
    return () => { window.removeEventListener("hashchange", sync); document.removeEventListener("click", repeatAnchor); };
  }, []);
  const tabs = [
    { id: "actions", label: locale === "zh" ? "审核清单" : "Review checklist", content: actions },
    { id: "evidence", label: locale === "zh" ? "证据核对" : "Evidence review", content: evidence },
    { id: "report", label: locale === "zh" ? "报告与处置" : "Report & actions", content: report },
  ];
  return <div className={styles.workspace}>
    <div className={styles.tabs} role="tablist" aria-label={locale === "zh" ? "结果分类" : "Result sections"}>
      {tabs.map((tab, index) => <button key={tab.id} id={`tab-${tab.id}`} type="button" role="tab"
        aria-selected={active === tab.id} aria-controls={`panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1}
        onClick={() => setActive(tab.id)} onKeyDown={(event) => {
          const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
          if (next !== null) { event.preventDefault(); setActive(tabs[next].id); document.getElementById(`tab-${tabs[next].id}`)?.focus(); }
        }}>{tab.label}</button>)}
    </div>
    {tabs.map(tab => <div key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} hidden={active !== tab.id} className={styles.panel}>{tab.content}</div>)}
  </div>;
}
