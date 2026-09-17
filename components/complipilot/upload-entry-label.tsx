"use client";
import { useLinkStatus } from "next/link";
import styles from "./homepage.module.css";
export function UploadEntryLabel({ label, isZh }: { label: string; isZh: boolean }) {
  const { pending } = useLinkStatus();
  return <span className={styles.entryLabel} aria-live="polite" aria-busy={pending}>
    {pending && <span className={styles.entrySpinner} aria-hidden="true" />}
    {pending ? (isZh ? "正在打开…" : "Opening…") : label}
  </span>;
}
