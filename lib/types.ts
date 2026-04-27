export type Market = "EU" | "US" | "UK";
export type ProductCategory =
  | "electronics"
  | "appliance"
  | "3c"
  | "toy"
  | "home"
  | "other";
export type FlameLevel = 1 | 2 | 3;
export type Severity = "critical" | "warning" | "info";
export type ScoreGrade = "A" | "B" | "C" | "D";

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

export interface RegulationRef {
  regId: string;
  code: string;
  name: string;
  nameEn?: string;
  market: Market;
  summary: string;
  sourceUrl: string;
  severity: Severity;
}

export interface RiskPoint {
  riskId: string;
  title: string;
  description: string;
  severity: Severity;
  flameLevel: FlameLevel;
  confidence: number;
  imageId: string;
  bbox: BoundingBox;
  regulations: RegulationRef[];
  recommendedAction: string;
  estimatedFixCost?: string;
}

export interface ChecklistItem {
  itemId: string;
  category: string;
  title: string;
  requiredMaterials: string[];
  recommendedLab?: string;
  estimatedCost?: string;
  estimatedTime?: string;
  isFree: boolean;
}

export interface ScanResult {
  sessionId: string;
  scanTime: string;
  productCategory: ProductCategory;
  productName?: string;
  targetMarkets: Market[];
  complianceScore: number;
  scoreGrade: ScoreGrade;
  images: ImageAsset[];
  riskPoints: RiskPoint[];
  checklist: ChecklistItem[];
  generatedAt: string;
  modelInfo?: {
    visionProvider: "claude" | "openai" | "gemini" | "mock";
    latencyMs: number;
  };
}

export interface ScanStatus {
  sessionId: string;
  status: "processing" | "ready" | "failed";
  progress: number;
  stageText: string;
  result?: ScanResult;
  error?: string;
}
