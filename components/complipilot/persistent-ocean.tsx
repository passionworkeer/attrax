"use client";

import { usePathname } from "next/navigation";
import styles from "./persistent-ocean.module.css";

/** Root-layout ownership preserves the video element across home/upload navigation. */
export function PersistentOcean({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const visible = pathname === "/" || pathname === "/upload" || pathname === "/regulations";
  return <div className={styles.shell}>
    {visible && <div className={styles.ocean} aria-hidden="true">
      <video className={styles.video} src="/complipilot/ocean-hero.mp4"
        poster="/complipilot/ocean-poster.png" autoPlay muted loop playsInline preload="auto" />
      <div className={styles.tint} />
    </div>}
    {children}
  </div>;
}
