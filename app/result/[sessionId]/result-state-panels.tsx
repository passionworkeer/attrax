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

export function ResultLoadingPanel({ locale, displayMessage }: CommonProps) {
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
            statusLabel={locale === "zh" ? "加载中" : "Loading"}
            tone="bright"
          />
          <section className="mx-auto w-full max-w-5xl px-6 pt-8">
            <div className="blaze-panel p-8">
              <SectionEyebrow>Result</SectionEyebrow>
              <h1 className="mt-3 text-3xl font-semibold text-white">{locale === "zh" ? "加载结果中" : "Loading result"}</h1>
              <p className="mt-4 text-sm leading-7 text-white/60">{displayMessage}</p>
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
            flowSubtitle={locale === "zh" ? "真实后端结果 · 未伪造风险项" : "Backend result · no synthetic risks"}
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
              <p className="mt-4 text-sm leading-7 text-white/60">
                {locale === "zh"
                  ? "页面不会用 Mock 数据替换真实结果。请检查检索库、模型响应和报告包中的 decisionView。"
                  : "The page will not replace this response with mock data. Check retrieval, model output, and reportPackage.decisionView."}
              </p>
            </div>
          </section>
        </div>
      </main>
    );
}
