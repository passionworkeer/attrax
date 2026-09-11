#!/usr/bin/env python3
"""
must_check.py - Mandatory regulation injection by product category / feature

**Deprecated as of 2026-09-11** (De-RAG spec §7.1): the curated regulation
matrix is now sourced from `data/kb/anchors/*.yaml` via
`rag_service.retrieval.kb_loader`. The two big dicts (CATEGORY_REGULATIONS,
FEATURE_REGULATIONS) are computed at import time from the KB YAML files and
re-exported here as a backward-compatibility shim so existing tests and
`generator_node` consumers see the same API.

Detection logic (FEATURE_KEYWORDS / detect_features) stays here — it operates
on free text, not on the regulation matrix. The retrieval-side injection
(`apply_must_check` / `_find_matching_chunk`) also stays — it is part of the
FAISS+BM25 retrieval path and will be deleted in §7.7 of the spec.

Two orthogonal sources of mandatory regulations:

1. ``CATEGORY_REGULATIONS`` — keyed by product category (what the user picked).
2. ``FEATURE_REGULATIONS`` — keyed by product *features* detected by the vision
   node (battery / wireless / mains / children). Cross-cutting features apply
   regardless of category: a bluetooth speaker classified "electronics" needs
   RED; a bluetooth *toy* needs RED too. Category alone cannot express that.

2026-09-10 (A+B hybrid decision): this matrix is the PRIMARY source of truth
for report coverage. The corpus (FAISS/BM25) provides supporting citations,
not the checklist itself. ``build_anchor_list`` merges category + feature
entries, filters by target markets, and is passed to the generator as the
must-cover checklist.

2026-09-11 (De-RAG spec §7.1): the matrix now lives as YAML files under
``data/kb/anchors/``. Editing the matrix = edit a YAML file. Re-running
``scripts/migrate_must_check_to_kb.py --force`` re-generates the YAMLs from
the seed data embedded in that script.

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
        "battery", "lithium", "li-ion", "rechargeable", "充电",
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
        anchors.append({
            "doc_name": doc_name,
            "region": region,
            "reason": entry.get("reason", ""),
            "source": source,
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


# ── retrieval-side injection (deferred deletion with retrieval stack §7.7) ──


def _find_matching_chunk(mc: dict, all_chunks: list[dict]) -> dict | None:
    """Find the best chunk for a must-check entry using precise fields.

    Previous logic did substring matching on ``doc_name`` (and even matched
    ``doc_name.split()[0]``), which caused false positives — e.g. ``RoHS``
    matching any document whose name started with ``RoHS`` regardless of
    market. This prefers, in order:

      1. Exact ``source_id`` match (most reliable when chunks carry it).
      2. Exact ``doc_name`` match (case-insensitive, equality, not substring).
      3. ``source_file`` basename match.
      4. Containment fallback: chunk doc_name contains the target doc_name
         AND region matches. Only triggered when the target carries a
         region, so cross-market false positives are prevented.

    Returns the first matching chunk, or ``None``.
    """
    target_doc = mc.get("doc_name", "").strip().lower()
    target_sid = str(mc.get("source_id", "")).strip()
    target_file = str(mc.get("source_file", "")).strip().lower()
    target_region = str(mc.get("region", "")).strip().lower()

    if target_sid:
        for c in all_chunks:
            if str(c.get("source_id", "")).strip() == target_sid:
                return c
    if target_doc:
        for c in all_chunks:
            if str(c.get("doc_name", "")).strip().lower() == target_doc:
                return c
    if target_file:
        for c in all_chunks:
            cfile = str(c.get("source_file", "")).strip().lower()
            if cfile and (
                cfile == target_file
                or cfile.endswith("/" + target_file)
                or cfile.endswith("\\" + target_file)
            ):
                return c
    # Containment fallback (region-scoped to prevent cross-market false hits).
    if target_doc and target_region:
        for c in all_chunks:
            c_doc = str(c.get("doc_name", "")).strip().lower()
            c_region = str(c.get("region", "")).strip().lower()
            if c_doc and c_region == target_region and target_doc in c_doc:
                return c
    return None


def apply_must_check(
    results: list[dict],
    category: str,
    all_chunks: list[dict],
) -> list[dict]:
    """
    Inject must-check regulations into results if not already present.

    Matching is precise (source_id / exact doc_name / source_file, with a
    region-scoped containment fallback). Injected items are tagged
    ``is_must_check=True`` and interleaved into the existing RRF ranking
    instead of being force-prepended, so a high-scoring retrieval result
    is not demoted below a must-check item that is merely "also relevant".
    The injection still guarantees coverage: any must-check doc missing
    from the result set is added, preserving the must-check semantics.

    Immutability: inputs are not mutated; a new list is returned.

    Args:
        results: current retrieval results (sorted by rrf_score desc)
        category: product category
        all_chunks: full chunk list for lookups

    Returns:
        New list with must-check items merged in. Capped at 50 entries.
    """
    must_checks = get_must_check_regulations(category)
    if not must_checks:
        return list(results)

    existing_doc_names = {
        str(r.get("doc_name", "")).strip().lower()
        for r in results
        if r.get("doc_name")
    }

    injected: list[dict] = []
    for mc in must_checks:
        doc_name = mc["doc_name"]
        if doc_name.strip().lower() in existing_doc_names:
            continue

        top = _find_matching_chunk(mc, all_chunks)
        if top is None:
            continue

        injected.append({
            "id": f"must_check_{doc_name}",
            # Injection score sits above typical RRF scores (max ~0.08) so
            # the item is guaranteed to surface, but interleaving means a
            # strongly-retrieved chunk with rrf_score>0.5 still ranks above
            # a borderline must-check item.
            "rrf_score": 0.5,
            "score": 0.5,
            "content": top.get("content", ""),
            "doc_name": doc_name,
            "article_no": top.get("article_no", ""),
            "region": mc["region"],
            "source_id": top.get("source_id", ""),
            "is_must_check": True,
            "must_check_reason": mc["reason"],
        })

    if not injected:
        # Preserve the historical 50-cap even when nothing was injected.
        return list(results)[:50]

    # Interleave by score (stable sort preserves existing ordering among
    # ties, so the original retrieval ranking is not reshuffled beyond
    # the insertion points).
    combined = sorted(
        list(results) + injected,
        key=lambda r: r.get("rrf_score", r.get("score", 0.0)),
        reverse=True,
    )
    return combined[:50]


# Backward-compat re-export so legacy code that imported ALWAYS_INCLUDE_REGIONS
# directly (without going through kb_loader) keeps working.
ALWAYS_INCLUDE_REGIONS = kb_loader.ALWAYS_INCLUDE_REGIONS


__all__ = [
    "ALWAYS_INCLUDE_REGIONS",
    "CATEGORY_REGULATIONS",
    "FEATURE_KEYWORDS",
    "FEATURE_REGULATIONS",
    "apply_must_check",
    "build_anchor_list",
    "detect_features",
    "get_feature_regulations",
    "get_must_check_regulations",
]
