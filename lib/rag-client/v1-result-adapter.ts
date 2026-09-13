import type { V1SessionData } from "@/lib/rag-client/v1-adapter";
import {
  MARKET_IDS,
  type ChecklistItem,
  type DocumentType,
  type InspectionFinding,
  type InspectionObservation,
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

function markets(value: unknown, fallback?: string[]): Market[] {
  const values = Array.isArray(value)
    ? value
    : Array.isArray(fallback)
      ? fallback
      : ["EU"];
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
  unknown: 0,
};
// Same rank table for the LLM's per-node severity field (a 4-level system
// rather than the UI's 3-level Severity type).
//   2026-07-20: 把 `high:4` 改为 `high:3`,避免后端 riskLevel=HIGH(比如 vision
//   节点看到图但部分标志不清晰)被一次性打到 35/D。后端 vision 默认把
//   "图不清晰"判 HIGH(见 rag_service/generate/report_generator.py:84),但
//   这只是"无铭牌图"的中等风险,不该等同于 critical。前端 rollup 信任
//   riskLevel,所以这里把 high 拉低到 warning 级(65/C);同时加 `low:0`
//   让 LOW riskLevel 走 fallback(riskPoints 路径)而不是 undefined。
const NODE_SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 0,
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
      return { score: 90, grade: "A" };
    case "unknown":
    default:
      // 中性档:后端返回 UNKNOWN(不知道合不合规)时不应给绿色 90/A 误导用户放行。
      return { score: 50, grade: "C" };
  }
}

