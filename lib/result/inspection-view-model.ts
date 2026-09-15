/**
 * lib/result/inspection-view-model.ts
 *
 * Plan 2026-09-14 §4.3 — 统一结果契约 ViewModel（J03/J15）。
 *
 * The result page used to render every scene (hotspot overview, per-category
 * checklist, full report) from `result.riskPoints` — the legacy decisionView
 * shape — while the real checklist-mode data lives in
 * `result.inspectionObservations` / `result.inspectionFindings` +
 * `result.reportPackage.citations`. This module is the ONE entry point that
 * joins those entities with real foreign keys:
 *
 *   finding --observationIds--> observation --imageId--> image asset
 *                                      └--region--> normalized bbox
 *   finding --citationIds--> citation (deduped doc_id+article_id+quote span)
 *
 * Hard rules enforced here (plan §4.3):
 *   - Findings whose observations have NO region never contribute image
 *     hotspots; they stay list-only (`locatedObservations` only includes
 *     region-bearing observations). 无位置的文档缺口不能画热点。
 *   - citation `match_status` defaults to `unverified` when missing — never
 *     `matched` (J05: 不明项不宣称匹配).
 *   - `product.title` follows the fallback chain 结构化产品名 → 类别 label +
 *     （型号待确认）→ 未知产品 and can never be undefined/empty (J11).
 *   - All summary counts derive from the SAME entity sets (issueCount is
 *     literally `findings.length` after filtering — no separate counting
 *     path can drift from the rendered list).
 *   - Pure function, no side effects. Defensive narrowing mirrors
 *     v1-result-adapter's record/text/records helpers: a malformed stored
 *     session can never fabricate a finding/anchor.
 */

import type {
  InspectionFinding,
  InspectionObservation,
  ProductCategory,
  ScanResult,
} from "@/lib/types";

// ── Defensive narrowing (v1-result-adapter style) ─────────────────────────

type UnknownRecord = Record<string, unknown>;

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

function finiteNumber(value: unknown, fallback = -1): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ── VM type definitions ────────────────────────────────────────────────────

export interface ObservationVM {
  observationId: string;
  checkId: string;
  imageId: string;
  visibility: InspectionObservation["visibility"];
  observedText: string | null;
  description: string;
  /** Normalized bbox on the canonical image; null when the observation has
   *  no grounding (plan §6: region=None is a VALID state). */
  bbox: { x: number; y: number; w: number; h: number } | null;
  regionKind: "bbox" | "polygon" | null;
  regionVerified: boolean;
}

export interface LocatedAnchorVM {
  /** A renderable anchor: observation id + its imageId + a valid bbox. This
   *  is what the hotspot layer draws — only observations with a real region
   *  land here, never ungrounded findings. */
  observationId: string;
  findingId: string | null;
  checkId: string;
  imageId: string;
  bbox: { x: number; y: number; w: number; h: number };
  severity: InspectionFinding["severity"] | null;
  assessment: InspectionFinding["assessment"] | null;
  shortTitle: string;
}

export interface FindingVM {
  findingId: string;
  checkId: string;
  title: string;
  assessment: InspectionFinding["assessment"];
  applicability: InspectionFinding["applicability"];
  severity: InspectionFinding["severity"];
  suggestedAction: string;
  requiredEvidence: string[];
  citationIds: string[];
  /** The expanded observation rows, joined via observationIds. Observations
   *  that no longer exist in the package are simply dropped — a dangling
   *  foreign key must not fabricate an anchor. */
  observations: ObservationVM[];
  /** Located anchors derived from the observations above (region-bearing
   *  only). Empty for document-gap findings. */
  locatedAnchors: LocatedAnchorVM[];
}

export interface CheckResultVM {
  checkId: string;
  /** Business-facing title. Preference: finding title (server-side profile
   *  title) → the raw checkId's last segment. The full checkId stays in the
   *  `checkId` diagnostic field (J14: ID 收进诊断详情). */
  title: string;
  /** Best observation for this check (most visible one; same-image reads
   *  win, multi-image observations are all kept in `observations`). */
  bestObservation: ObservationVM | null;
  observations: ObservationVM[];
  findings: FindingVM[];
  /** Derived coverage state: observed / reshoot / confirm / not_assessed. */
  coverage: "observed" | "reshoot" | "confirm" | "not_assessed";
  hasLocatedAnchor: boolean;
}

