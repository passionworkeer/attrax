import { NextResponse } from "next/server";
import { getResultForReport, getTextReportPayload, localizeResult, type BlazeExportFormat, type BlazeReportLocale, type BlazeReportType } from "@/lib/reporting";
import { backendAccessTokenFromRequest } from "@/app/api/backend-session-access";
import { getScan, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { normalizeV1ScanResult } from "@/lib/rag-client/v1-result-adapter";

const validTypes: BlazeReportType[] = ["compliance", "roadmap", "profit"];
const validFormats: BlazeExportFormat[] = ["md", "csv", "pdf", "docx"];

export const runtime = "nodejs";

/**
 * GET /api/report/[sessionId]/[reportType]?format=...&lang=...
 *
 * 历史: 这个路由原本用 `execFile(python, ["scripts/generate_report_file.py", ...])`
 * spawn 子进程生成 PDF/DOCX。但 standalone 容器里没有 `python` 命令(只有
 * `python3`),`scripts/generate_report_file.py` 在 handoff 设计稿分支也没
 * git tracking,这条路必然 500。
 *
 * 现在: 这个路由只保留 `md` / `csv` 文本导出。PDF/DOCX 改由 UI 在浏览器端
 * 用 jspdf / docx 生成(走 `lib/report-download.ts` 的 dynamic import),
 * 不再依赖 server 端 python 环境。请求 PDF/DOCX 时返回 400 + 清晰错误码。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string; reportType: string }> }
) {
  const { sessionId, reportType } = await context.params;
  const searchParams = new URL(request.url).searchParams;
  const requestedFormat = searchParams.get("format") as BlazeExportFormat | null;
  const locale = (searchParams.get("lang") === "en" ? "en" : "zh") as BlazeReportLocale;

  if (!validTypes.includes(reportType as BlazeReportType)) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REPORT_TYPE",
          message: "不支持的报告类型。",
        },
      },
      { status: 400 }
    );
  }

  let result = sessionId === "demo" ? getResultForReport(sessionId, undefined, { preset: searchParams.get("preset") }) : null;
  if (sessionId !== "demo") {
    const accessToken = backendAccessTokenFromRequest(request, sessionId);
    if (!accessToken) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Missing access token" } },
        { status: 401 },
      );
    }
    try {
      const upstream = await getScan({ sessionId, accessToken });
      if (upstream.status === "processing") {
        return NextResponse.json(
          { error: { code: "NOT_READY", message: "Scan result is not ready" } },
          { status: 409 },
        );
      }
      result = normalizeV1ScanResult(upstream) ?? null;
    } catch (error) {
      if (error instanceof V1EnvelopeError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.httpStatus },
        );
      }
      return NextResponse.json(
        { error: { code: "SCAN_SERVICE_UNAVAILABLE", message: "Scan service unavailable" } },
        { status: 502 },
      );
    }
  }
  if (!result) {
    return NextResponse.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "未找到对应扫描结果，无法生成报告。",
        },
      },
      { status: 404 }
    );
  }

  const normalizedType = reportType as BlazeReportType;
  const format = requestedFormat ?? "md";
  const localizedResult = localizeResult(result, locale);

  if (!validFormats.includes(format)) {
    return NextResponse.json(
      {
        error: {
          code: "BAD_REPORT_FORMAT",
          message: "不支持的导出格式。",
        },
      },
      { status: 400 }
    );
  }

  if (format !== "md" && format !== "csv") {
    return NextResponse.json(
      {
        error: {
          code: "BINARY_EXPORT_REMOVED",
          message:
            "PDF/DOCX 导出已改为浏览器端生成,请在页面上点击下载按钮。" +
            "API 路由仅保留 md/csv 文本导出。",
        },
      },
      { status: 400 }
    );
  }

  const payload = getTextReportPayload(normalizedType, localizedResult, format, locale);

  return new NextResponse(payload.body, {
    headers: {
      "Content-Type": payload.contentType,
      "Content-Disposition": `attachment; filename="${payload.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}