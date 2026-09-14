// Single source of truth for the markets the upload page exposes. The
// backend allow-list (rag_service/config.py ALLOWED_MARKETS) and the BFF
// (app/api/scan/route.ts ALLOWED_MARKETS) MUST stay in lockstep with
// this list. Audit 2026-09-13 P0-5 caught the previous drift where the
// BFF silently filtered 8 of these markets and fell back to EU/US.
export const MARKET_IDS = [
  "EU",
  "US",
  "UK",
  "CN",
  "AU",
  "SA",
  "AE",
  "JP",
  "KR",
  "CA",
  "SG",
  "MX",
  "BR",
  "DE",
  "FR",
  "IT",
] as const;

export type AppLocale = "zh" | "en";

import type { FinancialSummary } from "@/lib/types.blaze-hawks";

export type Market =
  | "EU"
  | "US"
  | "UK"
  | "CN"
  | "AU"
  | "SA"
  | "AE"
  | "JP"
  | "KR"
  | "CA"
  | "SG"
  | "MX"
  | "BR"
  | "DE"
  | "FR"
  | "IT";
export type ProductCategory =
  | "electronics"
  | "appliance"
  | "3c"
  | "toy"
  | "home"
  | "battery"
  | "cosmetic"
  | "textile"
  | "food_contact"
  | "other";
export type FlameLevel = 1 | 2 | 3;
export type Severity = "critical" | "warning" | "info" | "unknown";
export type ScoreGrade = "A" | "B" | "C" | "D";
export type { FinancialSummary, CostBreakdownItem } from "@/lib/types.blaze-hawks";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageAsset {
  imageId: string;
  url: string;
  thumbnail: string;
  width: number;
  height: number;
  fileName?: string;
  angleHint?:
    | "front"
    | "back"
    | "side"
    | "nameplate"
    | "package"
    | "warning_label"
    | "manual"
    | "other";
}

export type DocumentType = "pdf" | "docx" | "html";

export interface DocumentAsset {
  documentId: string;
  name: string;
  nameEn?: string;
  size: number;
  type: DocumentType;
  mimeType: string;
  url: string;
}

export interface RegulationRef {
  regId: string;
  code: string;
  name: string;
  nameEn?: string;
  market: Market;
  summary: string;
  summaryEn?: string;
  sourceUrl: string;
  severity: Severity;
}

export interface RiskPoint {
  riskId: string;
  title: string;
  titleEn?: string;
  description: string;
  descriptionEn?: string;
  severity: Severity;
  flameLevel: FlameLevel;
  confidence: number;
  imageId: string;
  bbox: BoundingBox;
  regulations: RegulationRef[];
  recommendedAction: string;
  recommendedActionEn?: string;
  estimatedFixCost?: string;
}

export interface ChecklistItem {
  itemId: string;
  category: string;
  categoryEn?: string;
  title: string;
  titleEn?: string;
  requiredMaterials: string[];
  requiredMaterialsEn?: string[];
  recommendedLab?: string;
  recommendedLabEn?: string;
  estimatedCost?: string;
  estimatedTime?: string;
  estimatedTimeEn?: string;
  isFree: boolean;
}

