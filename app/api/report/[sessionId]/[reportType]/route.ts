import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  getBinaryFilename,
  getDefaultFormat,
  getResultForReport,
  localizeResult,
  getTextReportPayload,
  type BlazeExportFormat,
  type BlazeReportLocale,
  type BlazeReportType,
} from "@/lib/reporting";
import { backendAccessTokenFromRequest } from "@/app/api/backend-session-access";
import { getScan, V1EnvelopeError } from "@/lib/rag-client/v1-adapter";
import { normalizeV1ScanResult } from "@/lib/rag-client/v1-result-adapter";

const validTypes: BlazeReportType[] = ["compliance", "roadmap", "profit"];
const validFormats: BlazeExportFormat[] = ["md", "csv", "pdf", "docx"];
const execFileAsync = promisify(execFile);
const pythonCandidates = [
  process.env.BLAZE_REPORT_PYTHON,
  "python",
].filter(Boolean) as string[];

export const runtime = "nodejs";

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

  let result = sessionId === "demo" ? getResultForReport(sessionId) : null;
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
        { error: { code: "RAG_SERVICE_UNAVAILABLE", message: "RAG service unavailable" } },
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
  const format = requestedFormat ?? getDefaultFormat(normalizedType);
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

  if (format === "md" || format === "csv") {
    const payload = getTextReportPayload(normalizedType, localizedResult, format, locale);

    return new NextResponse(payload.body, {
      headers: {
        "Content-Type": payload.contentType,
        "Content-Disposition": `attachment; filename="${payload.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "blaze-report-"));
  const inputPath = path.join(tmpDir, "payload.json");
  const outputPath = path.join(
    tmpDir,
    getBinaryFilename(normalizedType, result, format)
  );
  const scriptPath = path.join(process.cwd(), "scripts", "generate_report_file.py");

  try {
    await writeFile(
      inputPath,
      JSON.stringify({
        reportType: normalizedType,
        format,
        locale,
        result: localizedResult,
      }),
      "utf-8"
    );

    let lastError: unknown = null;
    for (const pythonExecutable of pythonCandidates) {
      try {
        await execFileAsync(pythonExecutable, [
          scriptPath,
          inputPath,
          outputPath,
          normalizedType,
          format,
        ]);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    const fileBytes = await readFile(outputPath);
    const contentType =
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const filename = getBinaryFilename(normalizedType, localizedResult, format);

    return new NextResponse(fileBytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
