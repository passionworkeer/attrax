"use client";

import { SectionEyebrow } from "@/components/blaze-hawks/ui";
import {
  CompliPilotFlowBackdrop,
  CompliPilotFlowHeader,
} from "@/components/complipilot/flow-shell";

import { DegradedBanner } from "@/components/result/DegradedBanner";
import brightFlow from "@/components/complipilot/bright-flow.module.css";
import type { ScanResult } from "@/lib/types";

/**
 * Result 页非成功态面板（2026-09-10 自 page.tsx 抽出，审计 2.5）：
 * Loading 面板与「后端未返回可展示风险」面板。JSX 与原实现一致。
 */

interface CommonProps {
  locale: "zh" | "en";
  displayMessage: string;
  degradedReason?: string | null;
}

export function ResultLoadingPanel({ locale, displayMessage, failed = false, onRetry }: CommonProps & { failed?: boolean; onRetry?: () => void }) {
return (
      <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
        <CompliPilotFlowBackdrop tone="bright" />
        <div className="relative z-10">
          <CompliPilotFlowHeader
            backHref="/upload"
            backLabel={locale === "zh" ? "返回上传页" : "Back to upload"}
            flowTitle={locale === "zh" ? "合规检测结果" : "Compliance Result"}
            flowSubtitle={locale === "zh" ? "风险总览 · 法规依据 · 整改建议" : "Risks · citations · remediation"}
            primaryHref="/upload"
            primaryLabel={locale === "zh" ? "重新检测" : "Scan again"}
            statusLabel={failed ? (locale === "zh" ? "加载失败" : "Unable to load") : (locale === "zh" ? "加载中" : "Loading")}
            tone="bright"
          />
          <section className="mx-auto w-full max-w-5xl px-6 pt-8">
            <div className="blaze-panel p-8">
              <SectionEyebrow>Result</SectionEyebrow>
              <h1 className="mt-3 text-3xl font-semibold text-white">{failed ? (locale === "zh" ? "暂时无法显示结果" : "Unable to display this result") : (locale === "zh" ? "加载结果中" : "Loading result")}</h1>
              <p role={failed ? "alert" : "status"} className="mt-4 text-sm leading-7 text-white/60">{displayMessage}</p>
              {failed && <div className="mt-6 flex flex-wrap gap-3">
                <button data-retry-result type="button" onClick={onRetry} className="rounded-xl bg-[#086b83] px-5 py-3 font-semibold text-white" style={{ color: "white" }}>{locale === "zh" ? "重新加载结果" : "Retry loading"}</button>
                <a href="/upload" className="rounded-xl border border-[#8ab8c8] px-5 py-3 font-semibold text-[#073b54]">{locale === "zh" ? "返回上传页" : "Back to upload"}</a>
              </div>}
            </div>
          </section>
        </div>
      </main>
    );
}

export function ResultIncompletePanel({
  locale,
  displayMessage,
  degradedReason,
  result,
}: CommonProps & { result: ScanResult }) {
return (
      <main className={`${brightFlow.page} complipilot-flow blaze-flow blaze-experience min-h-screen overflow-x-hidden pb-16`}>
        <CompliPilotFlowBackdrop tone="bright" />
        <div className="relative z-10">
          <CompliPilotFlowHeader
            backHref="/upload"
            backLabel={locale === "zh" ? "返回上传页" : "Back to upload"}
            flowTitle={locale === "zh" ? "合规检测结果" : "Compliance Result"}
            flowSubtitle={locale === "zh" ? "检查结果 · 待补充资料" : "Inspection result · more information needed"}
            primaryHref="/upload"
            primaryLabel={locale === "zh" ? "重新检测" : "Scan again"}
            statusLabel={result.source === "fallback" ? "DEGRADED" : "INCOMPLETE"}
            tone="bright"
          />
          <section className="mx-auto w-full max-w-5xl px-6 pt-8">
            <DegradedBanner
              source={result.source}
              degradedReason={degradedReason ?? undefined}
            />
            <div className="blaze-panel p-8">
              <SectionEyebrow>{result.source === "fallback" ? "Degraded" : "Incomplete"}</SectionEyebrow>
              <h1 className="mt-3 text-3xl font-semibold text-white">
                {locale === "zh" ? "后端未返回可展示的风险证据" : "No displayable risk evidence was returned"}
              </h1>
              {displayMessage && <p role="status" className="mt-4 text-sm leading-7 text-white/80">{displayMessage}</p>}
              <p className="mt-4 text-sm leading-7 text-white/60">
                {locale === "zh"
                  ? "本次资料未形成可展示的检查结果。请补充清晰的铭牌、包装照片或产品说明书后重新检测；若仍无结果，请稍后重试。"
                  : "This scan did not produce a displayable assessment. Add clear label or packaging photos, or a product document, then scan again. If the problem persists, try again later."}
              </p>
            </div>
          </section>
        </div>
      </main>
    );
}
