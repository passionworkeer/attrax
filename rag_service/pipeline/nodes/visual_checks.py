"""Inspection profile loading and check selection (plan 2026-09-13 §5).

Profiles are YAML files under ``data/inspection_profiles/`` keyed by the
upload category (``electronics`` / ``3c`` / ``toy`` / …). Every profile
``extends: common`` which contributes the baseline checks. This module:

1. loads + validates a profile via Pydantic (``InspectionProfile``),
2. expands ``extends`` into the effective check list (category checks +
   common checks, category-first, ids deduplicated),
3. selects the visual checks that the vision model is asked to perform
   (``methods`` contains ``vision`` or ``ocr``; lab/document/registration
   items are surfaced on the result page as "待补资料" instead).

The model cannot drop a check it doesn't know how to do — the server
validates the full selected set (``backfill_not_assessed``).
"""
from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from rag_service.schemas.visual_inspection import (
    InspectionProfile,
    InspectionProfileCheck,
)

logger = logging.getLogger(__name__)

_DEFAULT_DIR = Path(__file__).resolve().parents[3] / "data" / "inspection_profiles"

# Category → profile mapping. The upload page's ProductCategory enum and
# this mapping must stay in sync (same discipline as ALLOWED_MARKETS).
CATEGORY_TO_PROFILE: dict[str, str] = {
    "electronics": "electronics",
    "appliance": "appliance",
    "3c": "3c",
    "toy": "toy",
    "toys": "toy",
    "home": "home",
    "battery": "battery",
    "batteries": "battery",
    "cosmetic": "cosmetic",
    "cosmetics": "cosmetic",
    "textile": "textile",
    "textiles": "textile",
    "food_contact": "food_contact",
    "other": "other",
}


@lru_cache(maxsize=32)
def load_profile(profile_id: str, directory: Path | None = None) -> InspectionProfile:
    """Load one profile YAML. Aliases resolve via CATEGORY_TO_PROFILE;
    unknown ids fall back to ``other``."""
    resolved = CATEGORY_TO_PROFILE.get(profile_id, profile_id)
    base = directory or _DEFAULT_DIR
    path = base / f"{resolved}.yaml"
    if not path.exists():
        logger.warning("inspection profile not found: %s (using other)", resolved)
        path = base / "other.yaml"
        if not path.exists():
            return InspectionProfile(profile_id=resolved, version=0, title="(missing profile)")
    with path.open("r", encoding="utf-8") as fh:
        raw: dict[str, Any] = yaml.safe_load(fh) or {}
    # ``extends`` is consumed here, not part of the Pydantic contract.
    raw.pop("extends", None)
    return InspectionProfile.model_validate(raw)


def effective_checks(category: str, directory: Path | None = None) -> list[InspectionProfileCheck]:
    """Category checks + common checks, category-first, deduped by id."""
    profile_id = CATEGORY_TO_PROFILE.get(category, "other")
    profile = load_profile(profile_id, directory)
    common = load_profile("common", directory)
    merged: list[InspectionProfileCheck] = []
    seen: set[str] = set()
    for check in [*profile.checks, *common.checks]:
        if check.id in seen:
            continue
        seen.add(check.id)
        merged.append(check)
    return merged


def visual_check_ids(category: str, directory: Path | None = None) -> list[str]:
    """Ids of the checks the vision model performs on the photos."""
    return [
        check.id
        for check in effective_checks(category, directory)
        if any(method in {"vision", "ocr"} for method in check.methods)
    ]


def deferred_evidence_checks(category: str, directory: Path | None = None) -> list[InspectionProfileCheck]:
    """Checks that cannot be judged from photos — render as 待补资料."""
    return [
        check
        for check in effective_checks(category, directory)
        if not any(method in {"vision", "ocr"} for method in check.methods)
    ]