export interface CitationVM {
  /** Stable dedupe key: docId + articleId + quote span (plan §4.4 —
   *  `(docId, articleId, quote/span)`; identical pairs with different quotes
   *  stay separate entries). */
  key: string;
  docId: string;
  articleId: string;
  officialCitation: string;
  quote: string;
  quoteSpan: [number, number] | null;
  /** Never defaults to matched — missing status reads as unverified (J05). */
  matchStatus: "matched" | "fallback_article_only" | "unmatched" | "unverified";
  /** How many raw entries collapsed into this VM citation. */
  duplicates: number;
}

export interface EvidenceRequestVM {
  id: string;
  /** Plan §5.3 EvidenceRequest.type — derived from the merged findings'
   *  requiredViews presence: photo views → "photo", otherwise "document"
   *  (lab/registration findings surface as documents). */
  type: "photo" | "document";
  title: string;
  explanation: string;
  /** The canonical view slot the user should shoot (e.g. nameplate_closeup). */
  requiredViews: string[];
  resolvesCheckIds: string[];
  status: "needed" | "uploaded" | "processing" | "accepted" | "insufficient";
  findingIds: string[];
}

export interface InspectionResultVM {
  product: {
    id: string;
    title: string;
    category: string;
    categoryKey: ProductCategory;
    markets: string[];
  };
  summary: {
    /** PASS / WARN / REJECTED / UNKNOWN — from decisionView.verdict with a
     *  findings-derived fallback. */
    status: string;
    /** suspected + confirmed findings (evidence_needed counted separately). */
    issueCount: number;
    evidenceNeededCount: number;
    observationCount: number;
    citationCount: number;
    /** 扫描结果修订版。后端暂无 revision 字段，固定 1；补证接口落地后
     *  从 result/reportPackage 读取。 */
    revision: number;
    /** true when the scan has observations but zero findings — the page
     *  renders "observation mode" instead of a risk verdict. */
    observationOnly: boolean;
  };
  images: Array<{ imageId: string; url: string; fileName: string }>;
  checks: CheckResultVM[];
  findings: FindingVM[];
  citations: CitationVM[];
  evidenceRequests: EvidenceRequestVM[];
  /** The full located-anchor set, keyed by imageId, for the hotspot layer.
   *  ONLY observations with a valid region appear here (J03: findings drive
   *  the image; no fabricated hotspots for document gaps). */
  anchorsByImage: Record<string, LocatedAnchorVM[]>;
}

