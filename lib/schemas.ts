import { z } from "zod";

export const MarketSchema = z.enum(["EU", "US", "UK"]);
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

export const RegulationRefSchema = z.object({
  regId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().optional(),
  market: MarketSchema,
  summary: z.string().min(1),
  sourceUrl: z.string().url(),
  severity: SeveritySchema,
});

export const RiskPointSchema = z.object({
  riskId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  severity: SeveritySchema,
  flameLevel: FlameLevelSchema,
  confidence: z.number().min(0).max(1),
  imageId: z.string().min(1),
  bbox: BoundingBoxSchema,
  regulations: z.array(RegulationRefSchema),
  recommendedAction: z.string().min(1),
  estimatedFixCost: z.string().optional(),
});

export const ChecklistItemSchema = z.object({
  itemId: z.string().min(1),
  category: z.string().min(1),
  title: z.string().min(1),
  requiredMaterials: z.array(z.string()),
  recommendedLab: z.string().optional(),
  estimatedCost: z.string().optional(),
  estimatedTime: z.string().optional(),
  isFree: z.boolean(),
});

export const ScanResultSchema = z.object({
  sessionId: z.string().min(1),
  scanTime: z.string().datetime(),
  productCategory: ProductCategorySchema,
  productName: z.string().optional(),
  targetMarkets: z.array(MarketSchema).min(1),
  complianceScore: z.number().min(0).max(100),
  scoreGrade: ScoreGradeSchema,
  images: z.array(ImageAssetSchema),
  riskPoints: z.array(RiskPointSchema),
  checklist: z.array(ChecklistItemSchema),
  generatedAt: z.string().datetime(),
  modelInfo: z
    .object({
      visionProvider: z.enum(["claude", "openai", "gemini", "mock"]),
      latencyMs: z.number().nonnegative(),
    })
    .optional(),
});

export const ScanStatusSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(["processing", "ready", "failed"]),
  progress: z.number().min(0).max(100),
  stageText: z.string(),
  result: ScanResultSchema.optional(),
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
});