export interface ScanResult {
  sessionId: string;
  scanTime: string;
  productCategory: ProductCategory;
  productName?: string;
  productNameEn?: string;
  requestedLocale?: AppLocale;
  targetMarkets: Market[];
  complianceScore: number;
  scoreGrade: ScoreGrade;
  images: ImageAsset[];
  documents: DocumentAsset[];
  riskPoints: RiskPoint[];
  checklist: ChecklistItem[];
  generatedAt: string;
  financialSummary?: FinancialSummary;
  /**
   * Real LLM-rendered compliance report markdown. Populated by the v1 adapter
   * from `result.complianceReport` (or `reportPackage.complianceReport` as a
   * fallback) so the result page can render the actual generated text instead
   * of falling back to the demo template.
   */
  complianceReport?: string;
  /**
   * Audit P1-G: set when the LLM-rendered report was truncated by the BFF
   * to `MAX_COMPLIANCE_REPORT_BYTES` (200KB). The page can use this to
   * show a "truncated" hint and prevent users from re-sharing a report
   * that lost context mid-paragraph.
   */
  complianceReportTruncated?: boolean;
  /**
   * Real agent execution trace from the KB-anchored pipeline (vision →
   * generate → verify). Optional because legacy RAG payloads and demo
   * sessions do not emit it; consumers must guard for absence.
   */
  agentTrace?: Array<{ node: string; [key: string]: unknown }>;
  /** Real LLM provider name as reported by the backend (e.g. "minimax"). */
  ragProvider?: string;
  /** Pipeline total latency, milliseconds (sum of all node durations). */
  latencyMs?: number;
  /**
   * Number of refine / re-retrieval rounds. Always 0 for the De-RAG pipeline
   * (single-pass generation); legacy RAG payloads with a refine loop set this
   * to 1+. Surfaced as "审核轮数 / Review Rounds" on the result page.
   */
  loopCount?: number;
  /** Raw, validated-at-the-boundary backend package for report-only views. */
  reportPackage?: ReportPackage;
  /**
   * Plan 2026-09-13 §6 — visual inspection v2 observations. Optional: only
   * checklist-mode scans (categories with an inspection profile) populate
   * these; legacy/demo sessions leave them undefined.
   */
  inspectionObservations?: InspectionObservation[];
  /** Selected check ids from the category's inspection profile (v2). */
  selectedCheckIds?: string[];
  /** Deterministic findings v2 (plan §6) — built server-side from the
   * observations + deferred evidence checks, never by the LLM. */
  inspectionFindings?: InspectionFinding[];
  modelInfo?: {
    visionProvider: "claude" | "openai" | "gemini" | "minimax" | "mock";
    latencyMs: number;
  };
  source?: "real" | "fallback" | "demo";
}

/** One observed fact about one check on one image (plan §6 Observation). */
export interface InspectionObservation {
  observationId: string;
  checkId: string;
  imageId: string;
  visibility:
    | "present_readable"
    | "present_unreadable"
    | "not_in_view"
    | "occluded"
    | "absent_in_visible_scope"
    | "not_assessed";
  observedText?: string | null;
  description: string;
  region: null | {
    kind: "bbox" | "polygon";
    coordinateSpace: "normalized_canonical_image";
    bbox?: { x: number; y: number; w: number; h: number };
    verified?: boolean;
  };
}

/** Deterministic finding built from observations (plan §6 Finding). */
export interface InspectionFinding {
  findingId: string;
  checkId: string;
  title: string;
  assessment: "suspected_issue" | "evidence_needed" | "confirmed_issue";
  applicability: "applicable" | "not_applicable" | "needs_confirmation";
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  observationIds: string[];
  citationIds: string[];
  suggestedAction: string;
  requiredEvidence: string[];
}

export interface ComplianceReportResult {
  sessionId: string;
  scanTime: string;
  productCategory: ProductCategory;
  productName?: string;
  productNameEn?: string;
  targetMarkets: Market[];
  complianceScore: number;
  scoreGrade: ScoreGrade;
  /** Full markdown compliance report from Claude Sonnet */
  complianceReport: string;
  complianceReportEn?: string;
  /** PASS | WARN | REJECTED */
  complianceStatus: "PASS" | "WARN" | "REJECTED" | "UNKNOWN";
  /**
   * Audit P1-K: discriminator that records which converter produced this
   * view. `kind === "demo"` means the demo template was used (no real LLM
   * output) and `kind === "real"` means the helper forwarded KB-anchored
   * data. The result page currently chooses by `sessionId === "demo"` but
   * the discriminator makes the contract self-enforcing: future callers
   * cannot accidentally route a real scan through the demo converter
   * because the type-level union forces them to pick a kind explicitly.
   */
  kind: "demo" | "real";
  /** Agent execution trace (node name + timing per step) */
  agentTrace: Array<{ node: string; [key: string]: unknown }>;
  /** Loop count (0 = single retrieval, 1-2 = re-retrieval) */
  loopCount: number;
  /** Retrieved regulation chunks */
  retrievedChunks: Array<{
    regId: string;
    docName: string;
    docNameEn?: string;
    articleNo: string;
    region: string;
    score: number;
  }>;
  /** Optional one-pass generated package for the four result scenes. */
  reportPackage?: ReportPackage;
  /**
   * Product images uploaded for the scan. Forwarded by both the demo converter
   * and the real (KB-anchored) converter so the rich risk-point panel in
   * `<ComplianceReportView>` can render thumbnails / hotspot overlays.
   * `undefined` is kept as a valid value for legacy callers that do not pass
   * images through; the view treats undefined the same as empty.
   */
  images?: ImageAsset[] | undefined;
  /**
   * Optional documents uploaded alongside the images. When the user attaches
   * a PDF/DOCX/TXT spec sheet via the upload page, the file metadata flows
   * through here so downstream export modules can list them in the report.
   */
  documents?: Array<{
    documentId: string;
    name: string;
    nameEn?: string;
    size: number;
    type: "pdf" | "docx" | "html";
    mimeType: string;
    url: string;
  }>;
  /**
   * Risk points for the rich UI section. Optional to preserve backwards compat
   * with legacy RAG payloads that did not emit a flat array (only nested
   * markdown). When `images` is empty the rich panel stays collapsed.
   */
  riskPoints?: RiskPoint[] | undefined;
  checklist?: ChecklistItem[] | undefined;
  generatedAt: string;
  modelInfo: { ragProvider: string; latencyMs: number };
  source?: "real" | "fallback" | "demo";
}

