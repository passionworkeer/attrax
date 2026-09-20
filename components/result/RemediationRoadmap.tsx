"use client";

import { ArrowUpRight } from "lucide-react";
import type { ScanResult } from "@/lib/types";
import { buildRemediationRoadmap, type RemediationStatus } from "@/lib/result/remediation-roadmap";
import styles from "./review-result.module.css";

const statusLabels: Record<"zh" | "en", Record<RemediationStatus, string>> = {
  zh: { pending: "待处理", "in-progress": "进行中", completed: "已完成" },
  en: { pending: "Pending", "in-progress": "In progress", completed: "Completed" },
};

function findingId(checkId: string) {
  return `finding-${checkId.replace(/[^a-z0-9_-]+/gi, "-")}`;
}

export function RemediationRoadmap({ result, locale, availableCheckIds = [] }: { result: ScanResult; locale: "zh" | "en"; availableCheckIds?: string[] }) {
  const zh = locale === "zh";
  const model = buildRemediationRoadmap(result, locale);
  if (model.rows.length === 0) return null;
  const focus = model.rows[model.focusIndex];
  const linkableChecks = new Set(availableCheckIds);

  const jumpToCheck = (checkId: string) => {
    const target = document.getElementById(findingId(checkId));
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
  };

  return <section className={`${styles.remediationRoadmap} blaze-panel`} aria-labelledby="remediation-roadmap-title">
    <header className={styles.roadmapHeader}>
      <span className={styles.roadmapEyebrow}>ROADMAP</span>
      <h2 id="remediation-roadmap-title">{zh ? "整改路线图" : "Remediation roadmap"}</h2>
      <p>{zh ? "将本次识别出的证据缺口转化为可执行、可交付的整改任务。" : "Turn evidence gaps from this scan into executable, deliverable remediation tasks."}</p>
    </header>

    <dl className={styles.roadmapMetrics}>
      <div><dt>{zh ? "执行阶段" : "Stages"}</dt><dd>{model.rows.length}</dd></div>
      <div><dt>{zh ? "预计周期" : "Estimated timeline"}</dt><dd>{model.totalTime}</dd></div>
      <div><dt>{zh ? "参与角色" : "Roles involved"}</dt><dd>{model.roleCount}</dd></div>
    </dl>

    <div className={styles.roadmapTableWrap}>
      <table className={styles.roadmapTable}>
        <thead><tr><th>{zh ? "阶段 / 任务" : "Stage / task"}</th><th>{zh ? "状态" : "Status"}</th><th>{zh ? "时间" : "Time"}</th><th>{zh ? "成本" : "Cost"}</th><th>{zh ? "负责人" : "Owner"}</th><th>{zh ? "产出与关键资料" : "Deliverable & key materials"}</th></tr></thead>
        <tbody>{model.rows.map((row) => <tr key={row.id}>
          <td data-label={zh ? "阶段 / 任务" : "Stage / task"}><strong>{row.phase}</strong><span>{row.task}</span></td>
          <td data-label={zh ? "状态" : "Status"}><span className={styles.roadmapStatus} data-status={row.status}>{statusLabels[locale][row.status]}</span></td>
          <td data-label={zh ? "时间" : "Time"}>{row.time}</td><td data-label={zh ? "成本" : "Cost"} className={styles.roadmapCost}>{row.cost}</td><td data-label={zh ? "负责人" : "Owner"}>{row.owner}</td><td data-label={zh ? "产出与关键资料" : "Deliverable & key materials"}><span>{row.output}</span>{row.checkId && linkableChecks.has(row.checkId) && <button type="button" className={styles.roadmapJump} onClick={() => jumpToCheck(row.checkId!)}>{zh ? "定位检查" : "Open check"}<ArrowUpRight size={13} aria-hidden="true" /></button>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <aside className={styles.roadmapFocus}>
      <div><span>{zh ? "当前执行重点" : "Current focus"}</span><strong>{String(model.focusIndex + 1).padStart(2, "0")} / {String(model.rows.length).padStart(2, "0")}</strong></div>
      <h3>{focus.task}</h3><p>{focus.output}</p>
      <div className={styles.roadmapFocusMeta}><span>{focus.time}</span><span>{zh ? `成本 ${focus.cost}` : `Cost ${focus.cost}`}</span><span>{focus.owner}</span>{focus.checkId && linkableChecks.has(focus.checkId) && <button type="button" onClick={() => jumpToCheck(focus.checkId!)}>{zh ? "查看对应检查" : "View related check"}<ArrowUpRight size={14} aria-hidden="true" /></button>}</div>
    </aside>
  </section>;
}
