"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, Truck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { buildProfitReportFromScanResult } from "@/lib/pipeline/profit-report";
import { downloadProfitReportAsDocx, downloadProfitReportAsPdf } from "@/lib/report-download";
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
 * 现在改成在浏览器端用 `jspdf` / `docx` 生成:
 * - "导出利润"按钮: 调 `downloadProfitReportAsPdf/Docx`,需要先从 ScanResult
 *   反推一个完整 `ProfitReportResult`(`buildProfitReportFromMarkdown` 已经实现)
 * - "查看完整合规报告"链接: 导航到 `/result/{sessionId}` 复用那里的 client view
 *
 * 数据源依赖: 必须有 `result.reportPackage.profitReport.markdown` 才能导出
 * 利润报告;否则按钮 disabled,提示用户。
 */
export function ProfitExportPanel({
  result,
  locale,
  primaryLabel,
  secondaryLabel,
  className,
}: {
  result: ScanResult;
  locale: "zh" | "en";
  primaryLabel: string;
  secondaryLabel: string;
  className?: string;
}) {
  const [busy, setBusy] = useState<null | "pdf-zh" | "pdf-en" | "docx-zh" | "docx-en">(null);

  const exportable = buildProfitReportFromScanResult(result, locale);

  const handle = async (format: "pdf" | "docx", dlLocale: "zh" | "en") => {
    if (!exportable) return;
    setBusy(`${format}-${dlLocale}`);
    try {
      if (format === "pdf") {
        await downloadProfitReportAsPdf(exportable, dlLocale);
      } else {
        await downloadProfitReportAsDocx(exportable, dlLocale);
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
          disabled={!exportable || busy !== null}
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
          disabled={!exportable || busy !== null}
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
      {!exportable && (
        <p className="text-xs text-white/50">{noDataHint}</p>
      )}
    </div>
  );
}