export interface ScanStatus {
  sessionId: string;
  /**
   * Lifecycle of a scan.
   * - `processing`: scan in flight, progress increments.
   * - `ready`: real scan completed successfully.
   * - `degraded`: scan service returned an incomplete result — the result
   *   field is still populated (with whatever the pipeline could produce)
   *   but it is NOT a pass. `degradedReason` carries the error code and
   *   `result.source` is `"fallback"`. UI MUST distinguish this from
   *   `ready` (Wave2 consumers rely on this contract).
   * - `failed`: scan threw, no result produced.
   */
  status: "processing" | "ready" | "degraded" | "failed";
  progress: number;
  stageText: string;
  stageKey?: "queued" | "vision" | "retrieval" | "report" | "done" | "failed";
  /**
   * Backend-explicit "result payload addressable" flag (plan §4.1). True only
   * when status is terminal (`ready`/`degraded`) AND a result payload exists.
   * The burning page uses this — not `status` alone — to drive the
   * 100% → hold → navigate state machine, so a `ready` transition racing the
   * result persist can never fake a completed scan.
   */
  resultReady?: boolean;
  /** Number of uploaded product images available through the scan asset API. */
  imageCount?: number;
  /** When status==="degraded", the scan service error code (e.g. SCAN_SERVICE_UNAVAILABLE). */
  degradedReason?: string;
  result?: ScanResult | ComplianceReportResult;
  profitReport?: ProfitReportResult;
  profitReports?: ProfitReportResult[];
  error?: string;
  /**
   * Per-upload archive metadata, populated by /api/scan so admins can review
   * what each session submitted even after the buffers are freed. See
   * lib/pipeline/upload-storage.ts for the on-disk layout.
   */
  uploads?: Array<{
    originalName: string;
    savedAs: string;
    savedPath: string;
    size: number;
    mimeType: string;
    sha256: string;
    kind: "image" | "document";
  }>;
}

export interface ProductDossier {
  product?: string;
  category?: string;
  markets?: string[];
  productName?: string;
  product_name?: string;
  productCategory?: string;
  product_category?: string;
  targetMarkets?: string[];
  target_markets?: string[];
  query?: string;
  summary?: string;
  uploadedDocuments?: string[];
  uploaded_documents?: string[];
  imageCount?: number;
  image_count?: number;
  documentCount?: number;
  document_count?: number;
  sourceCounts?: Record<string, number>;
  source_counts?: Record<string, number>;
  [key: string]: unknown;
}

