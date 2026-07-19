"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { buildProfitReportFromScanResult } from "@/lib/pipeline/profit-report";
import {
  downloadProfitReportAsDocx,
  downloadProfitReportAsPdf,
  downloadRoadmapReportAsDocx,
  downloadRoadmapReportAsPdf,
} from "@/lib/report-download";
import type { RoadmapContent } from "@/lib/report-export-modules/roadmap";
import { getDefaultRoadmapItems } from "@/lib/mock/roadmap";
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
 * 现在(mid-2026-07 改进):
 * - `md` / `csv` → 走 `/api/report/...?format=md|csv`(API 文本分支本来就 200)
 * - `pdf` / `docx` + `compliance` → 跳转到 `/result/{sessionId}` 内的
 *   `#compliance-report` section,那里 `<ComplianceReportView>` 已经挂好
 *   `downloadReportAsPdf` / `downloadReportAsDocx`
 * - `pdf` / `docx` + `profit` → 客户端用 jspdf / docx 生成
 *   (通过 `buildProfitReportFromScanResult` 把 `ScanResult` 适配为
 *   `ProfitReportResult`,走 `ELECTRONICS_FINANCIAL.costBreakdown` 兜底)
 * - `pdf` / `docx` + `roadmap` → 客户端 `downloadRoadmapReportAsPdf/Docx`
 *   `RoadmapContent` 直接由 `getDefaultRoadmapItems()` 提供(demo 默认
 *   7 阶段,真扫描用 `result.reportPackage.roadmap.items`,前置未上传时
 *   兜底)
 */

function buildRoadmapContent(result: ScanResult, locale: "zh" | "en"): RoadmapContent {
  // 真扫描结果在 `result.reportPackage.roadmap.items` 已经有完整数据;
  // demo / 非 reportPackage 路径用 `lib/mock/roadmap.getDefaultRoadmapItems()` 兜底
  const fromPackage = result.reportPackage?.roadmap?.items?.length
    ? result.reportPackage.roadmap.items.map((item) => ({
        title: item.title ?? item.titleEn ?? "",
        titleEn: item.titleEn ?? item.title_en,
        description: item.description,
        descriptionEn: item.descriptionEn ?? item.description_en,
        cost: item.cost,
        days: item.estimatedDays ?? item.estimated_days,
        status: item.status,
        documents: item.documents,
        documentsEn: item.documentsEn ?? item.documents_en,
      }))
    : null;

  const items =
    fromPackage ??
    getDefaultRoadmapItems().map((item) => ({
      title: locale === "en" ? item.titleEn : item.title,
      titleEn: item.titleEn,
      description: locale === "en" ? item.descriptionEn : item.description,
      descriptionEn: item.descriptionEn,
      cost: item.cost,
      days: item.estimatedDays,
      status: item.status,
      documents: item.documents,
      documentsEn: item.documentsEn,
    }));

  return {
    sessionId: result.sessionId,
    currentStatus: result.reportPackage?.auditMetadata?.validationStatus,
    currentStatusEn: result.reportPackage?.auditMetadata?.validationStatus,
    totalDays: result.reportPackage?.roadmap?.totalDays,
    totalCost: result.reportPackage?.roadmap?.totalCost,
    progress: result.reportPackage?.roadmap?.progress,
    items,
  };
}

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

  // PDF / DOCX — compliance 跳到页内 client view
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
    setBusy(true);
    try {
      if (reportType === "profit") {
        const exportable = buildProfitReportFromScanResult(result, locale);
        if (!exportable) return;
        if (format === "pdf") {
          await downloadProfitReportAsPdf(exportable, locale);
        } else {
          await downloadProfitReportAsDocx(exportable, locale);
        }
        return;
      }
      if (reportType === "roadmap") {
        const content = buildRoadmapContent(result, locale);
        if (format === "pdf") {
          await downloadRoadmapReportAsPdf(content, locale);
        } else {
          await downloadRoadmapReportAsDocx(content, locale);
        }
        return;
      }
    } finally {
      setBusy(false);
    }
  };

  const profitNoData =
    reportType === "profit" && !buildProfitReportFromScanResult(result, locale);

  const disabled = profitNoData || busy;

  const tooltip = profitNoData
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