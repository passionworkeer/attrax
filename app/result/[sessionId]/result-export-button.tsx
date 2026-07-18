"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { buildProfitReportFromScanResult } from "@/lib/pipeline/profit-report";
import {
  downloadProfitReportAsDocx,
  downloadProfitReportAsPdf,
} from "@/lib/report-download";
import type { ScanResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * handoff 设计稿 `/result/[sessionId]` 导出区按钮。
 *
 * 历史背景: 原本是 `<a href="/api/report/.../?format=pdf|docx" download>`,
 * API route 在服务器上 spawn `python` 调 `scripts/generate_report_file.py`,
 * 但 standalone 容器没 `python` 命令且 handoff 分支也没跟踪那个脚本,
 * 结果 500。
 *
 * 现在:
 * - `md` / `csv` → 走 `/api/report/...?format=md|csv`(API 文本分支本来就 200)
 * - `pdf` / `docx` + `profit` → 客户端用 jspdf / docx 生成
 * - `pdf` / `docx` + `compliance` → 跳转到 `/result/{sessionId}` 内的 client view
 *   (那里 ComplianceReportView 已经在用 downloadReportAsPdf/Docx,工作良好)
 * - `pdf` / `docx` + `roadmap` → 暂无 client 适配,按钮 disabled + tooltip 提示
 */
export function ResultExportButton({
  result,
  reportType,
  format,
  locale,
}: {
  result: ScanResult;
  reportType: "compliance" | "roadmap" | "profit";
  format: "pdf" | "docx" | "md" | "csv";
  locale: "zh" | "en";
}) {
  const [busy, setBusy] = useState(false);

  // 文本格式直接走 API 路径(本来就 200)
  if (format === "md" || format === "csv") {
    return (
      <a
        href={`/api/report/${result.sessionId}/${reportType}?format=${format}&lang=${locale}`}
        download
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "rounded-full border border-white/10 bg-white/7 text-white hover:bg-white/12"
        )}
      >
        {format.toUpperCase()}
      </a>
    );
  }

  // PDF / DOCX — compliance 跳到页内 client view,profit 客户端生成,roadmap disabled
  if (reportType === "compliance") {
    return (
      <a
        href={`/result/${result.sessionId}#compliance-report`}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "rounded-full border border-white/10 bg-white/7 text-white hover:bg-white/12"
        )}
      >
        {format.toUpperCase()}
      </a>
    );
  }

  const onClick = async () => {
    if (reportType !== "profit") return;
    setBusy(true);
    try {
      const exportable = buildProfitReportFromScanResult(result, locale);
      if (!exportable) return;
      if (format === "pdf") {
        await downloadProfitReportAsPdf(exportable, locale);
      } else {
        await downloadProfitReportAsDocx(exportable, locale);
      }
    } finally {
      setBusy(false);
    }
  };

  const noClientExport = reportType === "roadmap";
  const profitNoData =
    reportType === "profit" && !buildProfitReportFromScanResult(result, locale);

  const disabled = noClientExport || profitNoData || busy;

  const tooltip =
    noClientExport
      ? locale === "zh"
        ? "路线图暂不支持 PDF/Word 导出,请使用 CSV"
        : "Roadmap PDF/Word export is not yet supported; use CSV."
      : profitNoData
        ? locale === "zh"
          ? "缺少利润报告 markdown,无法导出"
          : "Missing profit report markdown; export is unavailable."
        : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "rounded-full border border-white/10 bg-white/7 text-white hover:bg-white/12 disabled:opacity-50"
      )}
    >
      {format.toUpperCase()}
    </button>
  );
}