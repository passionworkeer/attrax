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

export type DocumentType = "pdf" | "docx" | "html";

export interface DocumentAsset {
  documentId: string;
  name: string;
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
  documents: DocumentAsset[];
  riskPoints: RiskPoint[];
  checklist: ChecklistItem[];
  generatedAt: string;
  modelInfo?: {
    visionProvider: "claude" | "openai" | "gemini" | "mock";
    latencyMs: number;
  };
}

export interface ComplianceReportResult {
  sessionId: string;
  scanTime: string;
  productCategory: ProductCategory;
  productName?: string;
  targetMarkets: Market[];
  complianceScore: number;
  scoreGrade: ScoreGrade;
  /** Full markdown compliance report from Claude Sonnet */
  complianceReport: string;
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
    articleNo: string;
    region: string;
    score: number;
  }>;
  images: undefined;
  documents: Array<{
    documentId: string;
    name: string;
    size: number;
    type: "pdf" | "docx" | "html";
    mimeType: string;
    url: string;
  }>;
  riskPoints: undefined;
  checklist: undefined;
  generatedAt: string;
  modelInfo: { ragProvider: string; latencyMs: number };
}

export interface ScanStatus {
  sessionId: string;
  status: "processing" | "ready" | "failed";
  progress: number;
  stageText: string;
  result?: ScanResult | ComplianceReportResult;
  error?: string;
}