// Backwards-compatible legacy lookup: keeps the previous behavior — explicit
// status string wins over derived rollup — for sessions where the backend only
// emits complianceStatus without riskPoints (legacy/demode).
function resultScore(result: UnknownRecord, status: string): { score: number; grade: ScoreGrade } {
  if (typeof status === "string" && status.length > 0) {
    const upper = status.toUpperCase();
    if (["PASS", "WARN", "REJECTED", "UNKNOWN"].includes(upper)) {
      // UNKNOWN 走中性 50/C(别给绿色 90/A 误导合规放行)。
      if (upper === "UNKNOWN") return scoreFor("unknown");
      return scoreFor(
        upper === "PASS" ? "info" : upper === "WARN" ? "warning" : "critical",
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
  if (raw === "unknown") return "unknown";
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

// Pipeline-stage nodes describe the *process* rather than a real
// compliance finding. The 2026-09-13 plan §3 calls these out: turning
// them into RiskPoint rows surfaces them on the verdict strip and
// inflates the critical/warning counts. We drop them at the adapter
// boundary so the page only sees actual findings.
//
// Matching rule — the pipeline's own node names match on EXACT node.id
// only (the production scan emitted ids: vision / query_planner /
// retriever / synthesis / generate / verify). Type matching is NOT used
// for these: `_inject_vision_hotspots` appends REAL finding nodes with
// type "vision" and ids like "vision-issue-0" — exact-id matching keeps
// those alive. The audit-stage vocabulary (audit / consistency /
// cite_check / …) matches on id OR type since those never carry
// hotspots.
const PIPELINE_NODE_IDS = new Set<string>([
  "vision",
  "query_planner",
  "queryplanner",
  "query-planner",
  "retriever",
  "retrieve",
  "retrieval",
  "synthesis",
  "generate",
  "generator",
  "verify",
  "verifier",
  "refine",
]);

const AUDIT_STAGE_NODE_TYPES = new Set<string>([
  "audit",
  "consistency",
  "consistency_check",
  "consistency-check",
  "verification",
  "cite_check",
  "cite-check",
  "citecheck",
  "pipeline",
  "process",
  "trace",
]);

function isPipelineStageNode(node: UnknownRecord): boolean {
  const id = typeof node.id === "string" ? node.id.trim() : "";
  if (id.startsWith("audit:") || id.startsWith("trace:")) return true;
  if (id && PIPELINE_NODE_IDS.has(id)) return true;
  const type = typeof node.type === "string" ? node.type.toLowerCase().trim() : "";
  if (type && AUDIT_STAGE_NODE_TYPES.has(type)) return true;
  // Chinese stage labels emitted by the generator's decisionView:
  // 视觉识别 / 查询规划 / 法规检索 / 证据合成 / 报告生成 / 一致性校验 /
  // 合规校验 / 引用核对 / 流程节点
  const label = typeof node.label === "string" ? node.label.trim() : "";
  if (
    label.includes("视觉识别") ||
    label.includes("查询规划") ||
    label.includes("法规检索") ||
    label.includes("证据合成") ||
    label.includes("报告生成") ||
    label.includes("一致性校验") ||
    label.includes("一致性检查") ||
    label.includes("合规校验") ||
    label.includes("引用核对") ||
    label.includes("引用校验") ||
    label.includes("流程节点") ||
    label.toLowerCase().includes("consistency check") ||
    label.toLowerCase().includes("citation check")
  ) {
    return true;
  }
  return false;
}

function bboxFromNode(node: UnknownRecord): { x: number; y: number; w: number; h: number } | undefined {
  // Vision-anchored decision nodes carry a normalized 0..1 bbox keyed as
  // either `bbox` (camelCase) or `region` (legacy). Both are accepted; the
  // outer risk builder clamps them below to avoid the historical all-(0,0,0,0)
  // bug from audit P1-E.
  const candidate = record(node.bbox ?? node.region);
  const x = number(candidate.x, -1);
  const y = number(candidate.y, -1);
  const w = number(candidate.w ?? candidate.width, -1);
  const h = number(candidate.h ?? candidate.height, -1);
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

function buildRisks(
  result: UnknownRecord,
  reportPackage: UnknownRecord,
  sessionId: string,
): RiskPoint[] {
  const decision = record(reportPackage.decisionView);
  const nodes = records(decision.nodes).filter((node) => !isPipelineStageNode(node));
  const regulations = records(result.retrievedChunks).map(regulationFromChunk);

  return nodes.map((node, index) => {
    // Read node.severity (real risk enum) — distinct from node.status which
    // is pipeline execution state. Falls back to "info" for older payloads.
    const severity = severityFor(node.severity);
    const confidence = Math.max(0, Math.min(1, number(node.confidence, 0)));
    // Audit P1-E: read the bbox from the vision-anchored node when present.
    // Legacy / non-vision scans still fall through to the default zero box;
    // the result page hides hotspots with an all-zero bbox, so the UI is
    // unaffected when the backend never emits one.
    const bbox = bboxFromNode(node);
    // Feature 1: the backend tags vision hotspots with `vision-image-N`;
    // remap to the session image asset id (`{sessionId}-image-N`) so the
    // page's image lookup actually matches.
    const rawImageId = text(node.imageId);
    const visionMatch = /^vision-image-(\d+)$/.exec(rawImageId);
    const imageId = visionMatch
      ? `${sessionId}-image-${visionMatch[1]}`
      : rawImageId;
    return {
      riskId: text(node.id, `risk-${index + 1}`),
      title: text(node.label, text(node.type, `Risk ${index + 1}`)),
      titleEn: text(node.labelEn) || undefined,
      description: text(node.reasoning, text(decision.summary, "Backend decision evidence")),
      descriptionEn: text(node.reasoningEn) || undefined,
      severity,
      flameLevel: severity === "critical" ? 3 : severity === "warning" ? 2 : 1,
      confidence,
      imageId,
      bbox: bbox ?? { x: 0, y: 0, w: 0, h: 0 },
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

function documentTypeFromName(name: string, contentType: string): DocumentType {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".docx") || contentType.includes("wordprocessingml") || contentType.includes("msword")) {
    return "docx";
  }
  if (lowerName.endsWith(".html") || lowerName.endsWith(".htm") || contentType.includes("html")) {
    return "html";
  }
  return "pdf";
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
  const riskPoints = buildRisks(result, reportPackage, session.sessionId);
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

  // Audit P1-G: 200KB is well above any realistic compliance report
// (~30-50KB for the longest ones we've seen) and bounds memory pressure
// + XSS surface for an adversarial LLM that emits an unbounded markdown
// blob (which `<ReactMarkdown>` would otherwise parse verbatim). See also
// `MAX_COMPLIANCE_REPORT_BYTES` in `lib/constants.ts`.
const MAX_COMPLIANCE_REPORT_BYTES = 200 * 1024;

function truncateReport(report: string): { value: string; truncated: boolean } {
  if (report.length <= MAX_COMPLIANCE_REPORT_BYTES) {
    return { value: report, truncated: false };
  }
  return {
    value: `${report.slice(0, MAX_COMPLIANCE_REPORT_BYTES - 1)}…`,
    truncated: true,
  };
}

// De-RAG pipeline output: surface the real LLM-generated report markdown
  // and the real agent trace so the result page does not need to fall back
  // to the demo template. Both fields are optional in the contract (legacy
  // RAG payloads and demo sessions do not emit them) so we read defensively.
  const complianceReportRaw =
    text(result.complianceReport) ||
    text(reportPackage.complianceReport) ||
    text(record(reportPackage).compliance_report) ||
    "";
  const { value: complianceReport, truncated: complianceReportTruncated } =
    truncateReport(complianceReportRaw);
  const agentTrace = Array.isArray(result.agentTrace)
    ? (result.agentTrace as Array<{ node: string; [key: string]: unknown }>)
    : undefined;
  const ragProvider =
    text(record(reportPackage.auditMetadata).provider) ||
    text(result.ragProvider) ||
    undefined;
  const latencyMs = number(
    record(reportPackage.auditMetadata).latencyMs ??
      result.latencyMs ??
      record(result.modelInfo).latencyMs,
    0,
  );
  // Audit P0-B: the result page previously hard-coded loopCount to 0 because
  // the v1 adapter never surfaced it. We now extract it from auditMetadata
  // (set by the orchestrator's `trace_node_count` or refine-loop counter).
  const loopCount = number(
    record(reportPackage.auditMetadata).loopCount ??
      record(reportPackage.auditMetadata).loop_count ??
      result.loopCount ??
      0,
    0,
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
    documents: (session.assets ?? [])
      .filter((asset) => asset.kind === "document")
      .map((asset) => ({
        documentId: `${session.sessionId}-document-${asset.index}`,
        name: asset.name,
        size: asset.size,
        type: documentTypeFromName(asset.name, asset.contentType),
        mimeType: asset.contentType,
        url: `/api/scan/${session.sessionId}/asset/${asset.index}`,
      })),
    riskPoints,
    checklist: buildChecklist(reportPackage),
    generatedAt,
    reportPackage: result.reportPackage as ReportPackage | undefined,
    // Plan 2026-09-13 §6: checklist-mode scans carry v2 observations.
    // Remap imageId the same way riskPoints does (vision-image-N →
    // {sessionId}-image-N) so the checklist panel's image links match
    // the page's image asset ids.
    inspectionObservations: records(
      (reportPackage as UnknownRecord).observations,
    ).map((observation) => {
      const rawImageId = text(observation.imageId);
      const visionMatch = /^vision-image-(\d+)$/.exec(rawImageId);
      const mapped = visionMatch
        ? `${session.sessionId}-image-${visionMatch[1]}`
        : rawImageId || text(observation.imageIndex, "0");
      const imageId = /^vision-image-(\d+)$/.test(mapped)
        ? `${session.sessionId}-image-${mapped.replace(/^vision-image-/, "")}`
        : mapped;
      return {
        observationId: text(observation.observationId, `obs-${Math.random().toString(36).slice(2, 8)}`),
        checkId: text(observation.checkId),
        imageId,
        visibility: ((): InspectionObservation["visibility"] => {
          const value = text(observation.visibility);
          const allowed = [
            "present_readable",
            "present_unreadable",
            "not_in_view",
            "occluded",
            "absent_in_visible_scope",
            "not_assessed",
          ] as const;
          return (allowed as readonly string[]).includes(value)
            ? (value as InspectionObservation["visibility"])
            : "not_assessed";
        })(),
        observedText:
          typeof observation.observedText === "string" && observation.observedText.trim()
            ? observation.observedText.trim()
            : null,
        description: text(observation.description),
        region: (() => {
          const region = record(observation.region);
          if (!region.kind) return null;
          const bbox = record(region.bbox);
          const x = number(bbox.x, -1);
          const y = number(bbox.y, -1);
          const w = number(bbox.w ?? bbox.width, -1);
          const h = number(bbox.h ?? bbox.height, -1);
          if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
          return {
            kind: region.kind === "polygon" ? ("polygon" as const) : ("bbox" as const),
            coordinateSpace: "normalized_canonical_image" as const,
            bbox: { x, y, w, h },
            verified: region.verified === true,
          };
        })(),
      } satisfies InspectionObservation;
    }),
    selectedCheckIds: Array.isArray((reportPackage as UnknownRecord).selectedCheckIds)
      ? ((reportPackage as UnknownRecord).selectedCheckIds as unknown[]).map((id) => String(id))
      : undefined,
    // Plan §6 findings — deterministic, server-built. Enum-guarded so a
    // malformed package field can never fabricate a "confirmed_issue".
    inspectionFindings: records(
      (reportPackage as UnknownRecord).findings,
    )
      .filter((finding) => {
        const assessment = String(finding.assessment);
        return (
          assessment === "suspected_issue" ||
          assessment === "evidence_needed" ||
          assessment === "confirmed_issue"
        );
      })
      .map((finding) => ({
        findingId: text(finding.findingId, `finding-${Math.random().toString(36).slice(2, 8)}`),
        checkId: text(finding.checkId),
        title: text(finding.title, text(finding.checkId, "Finding")),
        assessment: String(finding.assessment) as InspectionFinding["assessment"],
        applicability: ((): InspectionFinding["applicability"] => {
          const value = text(finding.applicability);
          return value === "applicable" || value === "not_applicable" || value === "needs_confirmation"
            ? (value as InspectionFinding["applicability"])
            : "applicable";
        })(),
        severity: ((): InspectionFinding["severity"] => {
          const value = text(finding.severity).toLowerCase();
          const allowed = ["critical", "high", "medium", "low", "unknown"] as const;
          return (allowed as readonly string[]).includes(value)
            ? (value as InspectionFinding["severity"])
            : "unknown";
        })(),
        observationIds: Array.isArray(finding.observationIds)
          ? finding.observationIds.map((id) => String(id))
          : [],
        citationIds: Array.isArray(finding.citationIds)
          ? finding.citationIds.map((id) => String(id))
          : [],
        suggestedAction: text(finding.suggestedAction),
        requiredEvidence: Array.isArray(finding.requiredEvidence)
          ? finding.requiredEvidence.map((item) => String(item))
          : [],
      } satisfies InspectionFinding)),
    complianceReport: complianceReport || undefined,
    complianceReportTruncated,
    agentTrace,
    ragProvider,
    latencyMs,
    loopCount,
    modelInfo: {
      visionProvider: "minimax",
      latencyMs,
    },
    source: session.status === "degraded" ? "fallback" : "real",
  };
}
