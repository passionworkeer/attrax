import type { V1SessionData } from "@/lib/rag-client/v1-adapter";
import {
  MARKET_IDS,
  type ChecklistItem,
  type Market,
  type ProductCategory,
  type RegulationRef,
  type RiskPoint,
  type ScanResult,
  type ScoreGrade,
  type Severity,
} from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

const MARKET_SET = new Set<string>(MARKET_IDS);
const PRODUCT_CATEGORIES = new Set<ProductCategory>([
  "electronics",
  "appliance",
  "3c",
  "toy",
  "home",
  "other",
]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function markets(value: unknown, fallback: string[]): Market[] {
  const values = Array.isArray(value) ? value : fallback;
  return values
    .map((item) => String(item).toUpperCase())
    .filter((item): item is Market => MARKET_SET.has(item));
}

function productCategory(value: unknown): ProductCategory {
  const candidate = String(value || "other") as ProductCategory;
  return PRODUCT_CATEGORIES.has(candidate) ? candidate : "other";
}

function scoreFor(status: string): { score: number; grade: ScoreGrade } {
  switch (status.toUpperCase()) {
    case "PASS":
      return { score: 90, grade: "A" };
    case "WARN":
      return { score: 65, grade: "C" };
    case "REJECTED":
      return { score: 35, grade: "D" };
    default:
      return { score: 50, grade: "C" };
  }
}

function severityFor(status: string): Severity {
  const normalized = status.toLowerCase();
  if (["failed", "blocked", "rejected", "critical"].includes(normalized)) {
    return "critical";
  }
  if (["warning", "warn", "pending", "review"].includes(normalized)) {
    return "warning";
  }
  return "info";
}

function regulationFromChunk(chunk: UnknownRecord, index: number): RegulationRef {
  const market = markets([chunk.region ?? chunk.market], ["EU"])[0] ?? "EU";
  return {
    regId: text(chunk.regId ?? chunk.id, `reg-${index + 1}`),
    code: text(chunk.articleNo, text(chunk.code, "Source")),
    name: text(chunk.docName, text(chunk.title, "Regulatory source")),
    market,
    summary: text(chunk.summary, text(chunk.content, "Backend-retrieved regulatory evidence")),
    sourceUrl: text(chunk.url, "#"),
    severity: "info",
  };
}

function buildRisks(result: UnknownRecord, reportPackage: UnknownRecord): RiskPoint[] {
  const decision = record(reportPackage.decisionView);
  const nodes = records(decision.nodes);
  const regulations = records(result.retrievedChunks).map(regulationFromChunk);

  return nodes.map((node, index) => {
    const severity = severityFor(text(node.status));
    const confidence = Math.max(0, Math.min(1, number(node.confidence, 0)));
    return {
      riskId: text(node.id, `risk-${index + 1}`),
      title: text(node.label, text(node.type, `Risk ${index + 1}`)),
      titleEn: text(node.labelEn) || undefined,
      description: text(node.reasoning, text(decision.summary, "Backend decision evidence")),
      descriptionEn: text(node.reasoningEn) || undefined,
      severity,
      flameLevel: severity === "critical" ? 3 : severity === "warning" ? 2 : 1,
      confidence,
      imageId: "",
      bbox: { x: 0, y: 0, w: 0, h: 0 },
      regulations,
      recommendedAction: text(
        decision.recommendedAction,
        severity === "info" ? "保留证据并复核" : "按路线图完成整改并复核",
      ),
      recommendedActionEn: text(decision.recommendedActionEn) || undefined,
    };
  });
}

function buildChecklist(reportPackage: UnknownRecord): ChecklistItem[] {
  const roadmap = record(reportPackage.roadmap);
  return records(roadmap.items).map((item, index) => {
    const days = number(item.estimatedDays, 0);
    return {
      itemId: text(item.id, `roadmap-${index + 1}`),
      category: text(item.type, "roadmap"),
      title: text(item.title, text(item.description, `Roadmap item ${index + 1}`)),
      titleEn: text(item.titleEn) || undefined,
      requiredMaterials: Array.isArray(item.documents)
        ? item.documents.map((value) => String(value))
        : [],
      requiredMaterialsEn: Array.isArray(item.documentsEn)
        ? item.documentsEn.map((value) => String(value))
        : undefined,
      estimatedCost: text(item.cost) || undefined,
      estimatedTime: days > 0 ? `${days} 天` : text(item.date) || undefined,
      estimatedTimeEn: days > 0 ? `${days} days` : undefined,
      isFree: !text(item.cost) || /^0|free$/i.test(text(item.cost)),
    };
  });
}

export function normalizeV1ScanResult(session: V1SessionData): ScanResult | undefined {
  if (!session.result) return undefined;

  const result = record(session.result);
  const reportPackage = record(result.reportPackage);
  const complianceStatus = text(result.complianceStatus, "UNKNOWN");
  const score = scoreFor(complianceStatus);
  const generatedAt = text(
    record(reportPackage.auditMetadata).generatedAt,
    session.updatedAt,
  );

  return {
    sessionId: session.sessionId,
    scanTime: session.createdAt,
    productCategory: productCategory(result.productCategory ?? session.category),
    productName: text(result.productName) || undefined,
    targetMarkets: markets(result.targetMarkets, session.markets),
    complianceScore: score.score,
    scoreGrade: score.grade,
    images: [],
    documents: [],
    riskPoints: buildRisks(result, reportPackage),
    checklist: buildChecklist(reportPackage),
    generatedAt,
    modelInfo: {
      visionProvider: "minimax",
      latencyMs: 0,
    },
    source: session.status === "degraded" ? "fallback" : "real",
  };
}
