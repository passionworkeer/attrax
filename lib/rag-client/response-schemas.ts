/**
 * lib/rag-client/response-schemas.ts
 *
 * Zod schemas that mirror the FastAPI /scan-multipart and /profit-report
 * response shapes. Source of truth for the contract is
 * `lib/rag-client/openapi.snapshot.json` (generated from
 * `rag_service/main.py`).
 *
 * `ScanResponseSchema.report_package` is intentionally `z.unknown()` —
 * the structured ReportPackage is consumed via `normalizeReportPackage`
 * (lib/pipeline/report-package.ts), which has its own tolerant snake↔camel
 * normalization for legacy backends.
 */
import { z } from "zod";

export const ScanResponseSchema = z.object({
  status: z.enum(["PASS", "WARN", "REJECTED", "UNKNOWN"]),
  report: z.string(),
  agent_trace: z.array(z.record(z.string(), z.unknown())),
  loop_count: z.number(),
  documents: z
    .array(
      z
        .object({
          id: z.string(),
          doc_name: z.string().nullish(),
          article_no: z.string().nullish(),
          region: z.string().nullish(),
          score: z.number().nullish(),
        })
        .passthrough()
    )
    .optional(),
  report_package: z.unknown().optional(),
  reportPackage: z.unknown().optional(),
});

export type ScanResponse = z.infer<typeof ScanResponseSchema>;

export const ProfitReportResponseSchema = z.object({
  status: z.string(),
  report: z.string(),
  product: z.string().optional(),
  market: z.string().optional(),
});

export type ProfitReportResponse = z.infer<typeof ProfitReportResponseSchema>;
