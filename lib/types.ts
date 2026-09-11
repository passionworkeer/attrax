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
  /** Raw, validated-at-the-boundary backend package for report-only views. */
  reportPackage?: ReportPackage;
  modelInfo?: {
    visionProvider: "claude" | "openai" | "gemini" | "minimax" | "mock";
    latencyMs: number;
  };
  source?: "real" | "fallback" | "demo";
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
  images: undefined;
  documents: Array<{
    documentId: string;
    name: string;
    nameEn?: string;
    size: number;
    type: "pdf" | "docx" | "html";
    mimeType: string;
    url: string;
  }>;
  riskPoints: undefined;
  checklist: undefined;
  generatedAt: string;
  modelInfo: { ragProvider: string; latencyMs: number };
  source?: "real" | "fallback" | "demo";
}

export interface ScanStatus {
  sessionId: string;
  /**
   * Lifecycle of a scan.
   * - `processing`: scan in flight, progress increments.
   * - `ready`: real RAG scan completed successfully.
   * - `degraded`: RAG service unavailable / returned 5xx — the result field is
   *   filled with demo data so the user still sees something, but it is NOT a
   *   pass. `degradedReason` carries the error code and `result.source` is
   *   `"fallback"`. UI MUST distinguish this from `ready` (Wave2 consumers rely
   *   on this contract).
   * - `failed`: scan threw, no result produced.
   */
  status: "processing" | "ready" | "degraded" | "failed";
  progress: number;
  stageText: string;
  stageKey?: "queued" | "vision" | "retrieval" | "report" | "done" | "failed";
  /** Number of uploaded product images available through the scan asset API. */
  imageCount?: number;
  /** When status==="degraded", the RAG error code (e.g. RAG_SERVICE_UNAVAILABLE). */
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
