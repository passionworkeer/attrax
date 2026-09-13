"""Visual inspection data model (plan 2026-09-13 §6).

Three objects, one per layer of the inspection contract:

1. ``Observation`` — what the image shows, where, and how visible it is.
   Produced by the vision model (or OCR/detector), never by the report
   generator. ``region`` is optional: a check that did not make it into
   any photo legitimately has ``region=None`` and that must NOT be
   rendered as a fake hotspot on the first image.

2. ``InspectionCheckResult`` — per-check outcome from the model. Every
   check selected for the scan MUST come back with a completion state;
   the server back-fills any missing one as ``not_assessed`` so a partial
   model response cannot masquerade as "all clear".

3. ``Finding`` — the judgment layer. One per check that is NOT
   ``no_issue_observed``: the suspected issue / evidence gap, the
   observations and citations that back it, and the suggested action.

The three-state discipline (observation vs applicability vs judgment)
follows plan §5.1: "标签存在但模糊" is an observation state, "电池护照
适用与否" is an applicability state, and "缺 UKCA 需要补认证" is a
judgment. Collapsing them is what produced the audit-session false
positives (§2.3).
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = "visual-inspection/v1"

# Observation states — what the photo shows about one check target.
ObservationVisibility = Literal[
    "present_readable",     # region visible and text/marks legible
    "present_unreadable",   # region visible but blurred/glared/small
    "not_in_view",          # the expected region is simply not in this photo
    "occluded",             # something physically covers the region
    "absent_in_visible_scope",  # full label area visible; the field is missing there
    "not_assessed",         # model did not evaluate this check
]

# Applicability states — does the rule apply to this product at all.
ApplicabilityState = Literal[
    "applicable",
    "not_applicable",
    "needs_confirmation",   # conditions unknown (e.g. battery Wh unknown)
]

# Judgment states — the final per-check verdict.
JudgmentState = Literal[
    "no_issue_observed",    # checked; nothing suspicious — NOT "compliant"
    "suspected_issue",
    "evidence_needed",
    "confirmed_issue",
]

# Severity for findings.
SeverityV2 = Literal["critical", "high", "medium", "low", "unknown"]

# Where the region coordinates came from.
GroundingSource = Literal["vlm", "ocr", "detector", "human"]


class BboxRegion(BaseModel):
    """Normalized bbox on the canonical image.

    Coordinates are fractions of the canonical (EXIF-applied) image in
    [0, 1]; ``x + w <= 1`` and ``y + h <= 1`` are enforced so the box
    stays inside the photo. The 2026-09-13 audit found boxes being
    clamped silently when the model emitted out-of-range values; here a
    serious violation raises instead of being quietly "fixed" into a
    legal-looking box.
    """

    model_config = ConfigDict(extra="forbid")

    coordinate_space: Literal["normalized_canonical_image"] = "normalized_canonical_image"
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)
    grounding_source: GroundingSource = "vlm"
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    verified: bool = False  # set by verify/grounding.py after checks pass

    @field_validator("x", "y", "w", "h")
    @classmethod
    def require_finite(cls, value: float) -> float:
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("bbox values must be finite")
        return value

    def model_post_init(self, __context: Any) -> None:
        if self.x + self.w > 1.0 + 1e-6:
            raise ValueError(f"x + w exceeds 1.0 (x={self.x}, w={self.w})")
        if self.y + self.h > 1.0 + 1e-6:
            raise ValueError(f"y + h exceeds 1.0 (y={self.y}, h={self.h})")


class PolygonRegion(BaseModel):
    """Normalized polygon on the canonical image (second-phase use)."""

    model_config = ConfigDict(extra="forbid")

    coordinate_space: Literal["normalized_canonical_image"] = "normalized_canonical_image"
    points: list[tuple[float, float]] = Field(min_length=3, max_length=32)
    grounding_source: GroundingSource = "vlm"
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    verified: bool = False


class Region(BaseModel):
    """A grounding region — bbox now, polygon when segmentation lands."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["bbox", "polygon"]
    bbox: BboxRegion | None = None
    polygon: PolygonRegion | None = None
    mask_asset_id: str | None = None


