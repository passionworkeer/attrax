import type { V1SessionData } from "@/lib/rag-client/v1-adapter";
import {
  MARKET_IDS,
  type ChecklistItem,
  type Market,
  type ProductCategory,
  type RegulationRef,
  type RiskPoint,
  type ReportPackage,
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

function excerpt(value: unknown, fallback: string, maxLength = 600): string {
  const content = text(value, fallback);
  return content.length <= maxLength ? content : `${content.slice(0, maxLength - 1)}…`;
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

// Severity → numeric rank used to roll up the highest-risk rule across the
// risk set. Mirrored in rollupSeverityForScore() below; keep them in sync.
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  warning: 3,
  info: 1,
};
// Same rank table for the LLM's per-node severity field (a 4-level system
// rather than the UI's 3-level Severity type).
const NODE_SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 4, // rolled-up "high" maps to the same penalty as "critical" for score
  medium: 2,
  info: 1,
};

function rollupSeverityForScore(
  riskPoints: RiskPoint[],
  decisionViewRiskLevel: string | undefined,
): Severity {
  // Prefer the decisionView's rolled-up riskLevel if the backend supplied it.
  const rk = NODE_SEVERITY_RANK[decisionViewRiskLevel?.toLowerCase() ?? ""];
  if (typeof rk === "number") {
    if (rk >= 4) return "critical";
    if (rk >= 2) return "warning"; // "warning" is the type slot above "info"
    return "info";
  }
  // Else, infer from per-risk severities (max wins).
  let bestRank = 0;
  for (const rp of riskPoints) {
    const rank = SEVERITY_RANK[rp.severity] ?? 0;
    if (rank > bestRank) bestRank = rank;
  }
  if (bestRank >= 4) return "critical";
  if (bestRank >= 3) return "warning";
  return "info";
}

function scoreFor(rollup: Severity): { score: number; grade: ScoreGrade } {
  switch (rollup) {
    case "critical":
      return { score: 35, grade: "D" };
    case "warning":
      return { score: 65, grade: "C" };
    case "info":
    default:
      return { score: 90, grade: "A" };
  }
}

// Backwards-compatible legacy lookup: keeps the previous behavior — explicit
// status string wins over derived rollup — for sessions where the backend only
// emits complianceStatus without riskPoints (legacy/demode).
function resultScore(result: UnknownRecord, status: string): { score: number; grade: ScoreGrade } {
  if (typeof status === "string" && status.length > 0) {
    const upper = status.toUpperCase();
    if (["PASS", "WARN", "REJECTED", "UNKNOWN"].includes(upper)) {
      return scoreFor(
        upper === "PASS" ? "info" : upper === "WARN" ? "warning" : upper === "REJECTED" ? "critical" : "info",
      );
    }
  }
  const fallback = scoreFor("info");
  const rawScore = number(result.complianceScore, fallback.score);
  const score = Math.max(0, Math.min(100, rawScore));
  const rawGrade = text(result.scoreGrade).toUpperCase();
  const grade = (["A", "B", "C", "D"] as const).includes(rawGrade as ScoreGrade)
    ? (rawGrade as ScoreGrade)
    : fallback.grade;
  return { score, grade };
}

// New severityFor: read per-node severity (a real enum) directly from the
// payload. The old logic that string-matched `node.status` is gone — status is
// pipeline state, severity is risk level. Two different things.
function severityFor(nodeSeverity: unknown): Severity {
  const raw = typeof nodeSeverity === "string" ? nodeSeverity.toLowerCase() : "";
  if (raw === "critical") return "critical";
  if (raw === "high") return "critical"; // rolled up: "high" → UI severity critical
  if (raw === "medium" || raw === "warning") return "warning";
  return "info";
}

function regulationFromChunk(chunk: UnknownRecord, index: number): RegulationRef {
  const market = markets([chunk.region ?? chunk.market], ["EU"])[0] ?? "EU";
  return {
    regId: text(chunk.regId ?? chunk.id, `reg-${index + 1}`),
    code: text(chunk.articleNo, text(chunk.code, "Source")),
    name: text(chunk.docName, text(chunk.title, "Regulatory source")),
    market,
    summary: excerpt(
      chunk.summary,
      excerpt(chunk.content, "Backend-retrieved regulatory evidence"),
    ),
    sourceUrl: text(chunk.url, "#"),
    severity: "info",
  };
}

function buildRisks(result: UnknownRecord, reportPackage: UnknownRecord): RiskPoint[] {
  const decision = record(reportPackage.decisionView);
  const nodes = records(decision.nodes);
  const regulations = records(result.retrievedChunks).map(regulationFromChunk);

  return nodes.map((node, index) => {
    // Read node.severity (real risk enum) — distinct from node.status which
    // is pipeline execution state. Falls back to "info" for older payloads.
    const severity = severityFor(node.severity);
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
  const complianceStatusRaw = result.complianceStatus;
  const complianceStatus =
    typeof complianceStatusRaw === "string" && complianceStatusRaw.length > 0
      ? complianceStatusRaw
      : "";

  // Build risks FIRST so the score can be rolled up from them. The previous
  // version computed score from `complianceStatus` alone, which caused the
  // "REJECTED with no critical riskPoint" bug.
  const riskPoints = buildRisks(result, reportPackage);
  const decisionView = record(reportPackage.decisionView);
  const decisionRiskLevel = text(decisionView.riskLevel);

  // Derive a rollup. If we have *any* riskPoints OR an explicit riskLevel,
  // use the rollup (matches the risk distribution the page renders). Only
  // fall back to legacy `complianceStatus` when both are absent.
  const score =
    riskPoints.length > 0 || decisionRiskLevel
      ? scoreFor(rollupSeverityForScore(riskPoints, decisionRiskLevel))
      : resultScore(result, complianceStatus);

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
    images: (session.assets ?? [])
      .filter((asset) => asset.kind === "image")
      .map((asset) => ({
        imageId: `${session.sessionId}-image-${asset.index}`,
        url: `/api/scan/${session.sessionId}/asset/${asset.index}`,
        thumbnail: `/api/scan/${session.sessionId}/asset/${asset.index}`,
        width: 0,
        height: 0,
        fileName: asset.name,
      })),
    documents: [],
    riskPoints,
    checklist: buildChecklist(reportPackage),
    generatedAt,
    reportPackage: result.reportPackage as ReportPackage | undefined,
    modelInfo: {
      visionProvider: "minimax",
      latencyMs: 0,
    },
    source: session.status === "degraded" ? "fallback" : "real",
  };
}
