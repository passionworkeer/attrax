"""Pydantic schemas and normalization helpers for unified report packages."""
from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


SCHEMA_VERSION = "report-package/v1"


class FlexibleModel(BaseModel):
    """Allow frontend-owned fields while validating the core contract."""

    model_config = ConfigDict(extra="allow")


class ProductDossier(FlexibleModel):
    product: str = ""
    category: str = ""
    markets: list[str] = Field(default_factory=list)
    query: str = ""
    sourceCounts: dict[str, int] = Field(default_factory=dict)

    @field_validator("markets", mode="before")
    @classmethod
    def coerce_markets(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            return [m.strip() for m in value.split(",") if m.strip()]
        if isinstance(value, list):
            return [str(m).strip() for m in value if str(m).strip()]
        return []


class FinancialCostSummary(BaseModel):
    """Per-unit finance values that may drive the detailed profit board."""

    bom: float
    packaging: float
    cert: float
    epr: float
    logistics: float
    warranty: float
    asp: float
    total: float
    gp: float

    @field_validator("bom", "packaging", "cert", "epr", "logistics", "warranty", "asp", "total", "gp", mode="before")
    @classmethod
    def require_finite_non_negative_number(cls, value: Any) -> float:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value < 0:
            raise ValueError("must be a finite non-negative number")
        return float(value)

    @model_validator(mode="after")
    def require_margin_identity(self) -> "FinancialCostSummary":
        if abs((self.asp - self.total) - self.gp) > 0.01:
            raise ValueError("asp - total must equal gp within currency rounding tolerance")
        return self


class FinancialCostComparison(BaseModel):
    barebone: FinancialCostSummary
    compliant: FinancialCostSummary


class StructuredProfitFields(FlexibleModel):
    """Optional extension fields; structured finance is strict when supplied."""

    currency: str
    costComparison: FinancialCostComparison

    @field_validator("currency")
    @classmethod
    def require_iso_currency(cls, value: str) -> str:
        value = str(value or "").upper()
        if len(value) != 3 or not value.isalpha():
            raise ValueError("must be a three-letter ISO currency code")
        return value


class ProfitReport(FlexibleModel):
    markdown: str
    keyConclusion: str = ""
    premiumPct: str = ""
    breakevenUnits: str = ""
    pricingStrategy: str = ""
    riskNote: str = ""
    conclusions: str = ""
    references: str = ""
    structuredFields: StructuredProfitFields | None = None


class RoadmapItem(FlexibleModel):
    id: str
    date: str = ""
    title: str = ""
    titleEn: str = ""
    description: str = ""
    descriptionEn: str = ""
    type: str = "complete"
    status: str = "pending"
    estimatedDays: int = 0
    cost: str = ""
    documents: list[str] = Field(default_factory=list)
    documentsEn: list[str] = Field(default_factory=list)

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, value: Any) -> str:
        return str(value or "")


class Roadmap(FlexibleModel):
    totalDays: int = 0
    totalCost: str = ""
    progress: int = 0
    items: list[RoadmapItem] = Field(default_factory=list)

    @field_validator("progress")
    @classmethod
    def clamp_progress(cls, value: int) -> int:
        return max(0, min(100, value))


