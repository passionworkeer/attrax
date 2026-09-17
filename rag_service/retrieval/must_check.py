#!/usr/bin/env python3
"""
must_check.py - Mandatory regulation injection by product category / feature

**Deprecated as of 2026-09-11** (De-RAG spec §7.1): the curated regulation
matrix is now sourced from `data/kb/anchors/*.yaml` via
`rag_service.retrieval.kb_loader`. The two big dicts (CATEGORY_REGULATIONS,
FEATURE_REGULATIONS) are computed at import time from the KB YAML files and
re-exported here as a backward-compatibility shim so existing tests and
generator consumers see the same API.

Detection logic (FEATURE_KEYWORDS / detect_features) stays here — it operates
on free text, not on the regulation matrix.

2026-09-11 (De-RAG §7.7): the retrieval-side injection helpers
(`apply_must_check` / `_find_matching_chunk`) are deleted together with the
retrieval stack they served. The generator-side anchor list
(`build_anchor_list`) is the only consumer path left, and it feeds the
KB-anchored pipeline directly.

Region conventions: market codes (EU/US/UK/CN/AU/SA/AE...) mean "applies when
that market is a target". "UN" means transport/global regimes that apply to
every market (UN 38.3, IATA DGR) and are always included.
"""
from __future__ import annotations

import logging
from typing import Any

from rag_service.retrieval import kb_loader

logger = logging.getLogger(__name__)


# Detection logic — operates on free text, not on the regulation matrix.
# Kept here permanently (not migrated to KB).
FEATURE_KEYWORDS: dict[str, list[str]] = {
    "battery": [
        "锂电池", "锂离子", "电池供电", "电池仓", "电池盒", "充电宝", "移动电源",
        "battery", "lithium", "li-ion", "rechargeable", "充电电池", "可充电", "内置电池", "纽扣电池",
    ],
    "wireless": [
        "蓝牙", "无线", "wifi", "wi-fi", "2.4g", "5g频段", "射频", "nfc",
        "bluetooth", "wireless", "radio", "rf module",
    ],
    "mains": [
        "插电", "市电", "电源适配器", "适配器供电", "ac供电", "交流供电", "220v", "110v",
        "mains", "ac powered", "power adapter", "plug-in",
    ],
    "children": [
        "儿童", "孩子", "婴幼儿", "小孩", "早教",
        "kids", "children", "child", "toddler", "infant",
    ],
}


def get_must_check_regulations(category: str) -> list[dict]:
    """Get mandatory regulations for a product category."""
    return kb_loader.get_anchors_by_category(category)


def detect_features(*text_sources: str) -> list[str]:
    """Detect product features from free text (vision core_features etc.).

    Args:
        *text_sources: any number of strings scanned jointly (e.g. joined
            core_features, product name). Order-independent.

    Returns:
        Sorted list of matched feature keys ("battery", "wireless", ...).
        Empty list when nothing matches — the caller then falls back to
        category-only anchors.
    """
    haystack = " ".join(t for t in text_sources if t).lower()
    if not haystack.strip():
        return []
    matched = [
        feature
        for feature, keywords in FEATURE_KEYWORDS.items()
        if any(kw in haystack for kw in keywords)
    ]
    return sorted(matched)


def get_feature_regulations(features: list[str]) -> list[dict]:
    """Regulations triggered by detected product features (no market filter).

    Each requested feature returns its full anchor list; callers should pass
    the union to ``build_anchor_list`` for market filtering + dedup.
    """
    out: list[dict] = []
    for feature in features:
        out.extend(kb_loader.get_anchors_by_feature(feature))
    return out


def build_anchor_list(
    category: str,
    markets: list[str],
    features: list[str] | None = None,
) -> list[dict]:
    """Build the must-cover checklist passed to the generator.

    Merges category regulations + feature-triggered regulations, de-dupes by
    (doc_name, region), and filters to the target markets. Entries whose
    region is ``UN`` (global transport regimes) are always kept.

    Returns a NEW list; never mutates the module-level matrices.
    """
    target = {str(m).strip().upper() for m in markets if m}
    entries: list[tuple[dict, str]] = [
        (entry, "category") for entry in get_must_check_regulations(category)
    ]
    if features:
        entries.extend((entry, "feature") for entry in get_feature_regulations(features))

    seen: set[tuple[str, str]] = set()
    anchors: list[dict] = []
    for entry, source in entries:
        region = str(entry.get("region", "")).strip().upper()
        doc_name = str(entry.get("doc_name", "")).strip()
        key = (doc_name.lower(), region)
        if key in seen:
            continue
        if region not in kb_loader.ALWAYS_INCLUDE_REGIONS and target and region not in target:
            continue
        seen.add(key)
        kb_entry = entry.get("kb_entry") or {}
        anchors.append({
            "doc_name": doc_name,
            "region": region,
            "reason": entry.get("reason", ""),
            "source": source,
            # Plan 2026-09-13 §10.1: the applicability engine keys special
            # rules (battery passport scoping, UK radio CE acceptance) by
            # regulation id — carry it through from the KB anchor.
            "regulation_id": str(kb_entry.get("regulation_id") or ""),
            "short_name": str(kb_entry.get("short_name") or ""),
            "trigger_features": list((kb_entry.get("applies_if") or {}).get("features_any") or []),
        })
    return anchors


# Backward-compat: expose the KB matrices as module-level dicts so legacy
# callers (tests, generator_node, retrieval injection) see the same shape
# they always did. Recomputed on every import; the underlying data lives
# in `data/kb/anchors/*.yaml`.
def _build_category_regulations() -> dict[str, list[dict]]:
    categories: set[str] = set()
    for payload in kb_loader._load_all().values():
        for c in (payload.get("applies_if") or {}).get("category", []):
            categories.add(c)
    return {c: kb_loader.get_anchors_by_category(c) for c in sorted(categories)}


def _build_feature_regulations() -> dict[str, list[dict]]:
    features: set[str] = set()
    for payload in kb_loader._load_all().values():
        for f in (payload.get("applies_if") or {}).get("features_any", []):
            features.add(f)
    return {f: kb_loader.get_anchors_by_feature(f) for f in sorted(features)}


CATEGORY_REGULATIONS: dict[str, list[dict]] = _build_category_regulations()
FEATURE_REGULATIONS: dict[str, list[dict]] = _build_feature_regulations()


# Backward-compat re-export so legacy code that imported ALWAYS_INCLUDE_REGIONS
# directly (without going through kb_loader) keeps working.
ALWAYS_INCLUDE_REGIONS = kb_loader.ALWAYS_INCLUDE_REGIONS


__all__ = [
    "ALWAYS_INCLUDE_REGIONS",
    "CATEGORY_REGULATIONS",
    "FEATURE_KEYWORDS",
    "FEATURE_REGULATIONS",
    "build_anchor_list",
    "detect_features",
    "get_feature_regulations",
    "get_must_check_regulations",
]
