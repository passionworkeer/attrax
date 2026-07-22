"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Truck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { synthesizeFinancialSummaryIfMissing } from "@/lib/pipeline/profit-report";
import {
  buildProfitRenderModel,
  type ProfitMode,
  type ProfitRenderModel,
} from "@/lib/report-export-modules/profit-render-model";
import { downloadProfitModelAsDocx, downloadProfitModelAsPdf } from "@/lib/report-download";
import type { ScanResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 客户端导出按钮组,用于 `/profit/[sessionId]` 的"导出"区。
 *
 * 历史背景: 之前的实现是 `<a href="/api/report/.../profit?format=pdf" download>`,
 * 命中 `app/api/report/[sessionId]/[reportType]/route.ts` 后 spawn python 调
 * `scripts/generate_report_file.py` 生成 PDF/DOCX。但服务器 standalone 容器没有
 * `python` 命令(只有 `python3`),`generate_report_file.py` 在 handoff 设计稿分支
 * 也没 git tracking,这条路必然 500。
 *
 * 现在改成在浏览器端用 `jspdf` / `docx` 生成:导出器接收 `ProfitRenderModel` —
 * 这是 `/profit/[sessionId]/page.tsx` 的字面真值(标题/4 指标卡/链式节点/风险
 * 块/bare caveat/后端 LLM pre 块),所以下载的 PDF/DOCX 与当前用户看到的 UI
 * 字符一一对应(2026-07-21 修复回归)。
 *
 * - "导出成本影响表"按钮: 调 `downloadProfitModelAsPdf/Docx(model, locale)`
 * - "查看完整合规报告"链接: 导航到 `/result/{sessionId}` 复用那里的 client view
 *
 * 数据源依赖: 必须能合成 `FinancialSummary`(要么 `result.financialSummary`,
 * 要么 `result.reportPackage.profitReport.markdown` 经
 * `synthesizeFinancialSummaryIfMissing`)才能导出;否则按钮 disabled,提示用户。
 */
export function ProfitExportPanel({
  result,
  locale,
  profitMode,
  primaryLabel,
  secondaryLabel,
  className,
}: {
  result: ScanResult;
  locale: "zh" | "en";
  profitMode: ProfitMode;
  primaryLabel: string;
  secondaryLabel: string;
  className?: string;
}) {
  const [busy, setBusy] = useState<null | "pdf-zh" | "pdf-en" | "docx-zh" | "docx-en">(null);

  const model = useMemo<ProfitRenderModel | null>(() => {
    const synthesized = synthesizeFinancialSummaryIfMissing(result, locale);
    if (!synthesized) return null;
    // The page only renders the backend LLM section when the summary was
    // synthesized (i.e. didn't already exist). Mirror that here so the PDF
    // matches: only attach the markdown when we synthesized it.
    if (result.financialSummary) {
      // Strip any inherited `_backendMarkdown` so the PDF doesn't show a
      // duplicate LLM block when the user already had a pre-built summary.
      const stripped: typeof synthesized = { ...synthesized };
      delete (stripped as { _backendMarkdown?: string })._backendMarkdown;
      delete (stripped as { __includeBackendMarkdown?: boolean }).__includeBackendMarkdown;
      return buildProfitRenderModel({ result, financialSummary: stripped, profitMode, locale });
    }
    return buildProfitRenderModel({ result, financialSummary: synthesized, profitMode, locale });
  }, [result, locale, profitMode]);

  const handle = async (format: "pdf" | "docx", dlLocale: "zh" | "en") => {
    if (!model) return;
    setBusy(`${format}-${dlLocale}`);
    try {
      if (format === "pdf") {
        await downloadProfitModelAsPdf(model);
      } else {
        await downloadProfitModelAsDocx(model);
      }
    } finally {
      setBusy(null);
    }
  };

  const noDataHint =
    locale === "zh"
      ? "后端未提供利润报告 markdown,无法导出。"
      : "Backend did not return a profit report markdown; export is unavailable.";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handle("pdf", locale)}
          disabled={!model || busy !== null}
          className={cn(
            buttonVariants({ size: "lg" }),
            "flex-1 rounded-full border-0 bg-[linear-gradient(135deg,var(--blaze-orange),var(--blaze-red))] text-white disabled:opacity-50"
          )}
        >
          <Download className="size-4" />
          {primaryLabel} PDF
        </button>
        <button
          type="button"
          onClick={() => handle("docx", locale)}
          disabled={!model || busy !== null}
          className={cn(
            buttonVariants({ variant: "ghost", size: "lg" }),
            "rounded-full border border-white/12 bg-white/6 text-white hover:bg-white/10 disabled:opacity-50"
          )}
        >
          {primaryLabel.replace(/[表Sheet]/g, "").trim()} DOCX
        </button>
      </div>
      <Link
        href={`/result/${result.sessionId}`}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "self-start rounded-full border border-white/12 bg-white/6 text-white/80 hover:bg-white/10"
        )}
      >
        <Truck className="size-4" />
        {secondaryLabel}
      </Link>
      {!model && (
        <p className="text-xs text-white/50">{noDataHint}</p>
      )}
    </div>
  );
}