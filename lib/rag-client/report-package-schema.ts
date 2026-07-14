/**
 * lib/rag-client/report-package-schema.ts
 *
 * Strict Zod schema for the `ReportPackage` returned by the RAG service.
 *
 * This is the **frontend's source of truth** for what the backend is
 * contractually obligated to return. It mirrors
 * `rag_service/schemas/report_package.py` field-for-field:
 *
 *   - The Pydantic source is authoritative
 *   - `extra="allow"` in Pydantic → `.passthrough()` here
 *   - Pydantic coerces `markets` from CSV string → Zod does the same
 *   - Pydantic clamps `roadmap.progress` to [0, 100] → Zod does the same
 *
 * Use `validateReportPackage()` to fail-fast in development / tests; in
 * production, prefer `validateReportPackageLenient()` which still returns
 * the parsed result (with `validationStatus: "invalid"` and error list
 * populated on the metadata) when the payload is missing optional fields.
 *
 * Do NOT remove fields when the backend drops them — file an issue and
 * bump the contract doc (`docs/API-CONTRACT.md` §4) instead.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "report-package/v1";

const EvidenceItem = z
  .object({
    id: z.string(),
    layer: z.enum(["visual", "retrieval", "generation", "audit"]),
    source: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ProductDossier = z
  .object({
    product: z.string().optional().default(""),
    category: z.string().optional().default(""),
    markets: z.array(z.string()).optional().default([]),
    query: z.string().optional().default(""),
    sourceCounts: z.record(z.string(), z.number()).optional().default({}),
  })
  .passthrough();

const ProfitReport = z
  .object({
    markdown: z.string(),
    keyConclusion: z.string().optional().default(""),
    premiumPct: z.string().optional().default(""),
    breakevenUnits: z.string().optional().default(""),
    pricingStrategy: z.string().optional().default(""),
    riskNote: z.string().optional().default(""),
    conclusions: z.string().optional().default(""),
    references: z.string().optional().default(""),
  })
  .passthrough();

const RoadmapItem = z
  .object({
    id: z.string(),
    date: z.string().optional().default(""),
    title: z.string().optional().default(""),
    titleEn: z.string().optional().default(""),
    description: z.string().optional().default(""),
    descriptionEn: z.string().optional().default(""),
    type: z.string().optional().default("complete"),
    status: z.string().optional().default("pending"),
    estimatedDays: z.number().int().optional().default(0),
    cost: z.string().optional().default(""),
    documents: z.array(z.string()).optional().default([]),
    documentsEn: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const Roadmap = z
  .object({
    totalDays: z.number().int().optional().default(0),
    totalCost: z.string().optional().default(""),
    progress: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .default(0),
    items: z.array(RoadmapItem).optional().default([]),
  })
  .passthrough();

const DecisionNode = z
  .object({
    id: z.string(),
    type: z.string().optional().default(""),
    label: z.string().optional().default(""),
    labelEn: z.string().optional().default(""),
    status: z.string().optional().default("pending"),
    duration: z.string().optional().default(""),
    confidence: z.number().nullable().optional(),
    reasoning: z.string().optional().default(""),
    reasoningEn: z.string().optional().default(""),
  })
  .passthrough();

const DecisionView = z
  .object({
    summary: z.string().optional().default(""),
    keyFindings: z.array(z.string()).optional().default([]),
    recommendedAction: z.string().optional().default(""),
    nodes: z.array(DecisionNode).optional().default([]),
  })
  .passthrough();

const EvidenceBundles = z
  .object({
    visual: z.array(EvidenceItem).optional().default([]),
    retrieval: z.array(EvidenceItem).optional().default([]),
    generation: z.array(EvidenceItem).optional().default([]),
  })
  .passthrough();

const AuditMetadata = z
  .object({
    schemaVersion: z.string().optional().default(SCHEMA_VERSION),
    generatedAt: z.string(),
    validationStatus: z
      .enum(["normalized", "fallback", "invalid"])
      .optional()
      .default("normalized"),
    validationErrors: z.array(z.string()).optional().default([]),
    provider: z.string().optional().default(""),
    traceNodeCount: z.number().int().optional().default(0),
  })
  .passthrough();

export const ReportPackageSchema = z
  .object({
    productDossier: ProductDossier,
    complianceReport: z.string().min(1, "complianceReport must not be empty"),
    profitReport: ProfitReport,
    roadmap: Roadmap,
    decisionView: DecisionView,
    evidenceBundles: EvidenceBundles,
    auditMetadata: AuditMetadata,
  })
  .passthrough();

export type ReportPackageContract = z.infer<typeof ReportPackageSchema>;

export interface ValidationOutcome {
  ok: boolean;
  data: ReportPackageContract | null;
  errors: string[];
}

export function validateReportPackage(input: unknown): ValidationOutcome {
  const parsed = ReportPackageSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data, errors: [] };
  }
  return {
    ok: false,
    data: null,
    errors: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
  };
}