export interface EvidenceItem {
  id?: string;
  layer?: "visual" | "retrieval" | "generation" | "audit" | string;
  source?: string;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EvidenceBundle {
  visual?: EvidenceItem[];
  retrieval?: EvidenceItem[];
  generation?: EvidenceItem[];
  sourceChunks?: Array<{
    regId?: string;
    reg_id?: string;
    docName?: string;
    doc_name?: string;
    articleNo?: string;
    article_no?: string;
    region?: string;
    score?: number;
    content?: string;
    [key: string]: unknown;
  }>;
  source_chunks?: EvidenceBundle["sourceChunks"];
  retrievedChunks?: EvidenceBundle["sourceChunks"];
  retrieved_chunks?: EvidenceBundle["sourceChunks"];
  uploadedDocuments?: Array<{
    name?: string;
    mimeType?: string;
    mime_type?: string;
    text?: string;
    [key: string]: unknown;
  }>;
  uploaded_documents?: EvidenceBundle["uploadedDocuments"];
  [key: string]: unknown;
}

export interface AuditMetadata {
  schemaVersion?: string;
  schema_version?: string;
  generatedAt?: string;
  generated_at?: string;
  validationStatus?: string;
  validation_status?: string;
  validationErrors?: string[];
  validation_errors?: string[];
  generator?: string;
  model?: string;
  provider?: string;
  latencyMs?: number;
  latency_ms?: number;
  loopCount?: number;
  loop_count?: number;
  traceNodeCount?: number;
  trace_node_count?: number;
  packageVersion?: string;
  package_version?: string;
  warnings?: string[];
  finance?: {
    validationStatus?: "valid" | "invalid";
    validation_status?: "valid" | "invalid";
    errors?: string[];
  };
  /**
   * Audit P0-D: per-sub-scene validation, mirroring `finance`. When the
   * orchestrator emits a malformed decisionView/roadmap/evidenceBundles
   * shape, the schema normalizer records it here instead of flipping
   * `validationStatus` to "invalid". The result page's `<FallbackNotice>`
   * does not surface these (they are non-fatal by design), but downstream
   * tooling and the profit/roadmap pages can read them to render their
   * own notices.
   */
  decisionView?: {
    validationStatus?: "valid" | "invalid";
    errors?: string[];
  };
  roadmap?: {
    validationStatus?: "valid" | "invalid";
    errors?: string[];
  };
  evidenceBundles?: {
    validationStatus?: "valid" | "invalid";
    errors?: string[];
  };
  [key: string]: unknown;
}

export interface ReportPackage {
  productDossier?: ProductDossier;
  product_dossier?: ProductDossier;
  evidenceBundles?: EvidenceBundle;
  evidence_bundles?: EvidenceBundle;
  evidenceBundle?: EvidenceBundle;
  evidence_bundle?: EvidenceBundle;
  auditMetadata?: AuditMetadata;
  audit_metadata?: AuditMetadata;
  complianceReport?: string;
  complianceReportEn?: string;
  compliance_report_en?: string;
  compliance_report?: string;
  profitReport?: {
    markdown?: string;
    markdownEn?: string;
    markdown_en?: string;
    keyConclusion?: string;
    key_conclusion?: string;
    keyConclusionEn?: string;
    key_conclusion_en?: string;
    premiumPct?: string;
    premium_pct?: string;
    breakevenUnits?: string;
    breakeven_units?: string;
    breakevenUnitsEn?: string;
    breakeven_units_en?: string;
    pricingStrategy?: string;
    pricing_strategy?: string;
    pricingStrategyEn?: string;
    pricing_strategy_en?: string;
    riskNote?: string;
    risk_note?: string;
    riskNoteEn?: string;
    risk_note_en?: string;
    conclusions?: string;
    conclusionsEn?: string;
    conclusions_en?: string;
    references?: string;
    referencesEn?: string;
    references_en?: string;
    /**
     * Optional free-form structured fields emitted by the RAG generator.
     * The Pydantic side has no fixed schema for these (passed through with
     * extra="allow"); when present, the frontend prefers them over
     * buildProfitReportFromMarkdown's regex parsing.
     *
     * Recommended shape (consumed by `lib/pipeline/profit-report.ts`):
     *   {
     *     costComparison: {
     *       barebone: CostSummary,
     *       compliant: CostSummary,
     *     },
     *     breakeven: { units: number, currency: "USD" | "CNY" | ... },
     *     pricing: { recommended: number, strategy: string },
     *     risk: { bareboneExposure: number, compliantExposure: number },
     *   }
     */
    structuredFields?: {
      currency: string;
      costComparison: {
        barebone: CostSummary;
        compliant: CostSummary;
      };
      breakeven?: { units?: number; currency?: string };
      pricing?: { recommended?: number; strategy?: string };
      risk?: { bareboneExposure?: number; compliantExposure?: number };
    };
  };
  profit_report?: ReportPackage["profitReport"] | string;
  roadmap?: GeneratedRoadmap;
  decisionView?: GeneratedDecisionView;
  decision_view?: GeneratedDecisionView;
  // De-RAG spec §3.3 + §7.3: per-claim citations emitted by the LLM
  // (and post-processed by quote_matcher in §7.4). Empty array when
  // the KB-anchored generator is off; legacy chunk-based reports
  // also keep this field empty.
  citations?: import("@/lib/rag-client/report-package-schema").CitationRefContract[];
  evidencePack?: import("@/lib/rag-client/report-package-schema").CitationRefContract[];
}

export type GeneratedReportPackage = ReportPackage;

export interface GeneratedRoadmap {
  totalDays?: number;
  total_days?: number;
  totalCost?: string;
  total_cost?: string;
  progress?: number;
  items?: GeneratedRoadmapItem[];
}

export interface GeneratedRoadmapItem {
  id?: string;
  date?: string;
  title?: string;
  titleEn?: string;
  title_en?: string;
  description?: string;
  descriptionEn?: string;
  description_en?: string;
  type?: "apply" | "test" | "certify" | "complete";
  status?: "pending" | "in-progress" | "completed";
  estimatedDays?: number;
  estimated_days?: number;
  cost?: string;
  documents?: string[];
  documentsEn?: string[];
  documents_en?: string[];
}

export interface GeneratedDecisionView {
  verdict?: string;
  riskLevel?: string;
  summary?: string;
  summaryEn?: string;
  summary_en?: string;
  keyFindings?: string[];
  key_findings?: string[];
  keyFindingsEn?: string[];
  key_findings_en?: string[];
  recommendedAction?: string;
  recommended_action?: string;
  recommendedActionEn?: string;
  recommended_action_en?: string;
  nodes?: GeneratedDecisionNode[];
}

export interface GeneratedDecisionNode {
  id?: string;
  type?: string;
  label?: string;
  labelEn?: string;
  label_en?: string;
  icon?: string;
  // severity is the per-node risk level (critical/high/medium/info). distinct
  // from `status` (pipeline execution state: success/pending/running/error).
  severity?: "critical" | "high" | "medium" | "info";
  status?: string;
  duration?: string;
  confidence?: number;
  reasoning?: string;
  reasoningEn?: string;
  reasoning_en?: string;
  metadata?: Record<string, unknown>;
}

export interface CostSummary {
  bom: number;           // 材料成本（BOM）
  packaging: number;       // 包装印刷
  cert: number;           // 认证费摊销
  epr: number;             // EPR 运营费
  logistics: number;        // 物流渠道
  asp: number;             // 平均售价
  gp: number;              // 毛利润
  warranty: number;        // 售后/保修预留
  total: number;           // 总直接成本（不含 ASP）
}

export interface ProfitReportResult {
  sessionId: string;
  productType: string;
  productTypeEn?: string;
  market: string;
  marketEn?: string;
  currency?: string; // "USD" | "CNY" | "EUR" | "GBP"
  report: string;               // markdown（含完整6章节）
  reportEn?: string;
  barebone: CostSummary;
  compliant: CostSummary;
  bareboneRiskExposure: number;  // 风险敞口（暴露金额）
  compliantRiskExposure: number; // 风险敞口（暴露金额）
  keyConclusion: string;
  keyConclusionEn?: string;
  generatedAt: string;
  // 新增字段
  premiumPct: string;            // 合规溢价，如 "37%"
  breakevenUnits: string;        // 盈亏平衡台数
  breakevenUnitsEn?: string;
  pricingStrategy: string;       // 定价策略建议
  pricingStrategyEn?: string;
  riskNote: string;              // 风险敞口说明
  riskNoteEn?: string;
  conclusions: string;           // 关键结论章节全文
  conclusionsEn?: string;
  references: string;           // 法规引用章节全文
  referencesEn?: string;
  bareboneGpm: number;         // 裸奔毛利率（0-100 数值）
  compliantGpm: number;        // 合规毛利率（0-100 数值）
}