export function buildInspectionResultViewModel(input: {
  result: ScanResult;
  sessionId: string;
}): InspectionResultVM {
  const { result, sessionId } = input;

  // ── Observations (defensively narrowed) ─────────────────────────────────
  const rawObservations = records(result.inspectionObservations);
  const observations: ObservationVM[] = rawObservations
    .map((observation) => {
      const region = record(observation.region);
      const bboxRecord = region.bbox === undefined ? null : record(region.bbox);
      // Same validity discipline as the v1 adapter: negative origin or
      // non-positive extent means "no usable grounding" — the observation
      // survives but never becomes an anchor.
      let bbox: { x: number; y: number; w: number; h: number } | null = null;
      if (bboxRecord) {
        const x = finiteNumber(bboxRecord.x, -1);
        const y = finiteNumber(bboxRecord.y, -1);
        const w = finiteNumber(bboxRecord.w ?? bboxRecord.width, -1);
        const h = finiteNumber(bboxRecord.h ?? bboxRecord.height, -1);
        if (x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.02 && y + h <= 1.02) {
          bbox = { x, y, w, h };
        }
      }
      const visibilityRaw = text(observation.visibility);
      const allowedVisibility = [
        "present_readable",
        "present_unreadable",
        "not_in_view",
        "occluded",
        "absent_in_visible_scope",
        "not_assessed",
      ] as const;
      const visibility = (allowedVisibility as readonly string[]).includes(visibilityRaw)
        ? (visibilityRaw as InspectionObservation["visibility"])
        : "not_assessed";
      return {
        observationId: text(observation.observationId, `obs-${sessionId}-${Math.random().toString(36).slice(2, 8)}`),
        checkId: text(observation.checkId),
        imageId: text(observation.imageId),
        visibility,
        observedText:
          typeof observation.observedText === "string" && observation.observedText.trim()
            ? observation.observedText.trim()
            : null,
        description: text(observation.description),
        bbox,
        regionKind:
          bbox && (region.kind === "polygon" ? ("polygon" as const) : ("bbox" as const)),
        regionVerified: region.verified === true,
      };
    })
    // Drop rows without a checkId — they can never join a finding.
    .filter((observation) => observation.checkId !== "");

  const observationById = new Map(observations.map((observation) => [observation.observationId, observation]));

  // ── Citations (deduped, snake_case contract) ────────────────────────────
  const reportPackage = record(result.reportPackage);
  const rawCitations = [
    ...records(reportPackage.citations),
    ...records(reportPackage.evidencePack ?? reportPackage.evidence_pack),
  ];
  const citations: CitationVM[] = [];
  const citationByKey = new Map<string, CitationVM>();
  for (const entry of rawCitations) {
    const docId = text(entry.doc_id ?? entry.docId);
    const articleId = text(entry.article_id ?? entry.articleId);
    if (docId === "" || articleId === "") continue;
    const quote = text(entry.quote);
    const spanRaw = entry.quote_span ?? entry.quoteSpan;
    const quoteSpan: [number, number] | null =
      Array.isArray(spanRaw) && spanRaw.length === 2
        ? [finiteNumber(spanRaw[0], -1), finiteNumber(spanRaw[1], -1)]
        : null;
    const validSpan = quoteSpan && quoteSpan[0] >= 0 && quoteSpan[1] > quoteSpan[0] ? quoteSpan : null;
    const key = citationKey(docId, articleId, validSpan);
    const existing = citationByKey.get(key);
    if (existing) {
      existing.duplicates += 1;
      // Keep the strongest claim of verification among duplicates: an exact
      // match on any duplicate wins over a fallback/unverified sibling.
      const status = matchStatusOf(entry);
      if (STATUS_STRENGTH[status] > STATUS_STRENGTH[existing.matchStatus]) {
        existing.matchStatus = status;
      }
      // Same doc/article without a verbatim span: prefer the LONGEST quote
      // (backend discipline — build_evidence_pack keeps the most
      // informative paraphrase).
      if (quote.length > existing.quote.length) {
        existing.quote = quote;
      }
      if (!existing.quoteSpan && validSpan) existing.quoteSpan = validSpan;
      continue;
    }
    const citation: CitationVM = {
      key,
      docId,
      articleId,
      officialCitation: text(entry.official_citation ?? entry.officialCitation),
      quote,
      quoteSpan: validSpan,
      matchStatus: matchStatusOf(entry),
      duplicates: 1,
    };
    citations.push(citation);
    citationByKey.set(key, citation);
  }

  // ── Findings (expanded with real observation foreign keys) ──────────────
  const rawFindings = records(result.inspectionFindings).filter((finding) => {
    const assessment = text(finding.assessment);
    return (
      assessment === "suspected_issue" ||
      assessment === "evidence_needed" ||
      assessment === "confirmed_issue"
    );
  });
  const severityOf = (finding: UnknownRecord): InspectionFinding["severity"] => {
    const value = text(finding.severity).toLowerCase();
    const allowed = ["critical", "high", "medium", "low", "unknown"] as const;
    return (allowed as readonly string[]).includes(value)
      ? (value as InspectionFinding["severity"])
      : "unknown";
  };
  const findings: FindingVM[] = rawFindings.map((finding) => {
    const assessment = text(finding.assessment) as InspectionFinding["assessment"];
    const rawObservationIds = Array.isArray(finding.observationIds)
      ? finding.observationIds.map((id) => String(id))
      : [];
    const joined = rawObservationIds
      .map((id) => observationById.get(id))
      .filter((observation): observation is ObservationVM => Boolean(observation));
    const shortTitle = shortCheckTitle(text(finding.title, text(finding.checkId, "Finding")));
    const locatedAnchors: LocatedAnchorVM[] = joined
      .filter((observation) => observation.bbox !== null && observation.imageId !== "")
      .map((observation) => ({
        observationId: observation.observationId,
        findingId: text(finding.findingId),
        checkId: observation.checkId,
        imageId: observation.imageId,
        bbox: observation.bbox!,
        severity: severityOf(finding),
        assessment,
        shortTitle,
      }));
    return {
      findingId: text(finding.findingId, `finding-${sessionId}-${Math.random().toString(36).slice(2, 8)}`),
      checkId: text(finding.checkId),
      title: text(finding.title, text(finding.checkId, "Finding")),
      assessment,
      applicability: ((): InspectionFinding["applicability"] => {
        const value = text(finding.applicability);
        return value === "applicable" || value === "not_applicable" || value === "needs_confirmation"
          ? (value as InspectionFinding["applicability"])
          : "applicable";
      })(),
      severity: severityOf(finding),
      suggestedAction: text(finding.suggestedAction),
      requiredEvidence: Array.isArray(finding.requiredEvidence)
        ? finding.requiredEvidence.map((item) => String(item))
        : [],
      citationIds: Array.isArray(finding.citationIds)
        ? finding.citationIds.map((id) => String(id))
        : [],
      observations: joined,
      locatedAnchors,
    };
  });

  // ── Checks (one row per check; best observation + aggregated findings) ──
  // Defensive narrowing: a malformed session could stuff non-string ids into
  // selectedCheckIds (e.g. a stray number). Only real non-empty strings can
  // become check rows — "42" must never surface as a check id.
  const selectedCheckIds = Array.isArray(result.selectedCheckIds)
    ? result.selectedCheckIds.filter(
        (id): id is string => typeof id === "string" && id.trim() !== "",
      )
    : [];
  const findingsByCheck = new Map<string, FindingVM[]>();
  for (const finding of findings) {
    const list = findingsByCheck.get(finding.checkId) ?? [];
    list.push(finding);
    findingsByCheck.set(finding.checkId, list);
  }
  const observationsByCheck = new Map<string, ObservationVM[]>();
  for (const observation of observations) {
    const list = observationsByCheck.get(observation.checkId) ?? [];
    list.push(observation);
    observationsByCheck.set(observation.checkId, list);
  }
  const checkIds: string[] = [];
  for (const id of observationsByCheck.keys()) checkIds.push(id);
  for (const id of findingsByCheck.keys()) {
    if (!checkIds.includes(id)) checkIds.push(id);
  }
  for (const id of selectedCheckIds) {
    if (!checkIds.includes(id)) checkIds.push(id);
  }
  const checks: CheckResultVM[] = checkIds.map((checkId) => {
    const checkObservations = observationsByCheck.get(checkId) ?? [];
    const checkFindings = findingsByCheck.get(checkId) ?? [];
    const bestObservation = pickBestObservation(checkObservations);
    const titleSource = checkFindings[0]?.title;
    return {
      checkId,
      title: titleSource ? shortCheckTitle(titleSource) : checkTitleFromId(checkId),
      bestObservation,
      observations: checkObservations,
      findings: checkFindings,
      coverage: coverageOf(bestObservation),
      hasLocatedAnchor: checkFindings.some(
        (finding) => finding.locatedAnchors.length > 0,
      ) || (bestObservation?.bbox ?? null) !== null,
    };
  });

  // ── Anchors by image (J03: findings drive the image) ─────────────────────
  const anchorsByImage: Record<string, LocatedAnchorVM[]> = {};
  for (const finding of findings) {
    for (const anchor of finding.locatedAnchors) {
      const list = anchorsByImage[anchor.imageId] ?? [];
      list.push(anchor);
      anchorsByImage[anchor.imageId] = list;
    }
  }
  // Observations without a finding still carry value — draw their region too
  // when a selected check produced a located, non-readable observation (the
  // user needs to see WHERE the blurred label was). These anchors are
  // findingless; the layer renders them in a neutral tone.
  const findingAnchorObservationIds = new Set(
    findings.flatMap((finding) => finding.locatedAnchors.map((anchor) => anchor.observationId)),
  );
  for (const observation of observations) {
    if (observation.bbox === null || observation.imageId === "") continue;
    if (findingAnchorObservationIds.has(observation.observationId)) continue;
    const related = findingsByCheck.get(observation.checkId) ?? [];
    const list = anchorsByImage[observation.imageId] ?? [];
    list.push({
      observationId: observation.observationId,
      findingId: null,
      checkId: observation.checkId,
      imageId: observation.imageId,
      bbox: observation.bbox,
      severity: related[0]?.severity ?? null,
      assessment: related[0]?.assessment ?? null,
      shortTitle: related[0] ? shortCheckTitle(related[0].title) : checkTitleFromId(observation.checkId),
    });
    anchorsByImage[observation.imageId] = list;
  }

  // ── Evidence requests (merge by requiredViews, plan §5.3) ────────────────
  const evidenceRequests = buildEvidenceRequests(findings, sessionId);

  // ── Product (fallback chain, never undefined) ─────────────────────────────
  const dossier = record(reportPackage.productDossier ?? reportPackage.product_dossier);
  let rawName =
    text(result.productName) ||
    text(dossier.productName ?? dossier.product_name) ||
    text(dossier.product);
  if (rawName === "产品" || rawName === "product" || rawName === "undefined") {
    rawName = "";
  }
  const observedName = rawName ? null : extractProductTitleFromObservations(observations);
  const structuredName = rawName || observedName || "";
  const category = text(result.productCategory, "other") as ProductCategory;
  const categoryLabel = CATEGORY_LABELS[category] ?? "其他";
  const productTitle =
    structuredName !== ""
      ? structuredName
      : `${categoryLabel}（型号待确认）`;
  const markets = Array.isArray(result.targetMarkets)
    ? result.targetMarkets.map((market) => String(market))
    : [];

  // ── Summary (all counts from the same entity sets) ───────────────────────
  const decision = record(reportPackage.decisionView ?? reportPackage.decision_view);
  const verdict = text(decision.verdict).toUpperCase();
  const status = (["PASS", "WARN", "REJECTED", "UNKNOWN"] as const).includes(
    verdict as "PASS" | "WARN" | "REJECTED" | "UNKNOWN",
  )
    ? verdict
    : findings.some((finding) => finding.assessment === "confirmed_issue")
      ? "REJECTED"
      : findings.some((finding) => finding.assessment === "suspected_issue")
        ? "WARN"
        : "UNKNOWN";
  const issueCount = findings.filter(
    (finding) => finding.assessment === "suspected_issue" || finding.assessment === "confirmed_issue",
  ).length;
  const evidenceNeededCount = findings.filter(
    (finding) => finding.assessment === "evidence_needed",
  ).length;

  return {
    product: {
      id: sessionId,
      title: productTitle,
      category: categoryLabel,
      categoryKey: category,
      markets,
    },
    summary: {
      status,
      issueCount,
      evidenceNeededCount,
      observationCount: observations.length,
      citationCount: citations.length,
      revision: 1,
      observationOnly: findings.length === 0 && observations.length > 0,
    },
    images: (Array.isArray(result.images) ? result.images : []).map((image) => ({
      imageId: image.imageId,
      url: image.url,
      fileName: image.fileName ?? "",
    })),
    checks,
    findings,
    citations,
    evidenceRequests,
    anchorsByImage,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

const STATUS_STRENGTH: Record<CitationVM["matchStatus"], number> = {
  matched: 3,
  fallback_article_only: 2,
  unmatched: 1,
  unverified: 0,
};

function matchStatusOf(entry: UnknownRecord): CitationVM["matchStatus"] {
  const value = text(entry.match_status ?? entry.matchStatus).toLowerCase();
  if (value === "matched" || value === "fallback_article_only" || value === "unmatched") {
    return value;
  }
  // J05: a missing status is NOT matched evidence.
  return "unverified";
}

/**
 * Citation dedupe key (plan §4.4). With a VERBATIM span the anchor is a
 * specific position in the article, so doc+article+span identifies it;
 * without a span the entries are paraphrases of the SAME statute entity and
 * collapse by doc+article alone (backend build_evidence_pack discipline —
 * the longest/most informative quote wins).
 */
function citationKey(docId: string, articleId: string, validSpan: [number, number] | null): string {
  return validSpan
    ? `${docId}::${articleId}::span=${validSpan[0]},${validSpan[1]}`
    : `${docId}::${articleId}`;
}

/** Visibility ranking for "best observation": the most informative read wins;
 *  same-informativeness ties keep the first (stable). */
const VISIBILITY_RANK: Record<InspectionObservation["visibility"], number> = {
  present_readable: 0,
  absent_in_visible_scope: 1,
  present_unreadable: 2,
  occluded: 3,
  not_in_view: 4,
  not_assessed: 5,
};

function pickBestObservation(observations: ObservationVM[]): ObservationVM | null {
  let best: ObservationVM | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  // Prefer located observations (they can drive the image stage); then by
  // visibility informativeness.
  for (const observation of observations) {
    const rank = VISIBILITY_RANK[observation.visibility] + (observation.bbox ? -0.5 : 0);
    if (rank < bestRank) {
      best = observation;
      bestRank = rank;
    }
  }
  return best;
}

function coverageOf(
  observation: ObservationVM | null,
): CheckResultVM["coverage"] {
  if (!observation) return "not_assessed";
  switch (observation.visibility) {
    case "present_readable":
      return "observed";
    case "present_unreadable":
    case "not_in_view":
    case "occluded":
      return "reshoot";
    case "absent_in_visible_scope":
      return "confirm";
    default:
      return "not_assessed";
  }
}

/** Business title from the checkId's last segment (client fallback when no
 *  profile title exists). The full checkId is kept on the VM for diagnostics
 *  (J14: 技术字段收进诊断详情，不再直接露出). */
export function checkTitleFromId(checkId: string): string {
  const segment = checkId.split(".").slice(-1)[0] ?? checkId;
  return segment.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Trim a server-provided title for hotspot/anchor labels (short label). */
function shortCheckTitle(title: string): string {
  return title.length > 24 ? `${title.slice(0, 23)}…` : title;
}

const CATEGORY_LABELS: Record<string, string> = {
  electronics: "3C 电子",
  "3c": "3C 电子",
  appliance: "家电",
  toy: "玩具",
  home: "家居",
  battery: "电池/储能",
  cosmetic: "化妆品",
  textile: "纺织服装",
  food_contact: "食品接触",
  other: "其他",
};

/**
 * Plan §5.3 — merge evidence_needed findings that ask for the SAME view set
 * into ONE request. Deferred materials (lab_test / registration style
 * findings, i.e. no view slots) merge by their document-ish nature: same
 * empty view set groups them, but each keeps its own title in the merged
 * explanation only when unique. Output ordering is stable (first-seen).
 */
function buildEvidenceRequests(findings: FindingVM[], sessionId: string): EvidenceRequestVM[] {
  const groups = new Map<string, EvidenceRequestVM & { firstIndex: number }>();
  findings.forEach((finding, index) => {
    if (finding.assessment !== "evidence_needed") return;
    const views = requiredViewsOf(finding);
    // Group key: the exact view set (sorted, deduped). Findings without view
    // slots (待补资料) group by their requiredEvidence list so different
    // documents don't collapse into one "材料" request.
    const groupKey =
      views.length > 0
        ? `views:${[...views].sort().join("|")}`
        : `materials:${[...new Set(finding.requiredEvidence)].sort().join("|")}`;
    const existing = groups.get(groupKey);
    if (existing) {
      if (!existing.resolvesCheckIds.includes(finding.checkId)) {
        existing.resolvesCheckIds.push(finding.checkId);
      }
      if (!existing.findingIds.includes(finding.findingId)) {
        existing.findingIds.push(finding.findingId);
      }
      // Explanation: prefer the longest suggested action — it usually carries
      // the concrete shooting/material guidance.
      if (finding.suggestedAction.length > existing.explanation.length) {
        existing.explanation = finding.suggestedAction;
      }
      if (views.length > 0 && views.some((view) => !existing.requiredViews.includes(view))) {
        existing.requiredViews = [...new Set([...existing.requiredViews, ...views])];
      }
      return;
    }
    groups.set(groupKey, {
      id: `evidence-${sessionId}-${groups.size + 1}`,
      type: views.length > 0 ? "photo" : "document",
      title: views.length > 0 ? viewSlotTitle(views) : finding.title,
      explanation: finding.suggestedAction,
      requiredViews: [...views],
      resolvesCheckIds: finding.checkId ? [finding.checkId] : [],
      status: "needed",
      findingIds: [finding.findingId],
      firstIndex: index,
    });
  });
  return [...groups.values()]
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((group) => {
      const { firstIndex, ...rest } = group;
      void firstIndex; // sort-only metadata, not part of the output contract
      return rest;
    });
}

/** requiredViews are embedded by the backend inside requiredEvidence strings
 *  as 「补拍视角：a、b」(findings_builder._VISIBILITY_RULES). Parse them out;
 *  direct view arrays are not in the frontend contract today. */
function requiredViewsOf(finding: FindingVM): string[] {
  const views: string[] = [];
  for (const evidence of finding.requiredEvidence) {
    const match = /补拍视角[：:]\s*(.+)$/.exec(evidence);
    if (!match) continue;
    for (const slot of match[1].split(/[、,，/]/)) {
      const trimmed = slot.trim();
      if (trimmed && trimmed !== "该区域" && !views.includes(trimmed)) {
        views.push(trimmed);
      }
    }
  }
  return views;
}

function viewSlotTitle(views: string[]): string {
  const zh = {
    nameplate_closeup: "铭牌/标签近照",
    ports_closeup: "接口近照",
    plug_closeup: "插头近照",
    cable_closeup: "线缆近照",
    adapter_closeup: "适配器近照",
    front: "产品正面照",
    back: "产品背面照",
    side: "产品侧面照",
    package: "包装照",
    package_front: "包装正面照",
    warning_label: "警告标签照",
    manual: "说明书页",
    battery_compartment: "电池仓照片",
    accessories_flat: "附件平铺照",
    overall: "整体照",
  } as Record<string, string>;
  const parts = views.map((view) => zh[view] ?? view);
  return parts.length === 1 ? `补拍：${parts[0]}` : `补拍：${parts.slice(0, 3).join("、")}${parts.length > 3 ? ` 等 ${parts.length} 个视角` : ""}`;
}

/**
 * Selection helper used by the result page: given a check/finding id, find
 * the imageId + observation the stage should switch to. Returns null when
 * nothing is located (the click then only opens the list detail).
 */
export function resolveSelectionFromCheck(
  vm: InspectionResultVM,
  checkId: string,
): { imageId: string; observationId: string } | null {
  const check = vm.checks.find((item) => item.checkId === checkId);
  if (!check) return null;
  const findingAnchor = check.findings
    .flatMap((finding) => finding.locatedAnchors)
    .find((anchor) => anchor.imageId !== "");
  if (findingAnchor) {
    return { imageId: findingAnchor.imageId, observationId: findingAnchor.observationId };
  }
  const observationAnchor = check.observations.find(
    (observation) => observation.bbox !== null && observation.imageId !== "",
  );
  if (observationAnchor) {
    return { imageId: observationAnchor.imageId, observationId: observationAnchor.observationId };
  }
  return null;
}

export function resolveSelectionFromFinding(
  vm: InspectionResultVM,
  findingId: string,
): { imageId: string; observationId: string } | null {
  const finding = vm.findings.find((item) => item.findingId === findingId);
  if (!finding) return null;
  const anchor = finding.locatedAnchors.find((item) => item.imageId !== "");
  if (anchor) return { imageId: anchor.imageId, observationId: anchor.observationId };
  const observation = finding.observations.find(
    (item) => item.bbox !== null && item.imageId !== "",
  );
  return observation
    ? { imageId: observation.imageId, observationId: observation.observationId }
    : null;
}

/** Exported for tests + future consumers: finding → observation join used by
 *  the report exports (same revision discipline). */
export function findingsForObservation(vm: InspectionResultVM, observationId: string): FindingVM[] {
  return vm.findings.filter((finding) =>
    finding.observations.some((observation) => observation.observationId === observationId),
  );
}

/**
 * Extract clean product title from high-confidence observations (nameplate/packaging/brand).
 * Avoids falling back to generic "品类（型号待确认）" when the vision model clearly read the product.
 */
function extractProductTitleFromObservations(observations: ObservationVM[]): string | null {
  // 1. Check common.nameplate.readability
  const nameplateObs = observations.find((obs) => obs.checkId === "common.nameplate.readability");
  if (nameplateObs?.observedText) {
    const raw = nameplateObs.observedText.trim();
    // Pattern A: "Name: ... Model: ..." (e.g. Xiaomi)
    const nameModelMatch = raw.match(
      /(?:Name|品名|名称)[:：]\s*([^|,\n\r]+).*?(?:Model|型号)[:：]\s*([A-Za-z0-9_-]+)/i,
    );
    if (nameModelMatch) {
      const cleanName = nameModelMatch[1].trim();
      const cleanModel = nameModelMatch[2].trim();
      return `${cleanName} (${cleanModel})`;
    }
    // Pattern B: "Anker 535 Charger (65W) 充电器 型号: A2332"
    const ankerMatch = raw.match(
      /^(.*?)(?:[，,\s]+)?(?:型号|Model)[:：]\s*([A-Za-z0-9_-]+)/i,
    );
    if (ankerMatch) {
      const pName = ankerMatch[1].trim();
      const mName = ankerMatch[2].trim();
      if (pName.length >= 2 && pName.length <= 60) {
        return pName.includes(mName) ? pName : `${pName} ${mName}`;
      }
      return mName;
    }
    // Pattern C: slash-separated title (e.g. LEGO / Harry Potter / Talking Sorting Hat / 76429 / 561 pcs)
    if (raw.includes(" / ")) {
      const segments = raw.split(" / ").map((s) => s.trim()).filter(Boolean);
      const filtered = segments.filter(
        (s) =>
          !s.toLowerCase().includes("building set") &&
          !s.toLowerCase().includes("ensemble") &&
          !s.toLowerCase().includes("pcs"),
      );
      if (filtered.length >= 2) {
        return filtered.slice(0, 3).join(" ");
      }
    }
    // Pattern D: first meaningful phrase before "输入:" or newline
    const firstPhrase = raw.split(/(?:输入|input|output|输出|rated|额定|made in|制造|sn|s\/n|[\r\n|])/i)[0].trim();
    if (firstPhrase && firstPhrase.length >= 3 && firstPhrase.length <= 50) {
      return firstPhrase;
    }
  }

  // 2. Check common.packaging.info (e.g. "Xiaomi Smart Kettle 2 Pro | 1800W...")
  const packObs = observations.find((obs) => obs.checkId === "common.packaging.info");
  if (packObs?.observedText) {
    const raw = packObs.observedText.trim();
    const firstPart = raw.split(/[|,\n\r]/)[0].trim();
    if (firstPart && firstPart.length >= 3 && firstPart.length <= 50) {
      return firstPart;
    }
  }

  // 3. Check common.brand_model.visible (e.g. "LEGO, 76429, 561 pcs/pzs")
  const brandObs = observations.find((obs) => obs.checkId === "common.brand_model.visible");
  if (brandObs?.observedText) {
    const raw = brandObs.observedText.trim();
    const parts = raw
      .split(/[,\n\r]/)
      .map((p) => p.trim())
      .filter((p) => p && !p.toLowerCase().includes("pcs"));
    if (parts.length > 0) {
      const combined = parts.slice(0, 2).join(" ");
      if (combined.length >= 3 && combined.length <= 50) {
        return combined;
      }
    }
  }

  return null;
}
