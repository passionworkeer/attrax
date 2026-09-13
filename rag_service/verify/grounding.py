"""Grounding/coordinate validation for visual inspection regions.

Plan 2026-09-13 §7.1 step 6: "校验坐标、证据关系、引用、适用性条件和结果
完整性,再持久化"。This module owns the coordinate half of that contract:

- finite values, in [0, 1], w/h > 0, x+w <= 1, y+h <= 1
- only rounding-level overshoot (<= tolerance) is clamped back;
  a seriously out-of-range box is REJECTED with a reason, never silently
  clipped into a "legal looking" box (audit §6 engineering constraint)
- imageId existence and identity against the canonical image set
- duplicate observation dedup by (check_id, image_id) so a repeated model
  answer cannot stack two boxes on the same spot

The matcher-style API returns structured results instead of raising so the
pipeline can record rejection reasons in the audit trail.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# Rounding-level tolerance: the model emits 0.30000000000000004-class noise
# and (rarely) 1.0000002 for a full-frame box. Anything beyond this is a
# real coordinate error and gets rejected, not clipped.
ROUNDING_TOLERANCE = 1e-3

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


@dataclass
class GroundingRejection:
    observation_id: str
    reason: str


@dataclass
class GroundingReport:
    accepted: list[str] = field(default_factory=list)
    rejected: list[GroundingRejection] = field(default_factory=list)
    deduplicated: list[str] = field(default_factory=list)

    @property
    def rejection_rate(self) -> float:
        total = len(self.accepted) + len(self.rejected)
        return len(self.rejected) / total if total else 0.0


def validate_bbox_values(
    raw: dict[str, Any],
    *,
    tolerance: float = ROUNDING_TOLERANCE,
) -> tuple[dict[str, float] | None, str | None]:
    """Validate + normalize a raw ``{x, y, w, h}`` dict.

    Returns ``(normalized_bbox, None)`` on success or ``(None, reason)``
    when the box is unusable. Rounding-level overshoot (x+w = 1.0000004)
    is clamped; gross violations are rejected with a reason string so the
    caller can audit them.
    """
    try:
        x = float(raw.get("x"))
        y = float(raw.get("y"))
        w = float(raw.get("w", raw.get("width")))
        h = float(raw.get("h", raw.get("height")))
    except (TypeError, ValueError):
        return None, "bbox fields missing or not numeric"

    for name, value in (("x", x), ("y", y), ("w", w), ("h", h)):
        if value != value or value in (float("inf"), float("-inf")):
            return None, f"bbox {name} is not finite"

    if w <= 0 or h <= 0:
        return None, f"bbox w/h must be > 0 (w={w}, h={h})"
    if x < -tolerance or y < -tolerance:
        return None, f"bbox x/y must be >= 0 (x={x}, y={y})"

    # Clamp rounding-level overshoot only.
    x = min(max(x, 0.0), 1.0)
    y = min(max(y, 0.0), 1.0)

    if x + w > 1.0 + tolerance:
        return None, f"x + w exceeds 1.0 beyond tolerance (x={x}, w={w})"
    if y + h > 1.0 + tolerance:
        return None, f"y + h exceeds 1.0 beyond tolerance (y={y}, h={h})"

    w = min(w, 1.0 - x)
    h = min(h, 1.0 - y)
    return {"x": x, "y": y, "w": w, "h": h}, None


def valid_entity_id(value: str) -> bool:
    return bool(_ID_RE.match(value or ""))


def verify_observations(
    observations: list[dict[str, Any]],
    *,
    known_image_ids: set[str],
) -> GroundingReport:
    """Validate a batch of raw observation dicts against the grounding contract.

    Each observation dict carries at least ``observationId``, ``checkId``,
    ``imageId`` and (optionally) ``region.bbox``. The report lists which
    observation ids were accepted, which were rejected (with reason), and
    which were dropped as duplicates of an already-accepted observation of
    the same (checkId, imageId) pair.
    """
    report = GroundingReport()
    seen_pairs: set[tuple[str, str]] = set()

    for raw in observations:
        obs_id = str(raw.get("observationId") or raw.get("id") or "")
        if not obs_id:
            obs_id = f"obs-rejected-{len(report.rejected)}"
        check_id = str(raw.get("checkId") or raw.get("check_id") or "")
        image_id = str(raw.get("imageId") or raw.get("image_id") or "")

        if not valid_entity_id(check_id):
            report.rejected.append(
                GroundingRejection(obs_id, f"invalid checkId: {check_id!r}")
            )
            continue
        if image_id and image_id not in known_image_ids:
            report.rejected.append(
                GroundingRejection(obs_id, f"unknown imageId: {image_id!r}")
            )
            continue

        region = raw.get("region")
        if region is None:
            # region=None is a valid state (plan §6) — accept as-is.
            key = (check_id, image_id)
            if key in seen_pairs:
                report.deduplicated.append(obs_id)
                continue
            seen_pairs.add(key)
            report.accepted.append(obs_id)
            continue

        if not isinstance(region, dict):
            report.rejected.append(
                GroundingRejection(obs_id, "region present but not an object")
            )
            continue

        bbox_raw = region.get("bbox")
        if region.get("kind") == "polygon":
            # Polygon validation lands with segmentation; treat as accepted
            # but flagged unverified.
            key = (check_id, image_id)
            if key in seen_pairs:
                report.deduplicated.append(obs_id)
                continue
            seen_pairs.add(key)
            report.accepted.append(obs_id)
            continue
        if not isinstance(bbox_raw, dict):
            report.rejected.append(
                GroundingRejection(obs_id, "region.kind=bbox but bbox object missing")
            )
            continue

        normalized, reason = validate_bbox_values(bbox_raw)
        if normalized is None:
            report.rejected.append(GroundingRejection(obs_id, reason or "invalid bbox"))
            continue

        key = (check_id, image_id)
        if key in seen_pairs:
            report.deduplicated.append(obs_id)
            continue
        seen_pairs.add(key)
        report.accepted.append(obs_id)

    return report


def annotate_verification(
    observations: list[dict[str, Any]],
    report: GroundingReport,
) -> list[dict[str, Any]]:
    """Attach ``verified`` flags + normalized bbox back onto accepted observations.

    Rejected observations are dropped from the returned list; their ids and
    reasons remain available in ``report`` for the audit trail.
    """
    accepted = set(report.accepted)
    output: list[dict[str, Any]] = []
    for raw in observations:
        obs_id = str(raw.get("observationId") or raw.get("id") or "")
        if obs_id not in accepted:
            continue
        entry = dict(raw)
        region = entry.get("region")
        if isinstance(region, dict) and isinstance(region.get("bbox"), dict):
            normalized, _ = validate_bbox_values(region["bbox"])
            if normalized is not None:
                region = {**region, "bbox": normalized, "verified": True}
                entry["region"] = region
        output.append(entry)
    return output
