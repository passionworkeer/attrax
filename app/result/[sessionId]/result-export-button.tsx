"use client";
import { PROFIT_FEATURE_ENABLED } from "@/lib/product-scope";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { synthesizeFinancialSummaryIfMissing } from "@/lib/pipeline/profit-report";
import { buildProfitRenderModel } from "@/lib/report-export-modules/profit-render-model";
import {
  downloadProfitModelAsDocx,
  downloadProfitModelAsPdf,
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
 * - `pdf` / `docx` + `roadmap` → 客户端 `downloadRoadmapReportAsPdf/Docx`。
 *   真实会话必须有后端路线图；只有明确 demo 会话能使用示例阶段。
 */

function buildRoadmapContent(result: ScanResult, locale: "zh" | "en"): RoadmapContent | null {
  const isDemo = result.sessionId === "demo" || result.source === "demo";
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

  const items = fromPackage ?? (isDemo
    ? getDefaultRoadmapItems().map((item) => ({
      title: locale === "en" ? item.titleEn : item.title,
      titleEn: item.titleEn,
      description: locale === "en" ? item.descriptionEn : item.description,
      descriptionEn: item.descriptionEn,
      cost: item.cost,
      days: item.estimatedDays,
      status: item.status,
      documents: item.documents,
      documentsEn: item.documentsEn,
    }))
    : null);

  if (!items) return null;

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
  presetKey,
}: {
  result: ScanResult;
  reportType: "compliance" | "roadmap" | "profit";
  format: "pdf" | "docx" | "md" | "csv";
  locale: "zh" | "en";
  // Mid-2026-07:`?preset=charger|humidifier|toy` 让 /api/report/demo/... 切到
  // 不同 scenario(避免 demo 页面按钮永远下载 65W 充电器的报告)。
  presetKey?: "charger" | "humidifier" | "toy";
}) {
  const [busy, setBusy] = useState(false);
  if (reportType === "profit" && !PROFIT_FEATURE_ENABLED) return null;
  const presetQuery = presetKey ? `&preset=${presetKey}` : "";
  const roadmapNoData =
    reportType === "roadmap" &&
    result.sessionId !== "demo" &&
    result.source !== "demo" &&
    !result.reportPackage?.roadmap?.items?.length;
  const financeInvalid =
    result.reportPackage?.auditMetadata?.finance?.validationStatus === "invalid" ||
    result.reportPackage?.auditMetadata?.finance?.validation_status === "invalid";
  const profitNoData =
    reportType === "profit" && (financeInvalid || !synthesizeFinancialSummaryIfMissing(result, locale));

  if ((format === "md" || format === "csv") && (roadmapNoData || profitNoData)) {
    const unavailable = roadmapNoData
      ? locale === "zh" ? "缺少真实路线图，无法导出" : "Missing real roadmap; export is unavailable."
      : locale === "zh" ? "利润数据不可用，无法导出" : "Profit data is unavailable; export is unavailable.";
    return (
      <button type="button" disabled title={unavailable} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-full border border-white/10 bg-white/7 text-white disabled:opacity-50")}>
        {format.toUpperCase()}
      </button>
    );
  }

  // 文本格式直接走 API 路径(本来就 200)
  if (format === "md" || format === "csv") {
    return (
      <a
        href={`/api/report/${result.sessionId}/${reportType}?format=${format}&lang=${locale}${presetQuery}`}
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
        const summary = synthesizeFinancialSummaryIfMissing(result, locale);
        if (!summary) return;
        const model = buildProfitRenderModel({ result, financialSummary: summary, profitMode: "compliant", locale });
        if (format === "pdf") {
          await downloadProfitModelAsPdf(model);
        } else {
          await downloadProfitModelAsDocx(model);
        }
        return;
      }
      if (reportType === "roadmap") {
        const content = buildRoadmapContent(result, locale);
        if (!content) return;
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

  const disabled = profitNoData || roadmapNoData || busy;

  const tooltip = roadmapNoData
    ? locale === "zh"
      ? "缺少真实路线图，无法导出"
      : "Missing real roadmap; export is unavailable."
    : profitNoData
    ? locale === "zh"
      ? "利润数据不可用，无法导出"
      : "Profit data is unavailable; export is unavailable."
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
