import { z } from "zod";
import { MARKET_IDS } from "@/lib/types";

export const MarketSchema = z.enum(MARKET_IDS);
export const ProductCategorySchema = z.enum([
  "electronics",
  "appliance",
  "3c",
  "toy",
  "home",
  "other",
]);
export const FlameLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const SeveritySchema = z.enum(["critical", "warning", "info"]);
export const ScoreGradeSchema = z.enum(["A", "B", "C", "D"]);

// Session IDs are "scan_" + 1-50 chars of [A-Za-z0-9_-]
// (Crockford ULID produced by /api/scan, plus legacy test/demo IDs).
export const SessionIdSchema = z
  .string()
  .min(6)
  .max(64)
  .regex(/^scan_[0-9A-Za-z_-]{1,50}$/);

// Access tokens are 32 bytes of base64url (256 bits), 43 chars
export const AccessTokenSchema = z
  .string()
  .min(20)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const BoundingBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const ImageAssetSchema = z.object({
  imageId: z.string().min(1),
  url: z.string().min(1),
  thumbnail: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  angleHint: z
    .enum([
      "front",
      "back",
      "side",
      "nameplate",
      "package",
      "warning_label",
      "manual",
      "other",
    ])
    .optional(),
});

export const DocumentTypeSchema = z.enum(["pdf", "docx", "html"]);

export const DocumentAssetSchema = z.object({
  documentId: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().optional(),
  size: z.number().nonnegative(),
  type: DocumentTypeSchema,
  mimeType: z.string().min(1),
  url: z.string().min(1),
});

export const RegulationRefSchema = z.object({
  regId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().optional(),
  market: MarketSchema,
  summary: z.string().min(1),
  summaryEn: z.string().optional(),
  sourceUrl: z.string().url(),
  severity: SeveritySchema,
});

export const RiskPointSchema = z.object({
  riskId: z.string().min(1),
  title: z.string().min(1),
  titleEn: z.string().optional(),
  description: z.string().min(1),
  descriptionEn: z.string().optional(),
  severity: SeveritySchema,
  flameLevel: FlameLevelSchema,
  confidence: z.number().min(0).max(1),
  imageId: z.string().min(1),
  bbox: BoundingBoxSchema,
  regulations: z.array(RegulationRefSchema),
  recommendedAction: z.string().min(1),
  recommendedActionEn: z.string().optional(),
  estimatedFixCost: z.string().optional(),
});

export const ChecklistItemSchema = z.object({
  itemId: z.string().min(1),
  category: z.string().min(1),
  categoryEn: z.string().optional(),
  title: z.string().min(1),
  titleEn: z.string().optional(),
  requiredMaterials: z.array(z.string()),
  requiredMaterialsEn: z.array(z.string()).optional(),
  recommendedLab: z.string().optional(),
  recommendedLabEn: z.string().optional(),
  estimatedCost: z.string().optional(),
  estimatedTime: z.string().optional(),
  estimatedTimeEn: z.string().optional(),
  isFree: z.boolean(),
});

export const ScanResultSchema = z.object({
  sessionId: z.string().min(1),
  scanTime: z.string().datetime(),
  productCategory: ProductCategorySchema,
  productName: z.string().optional(),
  productNameEn: z.string().optional(),
  targetMarkets: z.array(MarketSchema).min(1),
  complianceScore: z.number().min(0).max(100),
  scoreGrade: ScoreGradeSchema,
  images: z.array(ImageAssetSchema),
  documents: z.array(DocumentAssetSchema),
  riskPoints: z.array(RiskPointSchema),
  checklist: z.array(ChecklistItemSchema),
  generatedAt: z.string().datetime(),
  modelInfo: z
    .object({
      visionProvider: z.enum(["claude", "openai", "gemini", "minimax", "mock"]),
      latencyMs: z.number().nonnegative(),
    })
    .optional(),
  source: z.enum(["real", "fallback", "demo"]).optional(),
});

export const ComplianceReportResultSchema = z.object({
  sessionId: z.string().min(1),
  scanTime: z.string().datetime().optional(),
  productCategory: ProductCategorySchema.optional(),
  productName: z.string().optional(),
  productNameEn: z.string().optional(),
  targetMarkets: z.array(MarketSchema).optional(),
  complianceScore: z.number().min(0).max(100),
  scoreGrade: ScoreGradeSchema,
  complianceReport: z.string().min(1),
  complianceReportEn: z.string().optional(),
  complianceStatus: z.enum(["PASS", "WARN", "REJECTED", "UNKNOWN"]),
  agentTrace: z.array(z.record(z.string(), z.unknown())),
  loopCount: z.number().int().nonnegative().optional(),
  retrievedChunks: z.array(
    z.object({
      regId: z.string().min(1),
      docName: z.string().min(1),
      docNameEn: z.string().optional(),
      articleNo: z.string().min(1),
      region: z.string().min(1),
      score: z.number(),
    })
  ),
  reportPackage: z.unknown().optional(),
  images: z.undefined().optional(),
  documents: z.array(DocumentAssetSchema).optional(),
  riskPoints: z.undefined().optional(),
  checklist: z.undefined().optional(),
  generatedAt: z.string().datetime().optional(),
  modelInfo: z
    .object({
      ragProvider: z.string().min(1),
      latencyMs: z.number().nonnegative(),
    })
    .optional(),
  source: z.enum(["real", "fallback", "demo"]).optional(),
});

export const ScanStatusSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(["processing", "ready", "degraded", "failed"]),
  progress: z.number().min(0).max(100),
  stageText: z.string(),
  result: z.union([ScanResultSchema, ComplianceReportResultSchema]).optional(),
  profitReport: z.unknown().optional(),
  profitReports: z.array(z.unknown()).optional(),
  error: z.string().optional(),
});

export const RawRiskSchema = z.object({
  imageId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  bbox: BoundingBoxSchema,
  category: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const VisionOutputSchema = z.object({
  productName: z.string().nullable().optional(),
  detectedAttributes: z.record(z.string(), z.unknown()),
  rawRisks: z.array(RawRiskSchema),
});

export const StartScanRequestSchema = z.object({
  category: ProductCategorySchema.default("electronics"),
  markets: z.array(MarketSchema).min(1).default(["EU", "US"]),
  imageCount: z.number().int().min(1).max(8),
  documentCount: z.number().int().min(0).max(5).default(0),
});

// ----- Blaze Hawks-specific visual report shapes (lib/types.blaze-hawks.ts) -----

export const CostBreakdownItemSchema = z.object({
  itemId: z.string().min(1),
  label: z.string().min(1),
  labelEn: z.string().optional(),
  amount: z.string().min(1),
  detail: z.string().min(1),
  detailEn: z.string().optional(),
});

export const FinancialSummarySchema = z.object({
  estimatedHeroicProfit: z.string().min(1),
  trueNetProfit: z.string().min(1),
  complianceCost: z.string().min(1),
  monthlyNetProfit: z.string().min(1),
  targetVolumeLabel: z.string().min(1),
  targetVolumeLabelEn: z.string().optional(),
  riskExposureItems: z.array(z.string()),
  riskExposureItemsEn: z.array(z.string()).optional(),
  costBreakdown: z.array(CostBreakdownItemSchema),
});