class ImageAssetV2(BaseModel):
    """Canonical image identity for the inspection contract."""

    model_config = ConfigDict(extra="forbid")

    image_id: str
    sha256: str = Field(min_length=8)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    orientation_applied: bool = True
    canonical_version: str = "v1"
    view_type: str | None = None  # front / back / nameplate_closeup / ...


class Observation(BaseModel):
    """One observed fact about one check on one image."""

    model_config = ConfigDict(extra="forbid")

    observation_id: str = Field(min_length=1)
    check_id: str = Field(min_length=1)
    image_id: str = Field(min_length=1)
    visibility: ObservationVisibility
    observed_text: str | None = None       # what the label/mark actually said
    description: str = ""
    region: Region | None = None           # None is a VALID state (plan §6)


class InspectionCheckResult(BaseModel):
    """Per-check completion state + the model's judgment."""

    model_config = ConfigDict(extra="forbid")

    check_id: str = Field(min_length=1)
    visibility: ObservationVisibility = "not_assessed"
    applicability: ApplicabilityState = "needs_confirmation"
    judgment: JudgmentState = "no_issue_observed"
    severity: SeverityV2 = "unknown"
    observation_ids: list[str] = Field(default_factory=list)
    notes: str = ""


class Finding(BaseModel):
    """A judgment worth surfacing — one per non-clean check."""

    model_config = ConfigDict(extra="forbid")

    finding_id: str = Field(min_length=1)
    check_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=200)
    assessment: Literal["suspected_issue", "evidence_needed", "confirmed_issue"]
    applicability: ApplicabilityState = "applicable"
    severity: SeverityV2 = "unknown"
    observation_ids: list[str] = Field(default_factory=list)
    citation_ids: list[str] = Field(default_factory=list)
    suggested_action: str = ""
    required_evidence: list[str] = Field(default_factory=list)


class InspectionProfile(BaseModel):
    """A category's fixed checklist — loaded from data/inspection_profiles/."""

    model_config = ConfigDict(extra="forbid")

    profile_id: str                     # e.g. "electronics"
    version: int = 1
    title: str = ""
    checks: list[InspectionProfileCheck] = Field(default_factory=list)


class InspectionProfileCheck(BaseModel):
    """One checklist item inside a profile (plan §5.1 YAML shape)."""

    model_config = ConfigDict(extra="forbid")

    id: str                              # "common.nameplate.readability"
    version: int = 1
    title: str = ""
    target_regions: list[str] = Field(default_factory=list)
    required_views: list[str] = Field(default_factory=list)
    methods: list[str] = Field(default_factory=list)      # vision / ocr / detector
    evidence_mode: Literal["visual", "document", "lab_test", "registration"] = "visual"
    legal_anchor_refs: list[str] = Field(default_factory=list)


def backfill_not_assessed(
    check_results: list[InspectionCheckResult],
    selected_check_ids: list[str],
) -> list[InspectionCheckResult]:
    """Ensure every selected check has a result; missing → not_assessed.

    Plan §5.1: the model cannot delete a check it doesn't know how to do.
    The server validates the full set and marks anything the model skipped
    as ``not_assessed`` so the report cannot present a gap as a pass.
    """
    by_id = {result.check_id: result for result in check_results}
    backfilled = list(check_results)
    for check_id in selected_check_ids:
        if check_id not in by_id:
            backfilled.append(
                InspectionCheckResult(
                    check_id=check_id,
                    visibility="not_assessed",
                    applicability="needs_confirmation",
                    judgment="no_issue_observed",
                    severity="unknown",
                    observation_ids=[],
                    notes="model did not return this check; server backfilled",
                )
            )
    return backfilled