class DecisionNode(FlexibleModel):
    id: str
    type: str = ""
    label: str = ""
    labelEn: str = ""
    status: str = "pending"
    duration: str = ""
    confidence: float | None = None
    reasoning: str = ""
    reasoningEn: str = ""

    @field_validator("id", mode="before")
    @classmethod
    def coerce_id(cls, value: Any) -> str:
        return str(value or "")

    @field_validator("confidence", mode="before")
    @classmethod
    def coerce_confidence(cls, value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None


class DecisionView(FlexibleModel):
    summary: str = ""
    keyFindings: list[str] = Field(default_factory=list)
    recommendedAction: str = ""
    nodes: list[DecisionNode] = Field(default_factory=list)
    verdict: str = ""
    riskLevel: str = ""


class EvidenceItem(FlexibleModel):
    id: str
    layer: Literal["visual", "retrieval", "generation", "audit"]
    source: str = ""
    title: str = ""
    content: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class CitationRef(FlexibleModel):
    """Per-claim citation to a specific article in a regulation.

    Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §3.3 + §4.

    `quote_span` is populated by `quote_matcher.match_quote` AFTER the LLM
    returns its output — the LLM only fills `quote`. Front-end uses
    `quote_span` to render `<mark>` highlighting on the document viewer
    page (§4.4).

    `match_status` is a three-state enumeration (spec §4.3):
      - matched                — `quote` is found verbatim (or whitespace-normalized)
                                in the article text; `quote_span` is set.
      - fallback_article_only  — article exists but quote doesn't match; chip
                                navigates to the article but no highlight.
      - unmatched              — article id is unknown; chip is flagged ✗.
    """
    doc_id: str
    article_id: str
    official_citation: str = ""
    quote: str = ""
    quote_span: tuple[int, int] | None = None
    match_status: Literal["matched", "fallback_article_only", "unmatched"] | None = None


class EvidenceBundles(FlexibleModel):
    visual: list[EvidenceItem] = Field(default_factory=list)
    retrieval: list[EvidenceItem] = Field(default_factory=list)
    generation: list[EvidenceItem] = Field(default_factory=list)


class FinanceValidation(FlexibleModel):
    """Per-sub-report validation, surfaced separately from the package-level
    `validationStatus` so a malformed sub-report (e.g. bad currency arithmetic
    in profit/finance) does NOT downgrade the whole compliance package. The
    profit page reads `finance.validationStatus` to render its own notice.

    Audit P0-D: extended the same pattern to decisionView/roadmap/
    evidenceBundles — previously only finance had isolation, so a missing
    decisionView node could still flip the package to "invalid" and trigger
    the red `DegradedBanner`.
    """

    validationStatus: Literal["valid", "invalid"] = "valid"
    errors: list[str] = Field(default_factory=list)


class SubReportValidation(FlexibleModel):
    """Per-scene validation tracker for `decisionView`, `roadmap`, and
    `evidenceBundles`. Mirrors `FinanceValidation` so a malformed sub-scene
    surfaces as a warning without downgrading the whole package (audit P0-D).
    """

    validationStatus: Literal["valid", "invalid"] = "valid"
    errors: list[str] = Field(default_factory=list)


class AuditMetadata(FlexibleModel):
    schemaVersion: str = SCHEMA_VERSION
    generatedAt: str
    validationStatus: Literal["normalized", "fallback", "invalid"] = "normalized"
    validationErrors: list[str] = Field(default_factory=list)
    provider: str = ""
    traceNodeCount: int = 0
    finance: FinanceValidation = Field(default_factory=FinanceValidation)
    decisionView: SubReportValidation = Field(default_factory=SubReportValidation)
    roadmap: SubReportValidation = Field(default_factory=SubReportValidation)
    evidenceBundles: SubReportValidation = Field(default_factory=SubReportValidation)


class ReportPackage(FlexibleModel):
    productDossier: ProductDossier
    complianceReport: str
    profitReport: ProfitReport
    roadmap: Roadmap
    decisionView: DecisionView
    evidenceBundles: EvidenceBundles
    auditMetadata: AuditMetadata
    # Spec §3.3 + §7.3: per-claim citation list. Each entry maps a
    # compliance claim back to a specific article in the regulation
    # library (doc_id + article_id) with a verbatim quote. The LLM
    # fills `quote`; `quote_span` and `match_status` are filled
    # post-LLM by `verify/quote_matcher.py`.
    citations: list[CitationRef] = Field(default_factory=list)
    # De-duplicated superset of `citations` used by the evidence-pack
    # export (spec §7.6). One entry per (doc_id, article_id); if the
    # LLM cited the same article multiple times, only one copy appears
    # here. Empty until the quote_matcher dedup pass (§7.4).
    evidencePack: list[CitationRef] = Field(default_factory=list)

    @field_validator("complianceReport")
    @classmethod
    def require_report_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("complianceReport must not be empty")
        return text


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _market_list(market: str | list[str]) -> list[str]:
    if isinstance(market, list):
        return [str(m).strip() for m in market if str(m).strip()]
    return [m.strip() for m in str(market or "").split(",") if m.strip()]


def _short_text(value: Any, limit: int = 700) -> str:
    text = str(value or "").strip().replace("\x00", "")
    return text[:limit]


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_roadmap(value: Any) -> dict:
    roadmap = _as_dict(value).copy()
    roadmap["totalDays"] = _coerce_int(roadmap.get("totalDays"))
    roadmap["progress"] = _coerce_int(roadmap.get("progress"))
    if not isinstance(roadmap.get("items"), list):
        roadmap["items"] = []
    for item in roadmap["items"]:
        if isinstance(item, dict):
            item["estimatedDays"] = _coerce_int(item.get("estimatedDays"))
    return roadmap


def _normalize_decision(value: Any) -> dict:
    decision = _as_dict(value).copy()
    if not isinstance(decision.get("keyFindings"), list):
        decision["keyFindings"] = []
    if not isinstance(decision.get("nodes"), list):
        decision["nodes"] = []
    return decision


def _build_evidence_bundles(
    chunks: list[dict],
    vision_result: dict | None = None,
    agent_trace: list[dict] | None = None,
    user_documents: list[dict] | None = None,
    compliance_report: str = "",
    generated_package: dict | None = None,
) -> EvidenceBundles:
    visual: list[EvidenceItem] = []
    retrieval: list[EvidenceItem] = []
    generation: list[EvidenceItem] = []

    vision = _as_dict(vision_result)
    if vision:
        visual.append(
            EvidenceItem(
                id="visual:result",
                layer="visual",
                source="vision_result",
                title=str(vision.get("product") or vision.get("label") or "Vision analysis"),
                content=_short_text(vision.get("summary") or vision.get("description") or vision),
                metadata={k: v for k, v in vision.items() if k not in {"summary", "description"}},
            )
        )

    for idx, chunk in enumerate(chunks[:24]):
        if not isinstance(chunk, dict):
            continue
        retrieval.append(
            EvidenceItem(
                id=str(chunk.get("id") or f"retrieval:{idx + 1}"),
                layer="retrieval",
                source=str(chunk.get("doc_name") or chunk.get("source") or "retrieved_chunk"),
                title=str(chunk.get("article_no") or chunk.get("title") or chunk.get("doc_name") or ""),
                content=_short_text(chunk.get("content")),
                metadata={
                    key: chunk.get(key)
                    for key in ("market", "product", "score", "rank", "url")
                    if key in chunk
                },
            )
        )

    for idx, doc in enumerate(_as_list(user_documents)[:12]):
        if not isinstance(doc, dict):
            continue
        retrieval.append(
            EvidenceItem(
                id=f"user_doc:{idx + 1}",
                layer="retrieval",
                source="user_document",
                title=str(doc.get("name") or "uploaded document"),
                content=_short_text(doc.get("text")),
                metadata={"mime_type": doc.get("mime_type", "")},
            )
        )

    generation.append(
        EvidenceItem(
            id="generation:compliance_report",
            layer="generation",
            source="report_generator",
            title="Compliance report draft",
            content=_short_text(compliance_report, limit=1200),
            metadata={"characterCount": len(compliance_report or "")},
        )
    )
    package = _as_dict(generated_package)
    if package:
        generation.append(
            EvidenceItem(
                id="generation:package_keys",
                layer="generation",
                source="report_package",
                title="Generated package keys",
                content=", ".join(sorted(str(k) for k in package.keys())),
                metadata={"sceneCount": len(package)},
            )
        )

    for idx, trace in enumerate(_as_list(agent_trace)[-12:]):
        if not isinstance(trace, dict):
            continue
        generation.append(
            EvidenceItem(
                id=f"audit:trace:{idx + 1}",
                layer="audit",
                source=str(trace.get("node") or "agent_trace"),
                title=str(trace.get("status") or trace.get("node") or "trace"),
                content=_short_text(trace.get("error") or trace.get("message") or trace),
                metadata=trace,
            )
        )

    return EvidenceBundles(visual=visual, retrieval=retrieval, generation=generation)


def _normalize_citations(value: Any) -> list[dict]:
    """Normalize LLM `citations` output to a list of dict-shaped CitationRef.

    The LLM is asked for an array of objects with at minimum
    {doc_id, article_id, quote}. Optional fields (official_citation,
    quote_span, match_status) default to safe values. Invalid entries
    are dropped rather than rejected — a malformed citation should
    never block report delivery; it just won't render a chip.
    """
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        doc_id = str(entry.get("doc_id") or entry.get("docId") or "").strip()
        article_id = str(entry.get("article_id") or entry.get("articleId") or "").strip()
        if not doc_id or not article_id:
            continue
        out.append({
            "doc_id": doc_id,
            "article_id": article_id,
            "official_citation": str(entry.get("official_citation") or entry.get("officialCitation") or "").strip(),
            "quote": str(entry.get("quote") or "").strip(),
            # quote_span and match_status are populated by the
            # quote_matcher pass (§7.4); default to None here so the
            # Pydantic model accepts the dict.
            "quote_span": None,
            "match_status": None,
        })
    return out


def normalize_report_package(
    package: dict,
    *,
    product: str = "",
    category: str = "",
    market: str | list[str] = "",
    query: str = "",
    chunks: list[dict] | None = None,
    vision_result: dict | None = None,
    agent_trace: list[dict] | None = None,
    user_documents: list[dict] | None = None,
    provider: str = "",
) -> dict:
    """Validate and normalize a report package while preserving legacy scene keys."""
    source = _as_dict(package).copy()
    chunks = chunks or []
    markets = _market_list(market)

    compliance = (
        source.get("complianceReport")
        or source.get("compliance_report")
        or source.get("report")
        or ""
    )
    profit = source.get("profitReport") or source.get("profit_report") or {}
    if isinstance(profit, str):
        profit = {"markdown": profit}
    profit = _as_dict(profit)
    if not str(profit.get("markdown") or "").strip():
        profit["markdown"] = "Profit analysis unavailable; fallback content was not provided."

    finance_validation_errors: list[str] = []
    if "structuredFields" in profit:
        try:
            profit["structuredFields"] = StructuredProfitFields.model_validate(
                profit["structuredFields"]
            ).model_dump()
        except ValidationError:
            # The prose remains available for review; malformed finance must not
            # be allowed to reach a detailed page or exported financial board.
            profit.pop("structuredFields", None)
            finance_validation_errors.append("financial_data_invalid")

    roadmap_validation_errors: list[str] = []
    raw_roadmap = _normalize_roadmap(source.get("roadmap"))
    try:
        validated_roadmap = Roadmap.model_validate(raw_roadmap).model_dump(exclude_none=True)
    except ValidationError as exc:
        roadmap_validation_errors = [e["msg"] for e in exc.errors()]
        validated_roadmap = Roadmap().model_dump(exclude_none=True)

    decision_validation_errors: list[str] = []
    raw_decision = _normalize_decision(source.get("decisionView") or source.get("decision_view"))
    try:
        validated_decision = DecisionView.model_validate(raw_decision).model_dump(exclude_none=True)
    except ValidationError as exc:
        decision_validation_errors = [e["msg"] for e in exc.errors()]
        validated_decision = DecisionView().model_dump(exclude_none=True)

    product_dossier = _as_dict(source.get("productDossier") or source.get("product_dossier"))
    product_dossier = {
        **product_dossier,
        "product": product_dossier.get("product") or product,
        "category": product_dossier.get("category") or category,
        "markets": product_dossier.get("markets") or markets,
        "query": product_dossier.get("query") or query,
        "sourceCounts": {
            "retrievedChunks": len(chunks),
            "userDocuments": len(_as_list(user_documents)),
            "visualItems": 1 if vision_result else 0,
            **_as_dict(product_dossier.get("sourceCounts")),
        },
    }

    evidence_validation_errors: list[str] = []
    evidence = source.get("evidenceBundles") or source.get("evidence_bundles")
    if isinstance(evidence, dict):
        try:
            evidence_bundles = EvidenceBundles.model_validate(evidence)
        except ValidationError as exc:
            evidence_validation_errors = [e["msg"] for e in exc.errors()]
            evidence_bundles = _build_evidence_bundles(
                chunks,
                vision_result=vision_result,
                agent_trace=agent_trace,
                user_documents=user_documents,
                compliance_report=str(compliance or ""),
                generated_package=source,
            )
    else:
        evidence_bundles = _build_evidence_bundles(
            chunks,
            vision_result=vision_result,
            agent_trace=agent_trace,
            user_documents=user_documents,
            compliance_report=str(compliance or ""),
            generated_package=source,
        )

    audit = _as_dict(source.get("auditMetadata") or source.get("audit_metadata"))
    # Top-level validationStatus reflects the compliance package shape.
    # Malformed sub-scenes (finance, decisionView, roadmap, evidenceBundles) are
    # isolated per-scene and do NOT downgrade the whole compliance package prose.
    audit = {
        "schemaVersion": audit.get("schemaVersion") or SCHEMA_VERSION,
        "generatedAt": audit.get("generatedAt") or _utc_now_iso(),
        "validationStatus": audit.get("validationStatus") or "normalized",
        "validationErrors": list(audit.get("validationErrors") or []),
        "provider": audit.get("provider") or provider,
        "traceNodeCount": audit.get("traceNodeCount") or len(_as_list(agent_trace)),
        "finance": {
            "validationStatus": "invalid" if finance_validation_errors else "valid",
            "errors": list(finance_validation_errors),
        },
        "decisionView": {
            "validationStatus": "invalid" if decision_validation_errors else "valid",
            "errors": list(decision_validation_errors),
        },
        "roadmap": {
            "validationStatus": "invalid" if roadmap_validation_errors else "valid",
            "errors": list(roadmap_validation_errors),
        },
        "evidenceBundles": {
            "validationStatus": "invalid" if evidence_validation_errors else "valid",
            "errors": list(evidence_validation_errors),
        },
    }

    # Spec §3.3 + §7.3: per-claim citations from the LLM.
    citations = _normalize_citations(
        source.get("citations") or source.get("citationRefs")
    )

    normalized = {
        **source,
        "productDossier": product_dossier,
        "complianceReport": str(compliance or "").strip(),
        "profitReport": profit,
        "roadmap": validated_roadmap,
        "decisionView": validated_decision,
        "evidenceBundles": evidence_bundles.model_dump(exclude_none=True),
        "auditMetadata": audit,
        "citations": citations,
        "evidencePack": _as_list(source.get("evidencePack") or source.get("evidence_pack")),
    }

    try:
        return ReportPackage.model_validate(normalized).model_dump(exclude_none=True)
    except ValidationError as exc:
        package_level_failures = [e["msg"] for e in exc.errors()]
        normalized["complianceReport"] = normalized["complianceReport"] or (
            "Report package validation failed; no compliance report text was available."
        )
        normalized["auditMetadata"] = {
            **audit,
            "validationStatus": "invalid",
            "validationErrors": package_level_failures,
        }
        try:
            return ReportPackage.model_validate(normalized).model_dump(exclude_none=True)
        except ValidationError:
            return normalized
